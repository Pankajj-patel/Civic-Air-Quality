import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  FileSpreadsheet,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { POLLUTANTS, Pollutant } from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../lib/api.ts';
import {
  DatasetPreviewResponse,
  DatasetSummaryRecord,
  ServerColumnDetection,
} from '../types/datasets.ts';

interface ManualRow {
  location: string;
  recordedAt: string;
  pm25: string;
  pm10: string;
  no2: string;
  latitude: string;
  longitude: string;
}

interface UploadAndMappingViewProps {
  mode: 'upload' | 'preview';
  datasets: DatasetSummaryRecord[];
  activeDatasetId: number | null;
  onSelectDataset: (id: number) => void;
  onDatasetUploaded: (preview: DatasetPreviewResponse) => Promise<void>;
  onMappingConfirmed: (datasetId: number) => Promise<void>;
  onSwitchToPreview: () => void;
}

const UNIT_OPTIONS = ['µg/m³', 'mg/m³', 'ppb', 'ppm', 'index', 'unknown'];

export const UploadAndMappingView: React.FC<UploadAndMappingViewProps> = ({
  mode,
  datasets,
  activeDatasetId,
  onSelectDataset,
  onDatasetUploaded,
  onMappingConfirmed,
  onSwitchToPreview,
}) => {
  const [inputTab, setInputTab] = useState<'file' | 'paste' | 'manual'>('file');
  const [fileTitle, setFileTitle] = useState('');
  const [pasteTitle, setPasteTitle] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [manualRows, setManualRows] = useState<ManualRow[]>([
    { location: '', recordedAt: '', pm25: '', pm10: '', no2: '', latitude: '', longitude: '' },
  ]);

  const [previewData, setPreviewData] = useState<DatasetPreviewResponse | null>(null);
  const [columns, setColumns] = useState<ServerColumnDetection[]>([]);
  const [dateHint, setDateHint] = useState<'auto' | 'DMY' | 'MDY' | 'ISO'>('auto');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== 'preview' || !activeDatasetId) {
      return;
    }
    setLoadingPreview(true);
    setErrorMsg(null);
    apiRequest<DatasetPreviewResponse>(`/api/datasets/${activeDatasetId}/preview`)
      .then((res) => {
        setPreviewData(res);
        setColumns(res.detectedSchema.detectedColumns);
        setDateHint(res.detectedSchema.dateFormatHint || 'auto');
      })
      .catch((err) => {
        setErrorMsg(err instanceof ApiClientError ? err.message : 'Unable to load dataset preview.');
      })
      .finally(() => setLoadingPreview(false));
  }, [mode, activeDatasetId]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (fileTitle.trim()) formData.append('title', fileTitle.trim());

      const res = await apiRequest<DatasetPreviewResponse>('/api/datasets/upload', {
        method: 'POST',
        body: formData,
      });
      setPreviewData(res);
      setColumns(res.detectedSchema.detectedColumns);
      setDateHint(res.detectedSchema.dateFormatHint || 'auto');
      await onDatasetUploaded(res);
      onSwitchToPreview();
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : 'Failed to upload dataset.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handlePasteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setUploading(true);
    try {
      const res = await apiRequest<DatasetPreviewResponse>('/api/datasets/upload', {
        method: 'POST',
        body: JSON.stringify({
          title: pasteTitle.trim() || 'Pasted Air Quality Table',
          sourceType: 'paste',
          rawText: pasteText,
        }),
      });
      setPreviewData(res);
      setColumns(res.detectedSchema.detectedColumns);
      setDateHint(res.detectedSchema.dateFormatHint || 'auto');
      await onDatasetUploaded(res);
      onSwitchToPreview();
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : 'Unable to parse pasted data.');
    } finally {
      setUploading(false);
    }
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    const validRows = manualRows.filter((r) => r.location.trim() !== '');
    if (validRows.length === 0) {
      setErrorMsg('Enter at least one row with a Location / Station name.');
      return;
    }

    setUploading(true);
    try {
      const rows = validRows.map((r) => ({
        Location: r.location.trim(),
        Recorded_At: r.recordedAt.trim(),
        'PM2.5 (ug/m3)': r.pm25.trim(),
        'PM10 (ug/m3)': r.pm10.trim(),
        'NO2 (ug/m3)': r.no2.trim(),
        Latitude: r.latitude.trim(),
        Longitude: r.longitude.trim(),
      }));

      const res = await apiRequest<DatasetPreviewResponse>('/api/datasets/upload', {
        method: 'POST',
        body: JSON.stringify({
          title: manualTitle.trim() || 'Manual Air Quality Log',
          sourceType: 'manual',
          rows,
        }),
      });
      setPreviewData(res);
      setColumns(res.detectedSchema.detectedColumns);
      setDateHint(res.detectedSchema.dateFormatHint || 'auto');
      await onDatasetUploaded(res);
      onSwitchToPreview();
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : 'Unable to save manual entries.');
    } finally {
      setUploading(false);
    }
  }

  function updateColumn(index: number, patch: Partial<ServerColumnDetection>) {
    setColumns((prev) => prev.map((col, i) => (i === index ? { ...col, ...patch } : col)));
    setSuccessMsg(null);
  }

  async function handleConfirmMapping() {
    if (!previewData) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const locCol = columns.find((c) => c.suggestedRole === 'location');
    const tsCol = columns.find((c) => c.suggestedRole === 'timestamp');
    const timeCol = columns.find((c) => c.suggestedRole === 'time');
    const latCol = columns.find((c) => c.suggestedRole === 'latitude');
    const lonCol = columns.find((c) => c.suggestedRole === 'longitude');
    const pollutantCols = columns.filter(
      (c) => c.suggestedRole === 'pollutant' && c.suggestedPollutant,
    );

    if (!locCol || pollutantCols.length === 0) {
      setErrorMsg('Assign at least one Location column and one Pollutant column.');
      return;
    }

    setConfirming(true);
    try {
      await apiRequest(`/api/datasets/${previewData.dataset.id}/confirm-mapping`, {
        method: 'POST',
        body: JSON.stringify({
          locationColumn: locCol.header,
          timestampColumn: tsCol ? tsCol.header : null,
          timeColumn: timeCol ? timeCol.header : null,
          dateFormatHint: dateHint,
          latitudeColumn: latCol ? latCol.header : null,
          longitudeColumn: lonCol ? lonCol.header : null,
          pollutantColumns: pollutantCols.map((c) => ({
            sourceColumn: c.header,
            pollutant: c.suggestedPollutant!,
            sourceUnit: c.suggestedUnit || 'unknown',
          })),
        }),
      });
      await onMappingConfirmed(previewData.dataset.id);
      setSuccessMsg(
        'Dataset normalized, unit-converted, and statistically analyzed. View Hotspots or AI Analysis.',
      );
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : 'Normalization failed.');
    } finally {
      setConfirming(false);
    }
  }

  if (mode === 'upload') {
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Ingest Air Quality Dataset</h2>
              <p className="text-xs text-slate-600 mt-1">
                Original values are stored verbatim in SQLite. Missing cells remain null and all
                unit conversions are logged before statistical analysis.
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
              <button
                type="button"
                onClick={() => {
                  setInputTab('file');
                  setErrorMsg(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  inputTab === 'file'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                CSV / Excel File
              </button>
              <button
                type="button"
                onClick={() => {
                  setInputTab('paste');
                  setErrorMsg(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  inputTab === 'paste'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Paste Table
              </button>
              <button
                type="button"
                onClick={() => {
                  setInputTab('manual');
                  setErrorMsg(null);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  inputTab === 'manual'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Manual Entry
              </button>
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800"
            >
              {errorMsg}
            </div>
          )}

          {inputTab === 'file' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Dataset Title (optional — defaults to filename)
                </label>
                <input
                  type="text"
                  value={fileTitle}
                  onChange={(e) => setFileTitle(e.target.value)}
                  placeholder="e.g., Ward 14 November Monitoring Export"
                  className="w-full max-w-md px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
              <label className="block border-2 border-dashed border-slate-300 hover:border-slate-400 rounded-xl p-10 text-center cursor-pointer transition-colors bg-slate-50/50">
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls,.tsv"
                  onChange={handleFileSelect}
                  disabled={uploading}
                  className="sr-only"
                />
                <Upload className="w-7 h-7 text-slate-500 mx-auto mb-3" />
                <div className="text-sm font-medium text-slate-900">
                  {uploading ? 'Uploading and analyzing columns...' : 'Select a .csv, .xlsx, or .xls file'}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Max 10MB · Handles inconsistent headers, mixed date formats, blank cells, and
                  µg/m³ / mg/m³ / ppb / ppm units.
                </p>
              </label>
            </div>
          )}

          {inputTab === 'paste' && (
            <form onSubmit={handlePasteSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Dataset Title
                </label>
                <input
                  type="text"
                  required
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                  placeholder="e.g., Ward 14 Weekly Station Readings"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Paste CSV or Tab-Separated Table (include header row)
                </label>
                <textarea
                  rows={8}
                  required
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder={'Station,Date,PM2.5 (ug/m3),PM10,NO2\nWard 14 Gate,2026-11-10,118,195,42'}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>
              <button
                type="submit"
                disabled={uploading}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg"
              >
                <ClipboardPaste className="w-4 h-4" />
                {uploading ? 'Uploading...' : 'Upload & Preview Mapping'}
              </button>
            </form>
          )}

          {inputTab === 'manual' && (
            <form onSubmit={handleManualSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Dataset Title
                </label>
                <input
                  type="text"
                  required
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder="e.g., Campus Morning Checkpoints"
                  className="w-full max-w-md px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2.5 px-3 font-medium">Location / Station</th>
                      <th className="py-2.5 px-3 font-medium">Timestamp</th>
                      <th className="py-2.5 px-3 font-medium">PM2.5 (µg/m³)</th>
                      <th className="py-2.5 px-3 font-medium">PM10 (µg/m³)</th>
                      <th className="py-2.5 px-3 font-medium">NO2 (µg/m³)</th>
                      <th className="py-2.5 px-3 font-medium">Lat</th>
                      <th className="py-2.5 px-3 font-medium">Lon</th>
                      <th className="py-2.5 px-3 font-medium w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {manualRows.map((row, idx) => (
                      <tr key={idx}>
                        <td className="p-2">
                          <input
                            type="text"
                            required
                            value={row.location}
                            onChange={(e) =>
                              setManualRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, location: e.target.value } : r,
                                ),
                              )
                            }
                            placeholder="Main Gate"
                            className="w-full px-2 py-1.5 border border-slate-200 rounded"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.recordedAt}
                            onChange={(e) =>
                              setManualRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, recordedAt: e.target.value } : r,
                                ),
                              )
                            }
                            placeholder="2026-11-13 09:00"
                            className="w-full px-2 py-1.5 border border-slate-200 rounded font-mono"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.pm25}
                            onChange={(e) =>
                              setManualRows((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, pm25: e.target.value } : r)),
                              )
                            }
                            placeholder="84.5"
                            className="w-24 px-2 py-1.5 border border-slate-200 rounded font-mono tabular-nums"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.pm10}
                            onChange={(e) =>
                              setManualRows((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, pm10: e.target.value } : r)),
                              )
                            }
                            placeholder="142"
                            className="w-24 px-2 py-1.5 border border-slate-200 rounded font-mono tabular-nums"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.no2}
                            onChange={(e) =>
                              setManualRows((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, no2: e.target.value } : r)),
                              )
                            }
                            placeholder="38"
                            className="w-24 px-2 py-1.5 border border-slate-200 rounded font-mono tabular-nums"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.latitude}
                            onChange={(e) =>
                              setManualRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, latitude: e.target.value } : r,
                                ),
                              )
                            }
                            placeholder="28.6139"
                            className="w-24 px-2 py-1.5 border border-slate-200 rounded font-mono tabular-nums"
                          />
                        </td>
                        <td className="p-2">
                          <input
                            type="text"
                            value={row.longitude}
                            onChange={(e) =>
                              setManualRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, longitude: e.target.value } : r,
                                ),
                              )
                            }
                            placeholder="77.2090"
                            className="w-24 px-2 py-1.5 border border-slate-200 rounded font-mono tabular-nums"
                          />
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            disabled={manualRows.length <= 1}
                            onClick={() =>
                              setManualRows((prev) => prev.filter((_, i) => i !== idx))
                            }
                            aria-label="Remove row"
                            className="p-1 text-slate-400 hover:text-red-600 disabled:opacity-30"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() =>
                    setManualRows((prev) => [
                      ...prev,
                      {
                        location: '',
                        recordedAt: '',
                        pm25: '',
                        pm10: '',
                        no2: '',
                        latitude: '',
                        longitude: '',
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Row
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg"
                >
                  {uploading ? 'Saving...' : 'Save & Preview Mapping'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // Preview & Validation Mode
  if (datasets.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
        <FileSpreadsheet className="w-7 h-7 text-slate-400 mx-auto" />
        <h2 className="text-base font-semibold text-slate-900">No datasets uploaded yet</h2>
        <p className="text-xs text-slate-600 max-w-md mx-auto">
          Upload a CSV or Excel file, paste tabular data, or enter manual readings first to
          inspect auto-detected columns and run server normalization.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <label htmlFor="preview-dataset-select" className="text-xs font-medium text-slate-500">
                Dataset:
              </label>
              <select
                id="preview-dataset-select"
                value={activeDatasetId ?? ''}
                onChange={(e) => onSelectDataset(Number(e.target.value))}
                className="px-3 py-1.5 text-sm font-medium border border-slate-300 rounded-lg bg-white"
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} ({d.rowCount} rows · {d.status})
                  </option>
                ))}
              </select>
            </div>
            {previewData && (
              <p className="text-xs text-slate-500">
                Source: {previewData.dataset.sourceType.toUpperCase()} · {previewData.dataset.rowCount} rows ·{' '}
                {previewData.detectedSchema.headers.length} columns
              </p>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <select
              aria-label="Date Format Hint"
              value={dateHint}
              onChange={(e) => setDateHint(e.target.value as 'auto' | 'DMY' | 'MDY' | 'ISO')}
              className="px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
            >
              <option value="auto">Date Format: Auto</option>
              <option value="DMY">Date Format: DD/MM/YYYY</option>
              <option value="MDY">Date Format: MM/DD/YYYY</option>
              <option value="ISO">Date Format: ISO-8601</option>
            </select>
            <button
              type="button"
              disabled={confirming || !previewData}
              onClick={handleConfirmMapping}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
            >
              <CheckCircle2 className="w-4 h-4" />
              {confirming ? 'Normalizing & Analyzing...' : 'Confirm & Normalize Dataset'}
            </button>
          </div>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800"
          >
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 text-xs text-emerald-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {successMsg}
          </div>
        )}

        {loadingPreview ? (
          <div className="py-8 text-center text-xs text-slate-500">Loading preview...</div>
        ) : (
          previewData && (
            <>
              {previewData.detectedSchema.warnings.length > 0 && (
                <div className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/70 space-y-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Ingestion Warnings
                  </div>
                  <ul className="text-xs text-amber-900 pl-6 list-disc space-y-0.5">
                    {previewData.detectedSchema.warnings.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="py-2.5 px-3 font-medium">Source Header</th>
                      <th className="py-2.5 px-3 font-medium">Role</th>
                      <th className="py-2.5 px-3 font-medium">Pollutant</th>
                      <th className="py-2.5 px-3 font-medium">Source Unit</th>
                      <th className="py-2.5 px-3 font-medium text-right">Missing</th>
                      <th className="py-2.5 px-3 font-medium">Sample Values</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {columns.map((col, idx) => (
                      <tr key={col.header} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3 font-medium text-slate-900 font-mono">
                          {col.header}
                        </td>
                        <td className="py-2.5 px-3">
                          <select
                            value={col.suggestedRole}
                            onChange={(e) =>
                              updateColumn(idx, {
                                suggestedRole: e.target.value as ServerColumnDetection['suggestedRole'],
                              })
                            }
                            className="px-2 py-1 border border-slate-200 rounded bg-white"
                          >
                            <option value="location">Location / Station</option>
                            <option value="timestamp">Date / Timestamp</option>
                            <option value="time">Time Only</option>
                            <option value="latitude">Latitude</option>
                            <option value="longitude">Longitude</option>
                            <option value="pollutant">Pollutant Reading</option>
                            <option value="ignore">Ignore Column</option>
                          </select>
                        </td>
                        <td className="py-2.5 px-3">
                          {col.suggestedRole === 'pollutant' ? (
                            <select
                              value={col.suggestedPollutant || 'PM25'}
                              onChange={(e) =>
                                updateColumn(idx, {
                                  suggestedPollutant: e.target.value as Pollutant,
                                })
                              }
                              className="px-2 py-1 border border-slate-200 rounded bg-white font-mono"
                            >
                              {POLLUTANTS.map((p) => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {col.suggestedRole === 'pollutant' ? (
                            <select
                              value={col.suggestedUnit}
                              onChange={(e) => updateColumn(idx, { suggestedUnit: e.target.value })}
                              className="px-2 py-1 border border-slate-200 rounded bg-white"
                            >
                              {UNIT_OPTIONS.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700">
                          {col.missingCount}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 font-mono truncate max-w-xs">
                          {col.sampleValues.length > 0 ? col.sampleValues.join(', ') : 'Empty'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </div>

      {previewData && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900">
            Preserved Raw Records (First {previewData.previewRows.length} of{' '}
            {previewData.dataset.rowCount} Rows)
          </h3>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2 px-3 font-medium w-12">#</th>
                  {previewData.detectedSchema.headers.map((h) => (
                    <th key={h} className="py-2 px-3 font-medium whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewData.previewRows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-slate-50/70">
                    <td className="py-2 px-3 font-mono tabular-nums text-slate-400">{rIdx + 1}</td>
                    {previewData.detectedSchema.headers.map((h) => (
                      <td
                        key={h}
                        className="py-2 px-3 font-mono tabular-nums text-slate-800 whitespace-nowrap"
                      >
                        {row[h] === '' ? (
                          <span className="text-slate-400 italic">null</span>
                        ) : (
                          row[h]
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
