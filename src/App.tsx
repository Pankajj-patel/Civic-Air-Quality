import React, { useEffect, useState } from 'react';
import { Wind } from 'lucide-react';
import { LayoutShell, WorkspaceSection } from './client/components/LayoutShell.tsx';
import { AdvisoryAndComparisonView } from './client/features/AdvisoryAndComparisonView.tsx';
import { AnalysisAndHotspotsView } from './client/features/AnalysisAndHotspotsView.tsx';
import { DashboardView } from './client/features/DashboardView.tsx';
import { OrgSettingsView } from './client/features/OrgSettingsView.tsx';
import { RecommendationsAndBriefingsView } from './client/features/RecommendationsAndBriefingsView.tsx';
import { UploadAndMappingView } from './client/features/UploadAndMappingView.tsx';
import {
  ApiClientError,
  apiRequest,
  getStoredActiveOrgId,
  getStoredToken,
  setStoredActiveOrgId,
  setStoredToken,
} from './client/lib/api.ts';
import { BriefingSummaryItem, FullBriefingRecord } from './client/types/briefings.ts';
import {
  DatasetStatsResponse,
  DatasetSummaryRecord,
  HotspotRecord,
} from './client/types/datasets.ts';
import { AuthUserSummary, OrgType, ORG_TYPES, StakeholderType } from './shared/types.ts';

const ORG_TYPE_LABELS: Record<OrgType, string> = {
  municipality: 'Municipal Ward / Authority',
  housing_society: 'Housing Society',
  school: 'School / Campus',
  ngo: 'Community Organization',
};

export default function App() {
  const [user, setUser] = useState<AuthUserSummary | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<number | null>(getStoredActiveOrgId());
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('dashboard');

  const [datasets, setDatasets] = useState<DatasetSummaryRecord[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState<number | null>(null);
  const [datasetStats, setDatasetStats] = useState<DatasetStatsResponse | null>(null);
  const [hotspots, setHotspots] = useState<HotspotRecord[]>([]);

  const [briefings, setBriefings] = useState<BriefingSummaryItem[]>([]);
  const [activeBriefing, setActiveBriefing] = useState<FullBriefingRecord | null>(null);
  const [generatingBriefing, setGeneratingBriefing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [orgType, setOrgType] = useState<OrgType>('municipality');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function loadBriefingsForOrg(preferredBriefingId?: number | null) {
    try {
      const res = await apiRequest<{ briefings: BriefingSummaryItem[] }>('/api/briefings');
      setBriefings(res.briefings);
      const nextBId =
        preferredBriefingId && res.briefings.some((b) => b.id === preferredBriefingId)
          ? preferredBriefingId
          : res.briefings[0]?.id ?? null;
      if (nextBId) {
        const full = await apiRequest<{ briefing: FullBriefingRecord }>(
          `/api/briefings/${nextBId}`,
        );
        setActiveBriefing(full.briefing);
      } else {
        setActiveBriefing(null);
      }
    } catch {
      setBriefings([]);
      setActiveBriefing(null);
    }
  }

  async function loadDatasetsForOrg(preferredId?: number | null) {
    try {
      const res = await apiRequest<{ datasets: DatasetSummaryRecord[] }>('/api/datasets');
      setDatasets(res.datasets);
      const nextId =
        preferredId && res.datasets.some((d) => d.id === preferredId)
          ? preferredId
          : res.datasets[0]?.id ?? null;
      setActiveDatasetId(nextId);
      if (nextId) {
        const ds = res.datasets.find((d) => d.id === nextId);
        if (ds?.status === 'ready') {
          await loadDatasetAnalytics(nextId);
        } else {
          setDatasetStats(null);
          setHotspots([]);
        }
      } else {
        setDatasetStats(null);
        setHotspots([]);
      }
    } catch {
      setDatasets([]);
      setActiveDatasetId(null);
      setDatasetStats(null);
      setHotspots([]);
    }
  }

  async function loadDatasetAnalytics(datasetId: number) {
    try {
      const [statsRes, hotspotsRes] = await Promise.all([
        apiRequest<DatasetStatsResponse>(`/api/datasets/${datasetId}/stats`),
        apiRequest<{ hotspots: HotspotRecord[] }>(`/api/datasets/${datasetId}/hotspots`),
      ]);
      setDatasetStats(statsRes);
      setHotspots(hotspotsRes.hotspots);
    } catch {
      setDatasetStats(null);
      setHotspots([]);
    }
  }

  async function refreshProfile() {
    const { user: loaded } = await apiRequest<{ user: AuthUserSummary }>('/api/auth/me');
    setUser(loaded);
    const currentStored = getStoredActiveOrgId();
    const resolvedOrg =
      loaded.memberships.find((m) => m.organizationId === currentStored)?.organizationId ??
      loaded.memberships[0]?.organizationId ??
      null;
    setActiveOrgId(resolvedOrg);
    setStoredActiveOrgId(resolvedOrg);
    if (resolvedOrg) {
      await Promise.all([loadDatasetsForOrg(), loadBriefingsForOrg()]);
    }
  }

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }
    refreshProfile()
      .catch(() => {
        setStoredToken(null);
        setStoredActiveOrgId(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSelectDataset(datasetId: number) {
    setActiveDatasetId(datasetId);
    const ds = datasets.find((d) => d.id === datasetId);
    if (ds?.status === 'ready') {
      await loadDatasetAnalytics(datasetId);
    } else {
      setDatasetStats(null);
      setHotspots([]);
    }
  }

  async function handleSelectBriefing(briefingId: number) {
    const full = await apiRequest<{ briefing: FullBriefingRecord }>(
      `/api/briefings/${briefingId}`,
    );
    setActiveBriefing(full.briefing);
  }

  async function handleGenerateBriefing(stakeholderType: StakeholderType, title?: string) {
    if (!activeDatasetId) return;
    setAiError(null);
    setGeneratingBriefing(true);
    try {
      const res = await apiRequest<{ briefing: FullBriefingRecord }>('/api/briefings/generate', {
        method: 'POST',
        body: JSON.stringify({
          datasetId: activeDatasetId,
          stakeholderType,
          title,
        }),
      });
      setActiveBriefing(res.briefing);
      await loadBriefingsForOrg(res.briefing.id);
    } catch (err) {
      setAiError(
        err instanceof ApiClientError ? err.message : 'Unable to generate AI briefing.',
      );
    } finally {
      setGeneratingBriefing(false);
    }
  }

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);

    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const payload =
        mode === 'register'
          ? { email, password, fullName, organizationName, orgType }
          : { email, password };

      const res = await apiRequest<{ token: string; user: AuthUserSummary }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setStoredToken(res.token);
      setUser(res.user);
      const firstOrg = res.user.memberships[0]?.organizationId ?? null;
      setActiveOrgId(firstOrg);
      setStoredActiveOrgId(firstOrg);
      setActiveSection('dashboard');
      if (firstOrg) {
        await Promise.all([loadDatasetsForOrg(), loadBriefingsForOrg()]);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof ApiClientError ? err.message : 'Unable to complete authentication.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleLogout() {
    setStoredToken(null);
    setStoredActiveOrgId(null);
    setUser(null);
    setActiveOrgId(null);
    setDatasets([]);
    setActiveDatasetId(null);
    setDatasetStats(null);
    setHotspots([]);
    setBriefings([]);
    setActiveBriefing(null);
  }

  async function handleSwitchOrg(orgId: number) {
    setActiveOrgId(orgId);
    setStoredActiveOrgId(orgId);
    await Promise.all([loadDatasetsForOrg(), loadBriefingsForOrg()]);
  }

  const activeMembership =
    user?.memberships.find((m) => m.organizationId === activeOrgId) ?? user?.memberships[0] ?? null;
  const activeDataset = datasets.find((d) => d.id === activeDatasetId) ?? null;

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-8 space-y-4">
          <div className="h-5 w-48 bg-slate-200 rounded animate-pulse" />
          <div className="h-4 w-full bg-slate-100 rounded animate-pulse" />
          <div className="h-10 w-full bg-slate-100 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (!user || !activeMembership) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between gap-8">
          <span className="text-lg font-semibold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            Civic Air Quality Briefing Studio
          </span>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0">
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setErrorMsg(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'register'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Create Workspace
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setErrorMsg(null);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'login'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            <section className="lg:col-span-5 bg-slate-900 text-slate-50 rounded-xl p-8 flex flex-col justify-between">
              <div className="space-y-4">
                <Wind className="w-7 h-7 text-teal-400" />
                <h1 className="text-2xl font-semibold tracking-tight text-balance">
                  Evidence-grounded air quality intelligence for civic teams
                </h1>
                <p className="text-sm text-slate-300 leading-relaxed">
                  Normalize heterogeneous sensor exports, score concentration hotspots transparently,
                  and generate verifiable briefings and multilingual citizen advisories.
                </p>
              </div>
              <div className="pt-8 border-t border-slate-800 space-y-2 text-xs text-slate-300">
                <p>Supported stakeholders: Municipal Ward Officers · Housing Societies · Schools</p>
                <p>Default standard: CPCB NAQI (WHO 2021 &amp; US EPA configurable)</p>
              </div>
            </section>

            <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-8">
              <h2 className="text-xl font-semibold text-slate-900">
                {mode === 'register' ? 'Register Civic Organization' : 'Sign In to Workspace'}
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                {mode === 'register'
                  ? 'Create an organization account with isolated data storage and role-based access.'
                  : 'Enter your credentials to open your civic intelligence workspace.'}
              </p>

              {errorMsg && (
                <div
                  role="alert"
                  className="mt-4 p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800"
                >
                  {errorMsg}
                </div>
              )}

              <form onSubmit={handleAuthSubmit} className="mt-6 space-y-4">
                {mode === 'register' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1.5">
                        Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="e.g., Priya Sharma"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1.5">
                          Organization Name
                        </label>
                        <input
                          type="text"
                          required
                          value={organizationName}
                          onChange={(e) => setOrganizationName(e.target.value)}
                          placeholder="e.g., Ward 14 Civic Cell"
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1.5">
                          Stakeholder Type
                        </label>
                        <select
                          value={orgType}
                          onChange={(e) => setOrgType(e.target.value as OrgType)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                        >
                          {ORG_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {ORG_TYPE_LABELS[type]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Work Email
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="officer@municipality.gov"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Password
                  </label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-lg transition-colors"
                >
                  {submitting
                    ? 'Processing...'
                    : mode === 'register'
                      ? 'Create Organization & Sign In'
                      : 'Sign In'}
                </button>
              </form>
            </section>
          </div>
        </main>
      </div>
    );
  }

  return (
    <LayoutShell
      user={user}
      activeMembership={activeMembership}
      activeSection={activeSection}
      onSelectSection={setActiveSection}
      onSwitchOrg={handleSwitchOrg}
      onLogout={handleLogout}
    >
      {activeSection === 'dashboard' && (
        <DashboardView
          activeMembership={activeMembership}
          datasets={datasets}
          activeDataset={activeDataset}
          datasetStats={datasetStats}
          hotspots={hotspots}
          onNavigate={setActiveSection}
        />
      )}

      {(activeSection === 'upload' || activeSection === 'preview') && (
        <UploadAndMappingView
          mode={activeSection}
          datasets={datasets}
          activeDatasetId={activeDatasetId}
          onSelectDataset={handleSelectDataset}
          onDatasetUploaded={async (preview) => {
            await loadDatasetsForOrg(preview.dataset.id);
          }}
          onMappingConfirmed={async (datasetId) => {
            await loadDatasetsForOrg(datasetId);
          }}
          onSwitchToPreview={() => setActiveSection('preview')}
        />
      )}

      {(activeSection === 'analysis' || activeSection === 'hotspots') && (
        <AnalysisAndHotspotsView
          mode={activeSection}
          datasets={datasets}
          activeDatasetId={activeDatasetId}
          onSelectDataset={handleSelectDataset}
          datasetStats={datasetStats}
          hotspots={hotspots}
          activeBriefing={activeBriefing}
          onGenerateBriefing={(st) => handleGenerateBriefing(st)}
          generatingBriefing={generatingBriefing}
          aiError={aiError}
        />
      )}

      {(activeSection === 'recommendations' || activeSection === 'briefings') && (
        <RecommendationsAndBriefingsView
          mode={activeSection}
          datasets={datasets}
          activeDatasetId={activeDatasetId}
          briefings={briefings}
          activeBriefing={activeBriefing}
          onSelectBriefing={handleSelectBriefing}
          onGenerateBriefing={handleGenerateBriefing}
          onRefreshBriefing={loadBriefingsForOrg}
          generating={generatingBriefing}
          aiError={aiError}
        />
      )}

      {(activeSection === 'advisories' || activeSection === 'comparisons') && (
        <AdvisoryAndComparisonView
          mode={activeSection}
          briefings={briefings}
          activeBriefing={activeBriefing}
          onRefreshBriefing={loadBriefingsForOrg}
        />
      )}

      {activeSection === 'settings' && (
        <OrgSettingsView
          activeMembership={activeMembership}
          onRefreshProfile={refreshProfile}
        />
      )}
    </LayoutShell>
  );
}
