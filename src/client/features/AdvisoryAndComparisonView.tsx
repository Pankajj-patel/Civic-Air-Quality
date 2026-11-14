import React, { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, CheckCircle2, GitCompare, Megaphone, Sparkles } from 'lucide-react';
import {
  READING_LEVELS,
  ReadingLevel,
  SUPPORTED_LANGUAGES,
  SupportedLanguage,
} from '../../shared/types.ts';
import { ApiClientError, apiRequest } from '../lib/api.ts';
import { BriefingSummaryItem, FullBriefingRecord } from '../types/briefings.ts';

interface ComparisonResult {
  id: number;
  currentBriefingId: number;
  previousBriefingId: number;
  isComparable: boolean;
  incomparabilityReasons: string[];
  summaryNarrative: string;
  deltaMetrics: {
    pollutantDeltas: Array<{
      pollutant: string;
      unit: string;
      prevMean: number;
      currMean: number;
      deltaAbs: number;
      deltaPct: number;
      direction: 'improved' | 'deteriorated' | 'unchanged';
    }>;
    locationDeltas: Array<{
      locationName: string;
      pollutant: string;
      prevMean: number;
      currMean: number;
      deltaPct: number;
      direction: 'improved' | 'deteriorated' | 'unchanged';
    }>;
    newHotspots: string[];
    resolvedHotspots: string[];
    newlyAvailableLocations: string[];
    missingLocations: string[];
    dataQualityDelta: {
      prevCompletenessPct: number;
      currCompletenessPct: number;
      deltaPct: number;
    };
    previousRecommendations: Array<{
      id: number;
      title: string;
      urgency: string;
      status: string;
    }>;
  };
}

interface AdvisoryAndComparisonViewProps {
  mode: 'advisories' | 'comparisons';
  briefings: BriefingSummaryItem[];
  activeBriefing: FullBriefingRecord | null;
  onRefreshBriefing: (id: number) => Promise<void>;
}

const READING_LEVEL_LABELS: Record<ReadingLevel, string> = {
  simple: 'Simple (General Public)',
  standard: 'Standard (Community)',
  detailed: 'Detailed (Informed Readers)',
};

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  en: 'English',
  hi: 'Hindi (हिन्दी)',
};

export const AdvisoryAndComparisonView: React.FC<AdvisoryAndComparisonViewProps> = ({
  mode,
  briefings,
  activeBriefing,
  onRefreshBriefing,
}) => {
  const [readingLevel, setReadingLevel] = useState<ReadingLevel>('simple');
  const [language, setLanguage] = useState<SupportedLanguage>('en');
  const [generating, setGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [currentBriefId, setCurrentBriefId] = useState<number>(
    activeBriefing?.id ?? briefings[0]?.id ?? 0,
  );
  const [previousBriefId, setPreviousBriefId] = useState<number>(briefings[1]?.id ?? 0);
  const [comparing, setComparing] = useState(false);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);

  async function handleGenerateAdvisory() {
    if (!activeBriefing) return;
    setGenerating(true);
    setErrorMsg(null);
    try {
      await apiRequest(`/api/briefings/${activeBriefing.id}/advisories`, {
        method: 'POST',
        body: JSON.stringify({
          readingLevel,
          languages: ['en', 'hi'],
        }),
      });
      await onRefreshBriefing(activeBriefing.id);
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : 'Unable to generate advisory.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleRunComparison(e: React.FormEvent) {
    e.preventDefault();
    if (!currentBriefId || !previousBriefId) return;
    setComparing(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<{ comparison: ComparisonResult }>('/api/comparisons', {
        method: 'POST',
        body: JSON.stringify({
          currentBriefingId: currentBriefId,
          previousBriefingId: previousBriefId,
        }),
      });
      setComparison(res.comparison);
    } catch (err) {
      setErrorMsg(err instanceof ApiClientError ? err.message : 'Comparison failed.');
    } finally {
      setComparing(false);
    }
  }

  if (mode === 'advisories') {
    const matchedAdvisory = activeBriefing?.advisories.find(
      (a) => a.readingLevel === readingLevel && a.language === language,
    );

    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Multilingual Citizen Advisory Studio
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Accessible public health communication tailored by reading level without
                unsupported medical claims.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {READING_LEVELS.map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setReadingLevel(lvl)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      readingLevel === lvl
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {READING_LEVEL_LABELS[lvl]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setLanguage(lang)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      language === lang
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {LANGUAGE_LABELS[lang]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {activeBriefing && (
            <div className="p-4 rounded-lg border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-xs text-slate-700">
                Active Briefing: <strong className="text-slate-900">{activeBriefing.title}</strong>
              </div>
              <button
                type="button"
                disabled={generating}
                onClick={handleGenerateAdvisory}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {generating
                  ? 'Generating EN & HI Advisories...'
                  : `Generate ${READING_LEVEL_LABELS[readingLevel]} (EN + HI)`}
              </button>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800"
            >
              {errorMsg}
            </div>
          )}

          {!activeBriefing ? (
            <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center space-y-2">
              <Megaphone className="w-6 h-6 text-slate-400 mx-auto" />
              <div className="text-sm font-medium text-slate-800">No briefing selected</div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Generate an internal briefing first to produce safety-checked English and Hindi
                public advisories across all three reading levels.
              </p>
            </div>
          ) : !matchedAdvisory ? (
            <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center space-y-2">
              <Megaphone className="w-6 h-6 text-slate-400 mx-auto" />
              <div className="text-sm font-medium text-slate-800">
                No {LANGUAGE_LABELS[language]} advisory generated for {readingLevel} reading level
              </div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Click the Generate button above to create synchronized English and Hindi public
                advisories for this reading level.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="border border-slate-200 rounded-xl p-6 space-y-3 bg-white">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span>
                    {LANGUAGE_LABELS[language]} · {READING_LEVEL_LABELS[readingLevel]}
                  </span>
                  {matchedAdvisory.safetyCheckPassed && (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Safety check verified
                    </span>
                  )}
                </div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {matchedAdvisory.headline}
                </h3>
                <p className="text-sm text-slate-700 leading-relaxed">
                  {matchedAdvisory.currentConditionSummary}
                </p>
                <div className="pt-2 border-t border-slate-100 text-xs text-slate-700 leading-relaxed">
                  <strong className="text-slate-900">General Health Context: </strong>
                  {matchedAdvisory.healthGuidance}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-900">Children</div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {matchedAdvisory.childrenGuidance}
                  </p>
                </div>
                <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-900">Older Adults</div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {matchedAdvisory.olderAdultsGuidance}
                  </p>
                </div>
                <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-900">
                    Sensitive Groups (Asthma / Heart / Lung)
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {matchedAdvisory.sensitiveGroupsGuidance}
                  </p>
                </div>
                <div className="border border-slate-200 rounded-xl p-4 space-y-1.5">
                  <div className="text-xs font-semibold text-slate-900">
                    Outdoor Activity Guidance
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {matchedAdvisory.outdoorActivityGuidance}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Historical Comparisons Mode
  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            Previous Briefing Comparison &amp; Delta Tracking
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Validates pollutant, canonical unit, geographic, and time-window compatibility before
            computing improvement/deterioration metrics.
          </p>
        </div>

        {briefings.length < 2 ? (
          <div className="border border-dashed border-slate-300 rounded-xl p-10 text-center space-y-2">
            <GitCompare className="w-6 h-6 text-slate-400 mx-auto" />
            <div className="text-sm font-medium text-slate-800">
              At least two briefings are required for comparison
            </div>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Upload a second reporting cycle dataset and generate a briefing to compare changes
              over time.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleRunComparison}
            className="p-4 rounded-lg border border-slate-200 bg-slate-50 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
          >
            <div className="md:col-span-5">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Current Briefing
              </label>
              <select
                value={currentBriefId}
                onChange={(e) => setCurrentBriefId(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                {briefings.map((b) => (
                  <option key={b.id} value={b.id}>
                    #{b.id} — {b.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-5">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Previous Baseline Briefing
              </label>
              <select
                value={previousBriefId}
                onChange={(e) => setPreviousBriefId(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                {briefings.map((b) => (
                  <option key={b.id} value={b.id}>
                    #{b.id} — {b.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={comparing || !currentBriefId || !previousBriefId}
                className="w-full px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg"
              >
                {comparing ? 'Comparing...' : 'Compare'}
              </button>
            </div>
          </form>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800"
          >
            {errorMsg}
          </div>
        )}

        {comparison && (
          <div className="space-y-5">
            {!comparison.isComparable ? (
              <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-900">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Datasets Not Directly Comparable
                </div>
                <p className="text-xs text-amber-900">{comparison.summaryNarrative}</p>
                <ul className="list-disc pl-5 text-xs text-amber-900 space-y-1">
                  {comparison.incomparabilityReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 leading-relaxed">
                  {comparison.summaryNarrative}
                </div>

                {comparison.deltaMetrics.pollutantDeltas.length > 0 && (
                  <div className="h-64 w-full border border-slate-200 rounded-xl p-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={comparison.deltaMetrics.pollutantDeltas}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis dataKey="pollutant" tick={{ fontSize: 11, fill: '#475569' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                        <Tooltip />
                        <Bar dataKey="prevMean" name="Previous Mean" fill="#94A3B8" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="currMean" name="Current Mean" fill="#0F172A" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="border border-slate-200 rounded-xl p-4 space-y-1">
                    <div className="font-semibold text-slate-900">New Hotspots</div>
                    <p className="text-slate-600">
                      {comparison.deltaMetrics.newHotspots.length > 0
                        ? comparison.deltaMetrics.newHotspots.join(', ')
                        : 'None'}
                    </p>
                  </div>
                  <div className="border border-slate-200 rounded-xl p-4 space-y-1">
                    <div className="font-semibold text-slate-900">Resolved Hotspots</div>
                    <p className="text-slate-600">
                      {comparison.deltaMetrics.resolvedHotspots.length > 0
                        ? comparison.deltaMetrics.resolvedHotspots.join(', ')
                        : 'None'}
                    </p>
                  </div>
                  <div className="border border-slate-200 rounded-xl p-4 space-y-1">
                    <div className="font-semibold text-slate-900">Data Completeness Delta</div>
                    <p className="font-mono tabular-nums text-slate-700">
                      {comparison.deltaMetrics.dataQualityDelta.prevCompletenessPct}% →{' '}
                      {comparison.deltaMetrics.dataQualityDelta.currCompletenessPct}% (
                      {comparison.deltaMetrics.dataQualityDelta.deltaPct >= 0 ? '+' : ''}
                      {comparison.deltaMetrics.dataQualityDelta.deltaPct}%)
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
