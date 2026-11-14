import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { normalizeUnitLabel } from '../../../shared/standards/aqiStandards.ts';
import { Pollutant } from '../../../shared/types.ts';
import { AppError } from '../../middleware/errorHandler.ts';

export interface ServerDetectedColumn {
  header: string;
  suggestedRole: 'location' | 'timestamp' | 'time' | 'latitude' | 'longitude' | 'pollutant' | 'ignore';
  suggestedPollutant?: Pollutant;
  suggestedUnit: string;
  sampleValues: string[];
  missingCount: number;
}

export interface ServerDetectedSchema {
  headers: string[];
  detectedColumns: ServerDetectedColumn[];
  warnings: string[];
  dateFormatHint: 'auto' | 'DMY' | 'MDY' | 'ISO';
}

export interface ParsedRawDataset {
  title: string;
  sourceType: 'csv' | 'xlsx' | 'paste' | 'manual';
  originalFilename?: string;
  headers: string[];
  rows: Record<string, string>[];
  detectedSchema: ServerDetectedSchema;
}

const MAX_ROWS = 25_000;

const POLLUTANT_PATTERNS: Array<{ pollutant: Pollutant; regex: RegExp; defaultUnit: string }> = [
  { pollutant: 'PM25', regex: /pm\s*[_\-.]?\s*2\s*[_\-.]?\s*5|fine\s*particulate/i, defaultUnit: 'µg/m³' },
  { pollutant: 'PM10', regex: /pm\s*[_\-.]?\s*10|rspm|coarse\s*particulate/i, defaultUnit: 'µg/m³' },
  { pollutant: 'NO2', regex: /\bno\s*[_\-.]?\s*2\b|nitrogen\s*dioxide/i, defaultUnit: 'µg/m³' },
  { pollutant: 'SO2', regex: /\bso\s*[_\-.]?\s*2\b|sul[fp]hur\s*dioxide/i, defaultUnit: 'µg/m³' },
  { pollutant: 'CO', regex: /\bco\b|carbon\s*monoxide/i, defaultUnit: 'mg/m³' },
  { pollutant: 'O3', regex: /\bo\s*[_\-.]?\s*3\b|ozone/i, defaultUnit: 'µg/m³' },
  { pollutant: 'AQI', regex: /\baqi\b|air\s*quality\s*index/i, defaultUnit: 'index' },
];

function extractUnitFromHeaderOrSamples(header: string, samples: string[], fallback: string): string {
  const bracketMatch = header.match(/\(([^)]+)\)|\[([^\]]+)\]/);
  if (bracketMatch) {
    const candidate = normalizeUnitLabel(bracketMatch[1] || bracketMatch[2]);
    if (candidate !== 'unknown') return candidate;
  }
  for (const s of samples) {
    const unitMatch = s.match(/(µg\/m³|ug\/m3|µg\/m3|mg\/m³|mg\/m3|ppb|ppm)/i);
    if (unitMatch) return normalizeUnitLabel(unitMatch[1]);
  }
  return fallback;
}

function inferDateFormatHint(samples: string[]): { hint: 'auto' | 'DMY' | 'MDY' | 'ISO'; warning?: string } {
  let sawIso = false;
  let sawFirstOver12 = false;
  let sawSecondOver12 = false;
  let sawSlashDates = false;

  for (const raw of samples) {
    const s = raw.trim();
    if (!s) continue;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      sawIso = true;
      continue;
    }
    const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (m) {
      sawSlashDates = true;
      const first = Number(m[1]);
      const second = Number(m[2]);
      if (first > 12) sawFirstOver12 = true;
      if (second > 12) sawSecondOver12 = true;
    }
  }

  if (sawFirstOver12 && !sawSecondOver12) return { hint: 'DMY' };
  if (sawSecondOver12 && !sawFirstOver12) return { hint: 'MDY' };
  if (sawIso && !sawSlashDates) return { hint: 'ISO' };
  if (sawSlashDates && !sawFirstOver12 && !sawSecondOver12) {
    return {
      hint: 'DMY',
      warning: 'Ambiguous DD/MM vs MM/DD dates detected. Confirm Date Format before normalizing.',
    };
  }
  return { hint: 'auto' };
}

export function detectSchemaFromRows(
  headers: string[],
  rows: Record<string, string>[],
): ServerDetectedSchema {
  const cleanHeaders = headers.map((h) => h.trim()).filter(Boolean);
  const warnings: string[] = [];

  if (cleanHeaders.length === 0 || rows.length === 0) {
    throw new AppError(400, 'EMPTY_DATASET', 'Dataset contains no recognizable columns or rows.');
  }

  const detectedColumns: ServerDetectedColumn[] = cleanHeaders.map((header) => {
    const values = rows.map((r) => String(r[header] ?? '').trim());
    const nonEmpty = values.filter((v) => v !== '' && !/^(na|n\/a|null|-|bdl)$/i.test(v));
    const missingCount = values.length - nonEmpty.length;
    const sampleValues = nonEmpty.slice(0, 5);

    let suggestedRole: ServerDetectedColumn['suggestedRole'] = 'ignore';
    let suggestedPollutant: Pollutant | undefined;
    let suggestedUnit = 'unknown';

    if (/^(loc|location|station|site|ward|area|zone|school|society)/i.test(header) || /station|location|ward|site/i.test(header)) {
      suggestedRole = 'location';
    } else if (/^(lat|latitude)$/i.test(header) || /latitude/i.test(header)) {
      suggestedRole = 'latitude';
    } else if (/^(lon|lng|long|longitude)$/i.test(header) || /longitude/i.test(header)) {
      suggestedRole = 'longitude';
    } else if (/^(time|hour)$/i.test(header)) {
      suggestedRole = 'time';
    } else if (/date|timestamp|recorded|sampled|observed/i.test(header)) {
      suggestedRole = 'timestamp';
    } else {
      for (const pat of POLLUTANT_PATTERNS) {
        if (pat.regex.test(header)) {
          suggestedRole = 'pollutant';
          suggestedPollutant = pat.pollutant;
          suggestedUnit = extractUnitFromHeaderOrSamples(header, sampleValues, pat.defaultUnit);
          break;
        }
      }
    }

    return {
      header,
      suggestedRole,
      suggestedPollutant,
      suggestedUnit,
      sampleValues,
      missingCount,
    };
  });

  const tsCol = detectedColumns.find((c) => c.suggestedRole === 'timestamp');
  const dateCheck = tsCol
    ? inferDateFormatHint(rows.slice(0, 200).map((r) => String(r[tsCol.header] ?? '')))
    : { hint: 'auto' as const };
  if (dateCheck.warning) warnings.push(dateCheck.warning);

  const missingCols = detectedColumns.filter((c) => c.missingCount > 0);
  if (missingCols.length > 0) {
    warnings.push(
      `Missing or empty readings detected in ${missingCols.length} column(s); nulls are preserved as missing.`,
    );
  }

  return {
    headers: cleanHeaders,
    detectedColumns,
    warnings,
    dateFormatHint: dateCheck.hint,
  };
}

export function parseCsvString(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const parsed = Papa.parse<Record<string, unknown>>(text.trim(), {
    header: true,
    skipEmptyLines: true,
  });

  const headers = (parsed.meta.fields || []).map((h) => String(h || '').trim()).filter(Boolean);
  if (headers.length === 0) {
    throw new AppError(400, 'PARSE_ERROR', 'Could not detect tabular header columns.');
  }
  if (parsed.data.length > MAX_ROWS) {
    throw new AppError(400, 'ROW_LIMIT_EXCEEDED', `Maximum ${MAX_ROWS} rows supported per upload.`);
  }

  const rows = parsed.data.map((raw) => {
    const out: Record<string, string> = {};
    for (const h of headers) {
      out[h] = raw[h] == null ? '' : String(raw[h]).slice(0, 500);
    }
    return out;
  });

  return { headers, rows };
}

export function parseExcelBuffer(buffer: Buffer): { headers: string[]; rows: Record<string, string>[] } {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new AppError(400, 'EMPTY_WORKBOOK', 'Uploaded Excel workbook contains no sheets.');
  }
  const sheet = workbook.Sheets[sheetName];
  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  });

  if (jsonRows.length === 0) {
    throw new AppError(400, 'EMPTY_WORKBOOK', 'Uploaded Excel sheet contains no data rows.');
  }
  if (jsonRows.length > MAX_ROWS) {
    throw new AppError(400, 'ROW_LIMIT_EXCEEDED', `Maximum ${MAX_ROWS} rows supported per upload.`);
  }

  const headers = Object.keys(jsonRows[0]).map((h) => h.trim()).filter(Boolean);
  const rows = jsonRows.map((raw) => {
    const out: Record<string, string> = {};
    for (const h of headers) {
      out[h] = raw[h] == null ? '' : String(raw[h]).slice(0, 500);
    }
    return out;
  });

  return { headers, rows };
}

export function parseUploadedFileBuffer(
  filename: string,
  buffer: Buffer,
  titleOverride?: string,
): ParsedRawDataset {
  const lower = filename.toLowerCase();
  const title = titleOverride?.trim() || filename.replace(/\.[^.]+$/, '') || 'Uploaded Dataset';

  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) {
    const { headers, rows } = parseCsvString(buffer.toString('utf8'));
    return {
      title,
      sourceType: 'csv',
      originalFilename: filename,
      headers,
      rows,
      detectedSchema: detectSchemaFromRows(headers, rows),
    };
  }

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const { headers, rows } = parseExcelBuffer(buffer);
    return {
      title,
      sourceType: 'xlsx',
      originalFilename: filename,
      headers,
      rows,
      detectedSchema: detectSchemaFromRows(headers, rows),
    };
  }

  throw new AppError(
    400,
    'UNSUPPORTED_FILE_TYPE',
    'Only .csv, .tsv, .xlsx, and .xls files are supported.',
  );
}
