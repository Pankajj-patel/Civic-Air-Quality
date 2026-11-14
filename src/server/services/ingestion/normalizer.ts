import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../../db/index.ts';
import {
  datasetMappings,
  datasets,
  monitoringStations,
  normalizedReadings,
  rawRecords,
} from '../../../db/schema.ts';
import { confirmMappingSchema } from '../../../shared/schemas/index.ts';
import {
  CANONICAL_UNITS,
  STANDARD_THRESHOLDS,
  convertToCanonicalUnit,
} from '../../../shared/standards/aqiStandards.ts';
import { AqiStandard, Pollutant, QcFlag } from '../../../shared/types.ts';

export type ConfirmedMapping = z.infer<typeof confirmMappingSchema>;

function sanitizeLabelText(input: string): string {
  return input
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, 120);
}

function parseFlexibleTimestamp(
  dateRaw: string,
  timeRaw: string | null,
  hint: 'auto' | 'DMY' | 'MDY' | 'ISO',
): { iso: string | null; log: string | null } {
  const combined = [dateRaw.trim(), timeRaw?.trim() || ''].filter(Boolean).join(' ').trim();
  if (!combined) return { iso: null, log: null };

  // ISO-like YYYY-MM-DD[T ]HH:mm(:ss)?
  const isoMatch = combined.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (isoMatch) {
    const [, y, m, d, hh = '00', mm = '00', ss = '00'] = isoMatch;
    const dt = new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)),
    );
    if (!Number.isNaN(dt.getTime())) {
      return { iso: dt.toISOString(), log: null };
    }
  }

  // DD/MM/YYYY or MM/DD/YYYY with optional time
  const slashMatch = combined.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?$/i,
  );
  if (slashMatch) {
    const p1 = Number(slashMatch[1]);
    const p2 = Number(slashMatch[2]);
    let year = Number(slashMatch[3]);
    if (year < 100) year += 2000;

    let hour = Number(slashMatch[4] ?? 0);
    const min = Number(slashMatch[5] ?? 0);
    const sec = Number(slashMatch[6] ?? 0);
    const ampm = slashMatch[7]?.toUpperCase();
    if (ampm === 'PM' && hour < 12) hour += 12;
    if (ampm === 'AM' && hour === 12) hour = 0;

    let day = p1;
    let month = p2;
    if (hint === 'MDY' || (hint === 'auto' && p2 > 12 && p1 <= 12)) {
      month = p1;
      day = p2;
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const dt = new Date(Date.UTC(year, month - 1, day, hour, min, sec));
      if (!Number.isNaN(dt.getTime())) {
        return {
          iso: dt.toISOString(),
          log: `Parsed ${hint === 'MDY' ? 'MM/DD/YYYY' : 'DD/MM/YYYY'} timestamp`,
        };
      }
    }
  }

  // Fallback native Date parse
  const parsedMs = Date.parse(combined);
  if (!Number.isNaN(parsedMs)) {
    return { iso: new Date(parsedMs).toISOString(), log: 'Parsed native date string to UTC' };
  }

  return { iso: null, log: `Unparseable timestamp: "${combined}"` };
}

function parsePollutantCell(
  rawCell: string,
  columnUnit: string,
  pollutant: Pollutant,
  standard: AqiStandard,
): {
  value: number | null;
  unitUsed: string;
  canonicalUnit: string;
  qcFlag: QcFlag;
  logs: string[];
} {
  const trimmed = rawCell.trim();
  const canonicalUnit = CANONICAL_UNITS[pollutant];
  const logs: string[] = [];

  if (trimmed === '' || /^(na|n\/a|null|none|-|--|bdl|nan)$/i.test(trimmed)) {
    return { value: null, unitUsed: columnUnit, canonicalUnit, qcFlag: 'missing', logs };
  }

  // Extract optional inline unit suffix like "84.5 µg/m³" or "0.08 mg/m3"
  const inlineMatch = trimmed.match(/^([+-]?\d+(?:\.\d+)?)\s*([a-zA-Zµ/%³3]+)?$/);
  let numericVal: number;
  let effectiveUnit = columnUnit;

  if (inlineMatch) {
    numericVal = Number(inlineMatch[1]);
    if (inlineMatch[2]) {
      effectiveUnit = inlineMatch[2];
      logs.push(`Extracted inline unit "${inlineMatch[2]}"`);
    }
  } else {
    // Strip thousands commas (e.g. "1,240.5")
    const stripped = trimmed.replace(/,/g, '');
    if (/^[+-]?\d+(?:\.\d+)?$/.test(stripped)) {
      numericVal = Number(stripped);
    } else {
      return {
        value: null,
        unitUsed: effectiveUnit,
        canonicalUnit,
        qcFlag: 'invalid_format',
        logs: [`Rejected non-numeric value "${trimmed}"`],
      };
    }
  }

  if (!Number.isFinite(numericVal)) {
    return {
      value: null,
      unitUsed: effectiveUnit,
      canonicalUnit,
      qcFlag: 'invalid_format',
      logs: [`Non-finite numeric value "${trimmed}"`],
    };
  }

  if (numericVal < 0) {
    return {
      value: null,
      unitUsed: effectiveUnit,
      canonicalUnit,
      qcFlag: 'negative_rejected',
      logs: [`Rejected negative concentration (${numericVal})`],
    };
  }

  const converted = convertToCanonicalUnit(numericVal, pollutant, effectiveUnit);
  if (converted.log) logs.push(converted.log);

  const ceiling = STANDARD_THRESHOLDS[standard][pollutant].physicalCeiling;
  if (converted.value > ceiling) {
    return {
      value: converted.value,
      unitUsed: effectiveUnit,
      canonicalUnit: converted.canonicalUnit,
      qcFlag: 'suspect_outlier',
      logs: [...logs, `Exceeds physical sensor ceiling (${ceiling} ${converted.canonicalUnit})`],
    };
  }

  return {
    value: converted.value,
    unitUsed: effectiveUnit,
    canonicalUnit: converted.canonicalUnit,
    qcFlag: 'valid',
    logs,
  };
}

export async function normalizeDatasetRecords(params: {
  organizationId: number;
  datasetId: number;
  userId: number;
  aqiStandard: AqiStandard;
  mapping: ConfirmedMapping;
}): Promise<{
  totalNormalizedRows: number;
  minTimestamp: string | null;
  maxTimestamp: string | null;
}> {
  const { organizationId, datasetId, userId, aqiStandard, mapping } = params;

  const rawList = await db
    .select()
    .from(rawRecords)
    .where(eq(rawRecords.datasetId, datasetId));

  const stationCache = new Map<string, number>();
  const seenKeys = new Set<string>();
  const toInsert: Array<typeof normalizedReadings.$inferInsert> = [];

  let minTs: string | null = null;
  let maxTs: string | null = null;

  db.transaction((tx) => {
    // Clear previous normalization artifacts if mapping is re-confirmed
    tx.delete(normalizedReadings).where(eq(normalizedReadings.datasetId, datasetId)).run();

    tx.update(datasetMappings)
      .set({
        confirmedMappingJson: JSON.stringify(mapping),
        approvedBy: userId,
        approvedAt: new Date().toISOString(),
      })
      .where(eq(datasetMappings.datasetId, datasetId))
      .run();

    for (const rawRec of rawList) {
      const row = JSON.parse(rawRec.rawPayloadJson) as Record<string, string>;
      const rawLocation = String(row[mapping.locationColumn] ?? '').trim();
      const locationName = sanitizeLabelText(rawLocation) || 'Unspecified Station';

      let latitude: number | null = null;
      let longitude: number | null = null;
      if (mapping.latitudeColumn && mapping.longitudeColumn) {
        const lat = Number(row[mapping.latitudeColumn]);
        const lon = Number(row[mapping.longitudeColumn]);
        if (
          Number.isFinite(lat) &&
          Number.isFinite(lon) &&
          lat >= -90 &&
          lat <= 90 &&
          lon >= -180 &&
          lon <= 180 &&
          (lat !== 0 || lon !== 0)
        ) {
          latitude = lat;
          longitude = lon;
        }
      }

      let stationId = stationCache.get(locationName);
      if (!stationId) {
        const existingStation = tx
          .select()
          .from(monitoringStations)
          .where(
            and(
              eq(monitoringStations.organizationId, organizationId),
              eq(monitoringStations.name, locationName),
            ),
          )
          .limit(1)
          .get();

        if (existingStation) {
          stationId = existingStation.id;
          if (
            latitude !== null &&
            longitude !== null &&
            (existingStation.latitude === null || existingStation.longitude === null)
          ) {
            tx.update(monitoringStations)
              .set({ latitude, longitude })
              .where(eq(monitoringStations.id, stationId))
              .run();
          }
        } else {
          const created = tx
            .insert(monitoringStations)
            .values({
              organizationId,
              name: locationName,
              latitude,
              longitude,
              zoneType: 'unknown',
            })
            .returning({ id: monitoringStations.id })
            .get();
          stationId = created.id;
        }
        stationCache.set(locationName, stationId);
      }

      let recordedAt: string | null = null;
      let tsLog: string | null = null;
      let hasUnparseableTs = false;
      if (mapping.timestampColumn) {
        const dateCell = String(row[mapping.timestampColumn] ?? '').trim();
        const timeCell = mapping.timeColumn ? String(row[mapping.timeColumn] ?? '').trim() : null;
        if (dateCell !== '') {
          const parsedTs = parseFlexibleTimestamp(dateCell, timeCell, mapping.dateFormatHint);
          recordedAt = parsedTs.iso;
          tsLog = parsedTs.log;
          if (!recordedAt) {
            hasUnparseableTs = true;
          } else {
            if (!minTs || recordedAt < minTs) minTs = recordedAt;
            if (!maxTs || recordedAt > maxTs) maxTs = recordedAt;
          }
        }
      }

      for (const pMap of mapping.pollutantColumns) {
        const rawCell = String(row[pMap.sourceColumn] ?? '');
        const parsed = parsePollutantCell(
          rawCell,
          pMap.sourceUnit,
          pMap.pollutant,
          aqiStandard,
        );

        let qcFlag: QcFlag = parsed.qcFlag;
        const logs = [...parsed.logs];
        if (tsLog) logs.push(tsLog);

        if (hasUnparseableTs && qcFlag === 'valid') {
          qcFlag = 'unparseable_timestamp';
        }

        // Duplicate suppression only on valid timestamped readings
        if (qcFlag === 'valid' && recordedAt) {
          const dedupKey = `${locationName}|${recordedAt}|${pMap.pollutant}`;
          if (seenKeys.has(dedupKey)) {
            qcFlag = 'duplicate_suppressed';
            logs.push('Duplicate reading for same location, timestamp, and pollutant suppressed');
          } else {
            seenKeys.add(dedupKey);
          }
        }

        toInsert.push({
          organizationId,
          datasetId,
          rawRecordId: rawRec.id,
          stationId,
          locationName,
          latitude,
          longitude,
          recordedAt,
          pollutant: pMap.pollutant,
          originalValue: rawCell,
          originalUnit: parsed.unitUsed,
          normalizedValue: parsed.value,
          canonicalUnit: parsed.canonicalUnit,
          qcFlag,
          transformationLogJson: JSON.stringify(logs),
        });
      }
    }

    // Batch insert chunks of 250 for SQLite efficiency
    const CHUNK = 250;
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      tx.insert(normalizedReadings).values(toInsert.slice(i, i + CHUNK)).run();
    }

    tx.update(datasets)
      .set({
        status: 'ready',
        timeRangeStart: minTs,
        timeRangeEnd: maxTs,
        errorMessage: null,
      })
      .where(eq(datasets.id, datasetId))
      .run();
  });

  return {
    totalNormalizedRows: toInsert.length,
    minTimestamp: minTs,
    maxTimestamp: maxTs,
  };
}
