/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useCallback, useRef } from 'react';
import { ProgressBar } from '../components/shared/ProgressBar';
import { adminApi } from '../api/client';
import { formatDuration, timeAgo } from '../utils/formatters';
import { usePolling } from '../hooks/usePolling';

// ══════════════════════════════════════════
// ── Constants ──
// ══════════════════════════════════════════

const SCRAPER_BASE_URL = 'https://scraper.askagar.3dn.com.au/api/scraper';

const SCRAPER_PRESETS: Record<string, any> = {
  agar: {
    presetId: 'agar',
    displayName: 'Agar Cleaning Systems',
    baseUrl: 'https://agar.com.au',
    defaultStartUrls: ['https://agar.com.au'],
    defaultCrawlDepth: 3,
    defaultMaxPages: 100,
    hasSDSDocuments: true,
    hasPDSDocuments: true,
    outputPrefix: 'AgarScrape',
    rateLimitMin: 1.0,
    rateLimitMax: 3.0,
    categorySelectors: {
      products: 'ul.products li.product',
      productLink: 'a.woocommerce-LoopProduct-link',
      productName: 'h2.woocommerce-loop-product__title',
      productImage: 'img.attachment-woocommerce_thumbnail',
      pagination: 'nav.woocommerce-pagination',
      nextPage: 'a.next.page-numbers',
    },
    productSelectors: {
      name: 'main h1.product_title, div.product h1.product_title',
      mainImage: 'img.wp-post-image',
      galleryImages: '.woocommerce-product-gallery img',
      overview: '.woocommerce-product-details__short-description',
      description: '#tab-description',
      sku: 'span.sku',
      categories: 'span.posted_in a',
      price: 'span.woocommerce-Price-amount',
      stockStatus: 'p.stock',
    },
    pdfSelectors: {
      sdsLink: "a[href*='SDS'], a[href*='sds']",
      pdsLink: "a[href*='PDS'], a[href*='pds']",
      allDocumentLinks: "a[href$='.pdf']",
    },
    s3Defaults: { prefix: 'agar/', uploadPdfs: true, uploadScreenshots: false },
    mementoDefaults: { instanceId: 'main-knowledge', chunking: true, embedding: true },
  },
};

const SCRAPER_PHASES = [
  { key: 'discovering_categories', label: 'Discovering Categories' },
  { key: 'collecting_products', label: 'Collecting Products' },
  { key: 'scraping_products', label: 'Scraping Products' },
  { key: 'downloading_pdfs', label: 'Downloading PDFs' },
  { key: 'uploading_to_s3', label: 'Uploading to S3' },
];

const SCRAPER_STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-800' },
  running: { bg: 'bg-blue-100', text: 'text-blue-800' },
  completed: { bg: 'bg-green-100', text: 'text-green-800' },
  failed: { bg: 'bg-red-100', text: 'text-red-800' },
  paused: { bg: 'bg-yellow-100', text: 'text-yellow-800' },
  cancelled: { bg: 'bg-gray-100', text: 'text-gray-600' },
};

// ══════════════════════════════════════════
// ── Type aliases ──
// ══════════════════════════════════════════

type ScraperApiFn = (endpoint: string, options?: RequestInit) => Promise<any>;

// ══════════════════════════════════════════
// ── Shared Sub-components ──
// ══════════════════════════════════════════

function ScraperJobStatusBadge({ status }: { status: string }) {
  const colors = SCRAPER_STATUS_COLORS[status] || SCRAPER_STATUS_COLORS.pending;
  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${colors.bg} ${colors.text}`}>
      {(status || 'unknown').replace(/_/g, ' ')}
    </span>
  );
}

function ScraperPhaseProgress({ currentPhase }: { currentPhase: string; progress: number }) {
  const currentIdx = SCRAPER_PHASES.findIndex(p => p.key === currentPhase);
  return (
    <div className="flex items-center gap-1 w-full">
      {SCRAPER_PHASES.map((phase, i) => {
        const isComplete = i < currentIdx;
        const isCurrent = i === currentIdx;
        const circleColor = isComplete ? 'bg-green-500' : isCurrent ? 'bg-blue-500' : 'bg-gray-300';
        return (
          <span key={phase.key} className="contents">
            <div className="flex flex-col items-center" style={{ minWidth: '20px' }}>
              <div className={`w-5 h-5 rounded-full ${circleColor} flex items-center justify-center ${isCurrent ? 'animate-pulse' : ''}`}>
                {isComplete && <span className="text-white text-xs">&#10003;</span>}
              </div>
              <span className={`text-xs mt-1 text-center leading-tight ${isCurrent ? 'font-semibold text-blue-700' : 'text-gray-500'}`} style={{ fontSize: '0.65rem', maxWidth: '70px' }}>
                {phase.label}
              </span>
            </div>
            {i < SCRAPER_PHASES.length - 1 && (
              <div className={`flex-1 h-0.5 ${isComplete ? 'bg-green-500' : 'bg-gray-300'} mt-[-16px]`} />
            )}
          </span>
        );
      })}
    </div>
  );
}

function ScraperSubNav({ activeView, onNavigate }: { activeView: string; onNavigate: (view: string) => void; onNewRun?: () => void }) {
  const views = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'jobs', label: 'Jobs' },
    { id: 'create', label: '+ New Run', primary: true },
    { id: 'presets', label: 'Presets' },
  ];
  return (
    <div className="flex gap-2">
      {views.map(v => (
        <button
          key={v.id}
          onClick={() => onNavigate(v.id)}
          className={`px-4 py-2 rounded-full text-sm font-medium transition ${
            activeView === v.id
              ? v.primary ? 'bg-green-500 text-white' : 'bg-blue-500 text-white'
              : v.primary ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

function ScraperLoginForm({ onLogin, error, loading, prefillKey }: { onLogin: (key: string) => void; error: string | null; loading: boolean; prefillKey: string }) {
  const [apiKey, setApiKey] = useState(prefillKey || localStorage.getItem('scraperApiKey') || '');
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('scraperApiKey', apiKey);
    onLogin(apiKey);
  };
  return (
    <div className="flex items-center justify-center py-12">
      <div className="bg-white rounded-lg shadow p-8 max-w-sm w-full">
        <h2 className="text-xl font-bold mb-2">Scraper Login</h2>
        <p className="text-sm text-gray-500 mb-4">Enter the API key for the 3DN Scraper</p>
        {error && <div className="bg-red-50 border border-red-200 rounded p-3 mb-4 text-red-700 text-sm">{error}</div>}
        <form onSubmit={handleSubmit}>
          <input type="password" placeholder="Scraper API Key" value={apiKey} onChange={e => setApiKey(e.target.value)}
            className="w-full border rounded px-3 py-2 mb-4 text-sm font-mono" required />
          <button type="submit" disabled={loading}
            className="w-full bg-blue-500 text-white rounded py-2 text-sm hover:bg-blue-600 disabled:opacity-50">
            {loading ? 'Connecting...' : 'Connect'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// ── Dashboard Sub-components ──
// ══════════════════════════════════════════

function ScraperStatsCards({ stats }: { stats: any }) {
  const cards = [
    { label: 'Total Jobs', value: stats?.total_jobs ?? '-', color: 'text-gray-800' },
    { label: 'Running', value: stats?.running_jobs ?? '-', color: 'text-blue-600', pulse: (stats?.running_jobs || 0) > 0 },
    { label: 'Queued', value: stats?.queued_jobs ?? '-', color: 'text-yellow-600' },
    { label: 'Completed', value: stats?.completed_jobs ?? '-', color: 'text-green-600' },
    { label: 'Failed', value: stats?.failed_jobs ?? '-', color: 'text-red-600' },
    { label: 'Pages Scraped', value: stats?.total_pages_scraped?.toLocaleString() ?? '-', color: 'text-purple-600' },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
      {cards.map(c => (
        <div key={c.label} className="bg-white rounded-lg shadow p-4 text-center">
          <div className={`text-2xl font-bold ${c.color} ${c.pulse ? 'animate-pulse' : ''}`}>{c.value}</div>
          <div className="text-xs text-gray-500 mt-1">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

function ScraperActiveJobs({ jobs, onViewJob, onControl }: { jobs: any[]; onViewJob: (id: string) => void; onControl: (id: string, action: string) => void }) {
  if (!jobs || jobs.length === 0) return null;
  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h3 className="text-lg font-semibold mb-4">Active Jobs</h3>
      <div className="space-y-4">
        {jobs.map((job: any) => (
          <div key={job.id} className="border rounded-lg p-4">
            <div className="flex justify-between items-start mb-2">
              <div>
                <span className="font-medium">{job.name}</span>
                <ScraperJobStatusBadge status={job.status} />
              </div>
              <div className="flex gap-2">
                <button onClick={() => onViewJob(job.id)} className="px-3 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300">View</button>
                {job.status === 'running' && (
                  <button onClick={() => onControl(job.id, 'pause')} className="px-3 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200">Pause</button>
                )}
                {job.status === 'running' && (
                  <button onClick={() => onControl(job.id, 'cancel')} className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Cancel</button>
                )}
              </div>
            </div>
            {job.progress != null && <ProgressBar progress={job.progress} />}
            <div className="flex justify-between text-xs text-gray-500 mt-2">
              <span>{job.current_phase?.replace(/_/g, ' ') || 'Initializing'}</span>
              <span>{job.started_at ? timeAgo(job.started_at) : ''}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScraperRecentJobs({ jobs, onViewJob }: { jobs: any[]; onViewJob: (id: string) => void }) {
  if (!jobs || jobs.length === 0) return <div className="bg-white rounded-lg shadow p-6 text-gray-500 text-sm">No recent jobs</div>;
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold mb-4">Recent Jobs</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2 pr-4">Name</th>
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Pages</th>
              <th className="pb-2 pr-4">Created</th>
              <th className="pb-2 pr-4">Duration</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job: any) => (
              <tr key={job.id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="py-2 pr-4 font-medium">{job.name}</td>
                <td className="py-2 pr-4"><ScraperJobStatusBadge status={job.status} /></td>
                <td className="py-2 pr-4 font-mono text-xs">{job.pages_scraped ?? '-'}</td>
                <td className="py-2 pr-4 text-gray-500">{job.created_at ? timeAgo(job.created_at) : '-'}</td>
                <td className="py-2 pr-4 text-gray-500">{job.duration ? formatDuration(job.duration * 1000) : '-'}</td>
                <td className="py-2">
                  <button onClick={() => onViewJob(job.id)} className="text-blue-500 hover:text-blue-700 text-xs">View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// ── Dashboard ──
// ══════════════════════════════════════════

function ScraperDashboard({ scraperApi, onViewJob }: { scraperApi: ScraperApiFn; onViewJob: (id: string) => void }) {
  const [stats, setStats] = useState<any>(null);
  const [recentJobs, setRecentJobs] = useState<any[]>([]);
  const [activeJobs, setActiveJobs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [statsRes, jobsRes, healthRes] = await Promise.all([
        scraperApi('/stats').catch(() => ({ data: null })),
        scraperApi('/jobs?limit=10&sort=recent').catch(() => ({ data: [] })),
        scraperApi('/health').catch(() => ({ data: null })),
      ]);
      setStats(statsRes.data || statsRes);
      const jobs = jobsRes.data || jobsRes.jobs || jobsRes || [];
      setRecentJobs(Array.isArray(jobs) ? jobs.slice(0, 10) : []);
      setActiveJobs(Array.isArray(jobs) ? jobs.filter((j: any) => j.status === 'running' || j.status === 'paused') : []);
      // healthRes is fetched but not currently displayed; keep for future use
      void healthRes;
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [scraperApi]);

  useEffect(() => { fetchData(); }, [fetchData]);

  usePolling(fetchData, 5000, true);

  const handleControl = async (jobId: string, action: string) => {
    try {
      await scraperApi(`/jobs/${jobId}/control`, { method: 'POST', body: JSON.stringify({ action }) });
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) return <div className="flex items-center gap-2 py-8"><div className="spinner"></div><span>Loading dashboard...</span></div>;

  return (
    <div>
      {error && <div className="bg-red-50 border border-red-200 rounded p-4 mb-6 text-red-700 text-sm"><strong>Error:</strong> {error} <button onClick={() => setError(null)} className="float-right font-bold">x</button></div>}
      <ScraperStatsCards stats={stats} />
      <ScraperActiveJobs jobs={activeJobs} onViewJob={onViewJob} onControl={handleControl} />
      <ScraperRecentJobs jobs={recentJobs} onViewJob={onViewJob} />
    </div>
  );
}

// ══════════════════════════════════════════
// ── Jobs List ──
// ══════════════════════════════════════════

function ScraperJobsList({ scraperApi, onViewJob }: { scraperApi: ScraperApiFn; onViewJob: (id: string) => void }) {
  const [jobs, setJobs] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '50', offset: String((page - 1) * 50) });
      if (statusFilter) params.set('status', statusFilter);
      const res = await scraperApi(`/jobs?${params}`);
      const jobsData = res.data || res.jobs || res || [];
      setJobs(Array.isArray(jobsData) ? jobsData : []);
      const total = res.pagination?.total || res.total || jobsData.length;
      setTotalPages(Math.max(1, Math.ceil(total / 50)));
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [scraperApi, statusFilter, page]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const hasRunning = jobs.some((j: any) => j.status === 'running');
  usePolling(fetchJobs, 5000, hasRunning);

  const handleControl = async (jobId: string, action: string) => {
    try {
      await scraperApi(`/jobs/${jobId}/control`, { method: 'POST', body: JSON.stringify({ action }) });
      fetchJobs();
    } catch (err: any) { setError(err.message); }
  };

  const handleDelete = async (jobId: string) => {
    if (!confirm('Delete this job?')) return;
    try {
      await scraperApi(`/jobs/${jobId}`, { method: 'DELETE' });
      fetchJobs();
    } catch (err: any) { setError(err.message); }
  };

  return (
    <div>
      {error && <div className="bg-red-50 border border-red-200 rounded p-4 mb-6 text-red-700 text-sm"><strong>Error:</strong> {error} <button onClick={() => setError(null)} className="float-right font-bold">x</button></div>}

      <div className="flex items-center gap-4 mb-4">
        <select value={statusFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setStatusFilter(e.target.value); setPage(1); }}
          className="border rounded px-3 py-2 text-sm">
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="paused">Paused</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button onClick={fetchJobs} className="px-3 py-2 bg-gray-200 rounded text-sm hover:bg-gray-300">Refresh</button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8"><div className="spinner"></div><span>Loading jobs...</span></div>
      ) : jobs.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">No jobs found</div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 bg-gray-50 border-b">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Progress</th>
                <th className="px-4 py-3">Pages</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job: any) => (
                <tr key={job.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <button onClick={() => onViewJob(job.id)} className="font-medium text-blue-600 hover:underline">{job.name}</button>
                  </td>
                  <td className="px-4 py-3"><ScraperJobStatusBadge status={job.status} /></td>
                  <td className="px-4 py-3 w-32">
                    {job.status === 'running' && job.progress != null ? <ProgressBar progress={job.progress} /> : <span className="text-gray-400">-</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{job.pages_scraped ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{job.created_at ? new Date(job.created_at).toLocaleString() : '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {job.status === 'running' && (
                        <button onClick={() => handleControl(job.id, 'pause')} className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200">Pause</button>
                      )}
                      {job.status === 'paused' && (
                        <button onClick={() => handleControl(job.id, 'resume')} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Resume</button>
                      )}
                      {['running', 'paused', 'pending'].includes(job.status) && (
                        <button onClick={() => handleControl(job.id, 'cancel')} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Cancel</button>
                      )}
                      {['completed', 'failed', 'cancelled'].includes(job.status) && (
                        <button onClick={() => handleDelete(job.id)} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t">
              <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 text-sm bg-white border rounded hover:bg-gray-100 disabled:opacity-50">Prev</button>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1 text-sm bg-white border rounded hover:bg-gray-100 disabled:opacity-50">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// ── Job Detail ──
// ══════════════════════════════════════════

function ScraperJobDetail({ scraperApi, jobId, onBack }: { scraperApi: ScraperApiFn; jobId: string; onBack: () => void }) {
  const [job, setJob] = useState<any>(null);
  const [detailTab, setDetailTab] = useState('info');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJob = useCallback(async () => {
    try {
      const res = await scraperApi(`/jobs/${jobId}`);
      setJob(res.data || res);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [scraperApi, jobId]);

  useEffect(() => { fetchJob(); }, [fetchJob]);

  const isRunning = job && ['running', 'paused', 'pending'].includes(job.status);
  usePolling(fetchJob, 3000, !!isRunning);

  const handleControl = async (action: string) => {
    try {
      await scraperApi(`/jobs/${jobId}/control`, { method: 'POST', body: JSON.stringify({ action }) });
      fetchJob();
    } catch (err: any) { setError(err.message); }
  };

  if (loading) return <div className="flex items-center gap-2 py-8"><div className="spinner"></div><span>Loading job...</span></div>;
  if (!job) return <div className="text-red-500">Job not found</div>;

  const detailTabs = [
    { id: 'info', label: 'Info' },
    { id: 'logs', label: 'Logs' },
    { id: 'results', label: 'Results' },
  ];

  return (
    <div>
      <button onClick={onBack} className="text-blue-500 hover:text-blue-700 text-sm mb-4 inline-flex items-center gap-1">
        &larr; Back to Jobs
      </button>

      {error && <div className="bg-red-50 border border-red-200 rounded p-4 mb-4 text-red-700 text-sm"><strong>Error:</strong> {error} <button onClick={() => setError(null)} className="float-right font-bold">x</button></div>}

      {/* Header */}
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold">{job.name}</h2>
            {job.description && <p className="text-sm text-gray-500 mt-1">{job.description}</p>}
            <div className="flex items-center gap-3 mt-2">
              <ScraperJobStatusBadge status={job.status} />
              <span className="text-xs text-gray-500">ID: {job.id}</span>
            </div>
          </div>
          <div className="flex gap-2">
            {job.status === 'pending' && (
              <button onClick={() => handleControl('start')} className="px-3 py-1.5 text-sm bg-green-500 text-white rounded hover:bg-green-600">Start</button>
            )}
            {job.status === 'running' && (
              <button onClick={() => handleControl('pause')} className="px-3 py-1.5 text-sm bg-yellow-500 text-white rounded hover:bg-yellow-600">Pause</button>
            )}
            {job.status === 'paused' && (
              <button onClick={() => handleControl('resume')} className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">Resume</button>
            )}
            {['running', 'paused', 'pending'].includes(job.status) && (
              <button onClick={() => handleControl('cancel')} className="px-3 py-1.5 text-sm bg-red-500 text-white rounded hover:bg-red-600">Cancel</button>
            )}
          </div>
        </div>

        {/* Progress */}
        {job.status === 'running' && (
          <div className="mt-4">
            <ProgressBar progress={job.progress || 0} />
            <div className="mt-3">
              <ScraperPhaseProgress currentPhase={job.current_phase} progress={job.progress} />
            </div>
          </div>
        )}
      </div>

      {/* Detail tabs */}
      <div className="flex border-b border-gray-200 mb-4">
        {detailTabs.map(tab => (
          <button key={tab.id} onClick={() => setDetailTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              detailTab === tab.id ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {detailTab === 'info' && <ScraperJobInfo job={job} />}
      {detailTab === 'logs' && <ScraperJobLogs scraperApi={scraperApi} jobId={jobId} isRunning={!!isRunning} />}
      {detailTab === 'results' && (
        <div className="bg-white rounded-lg shadow p-6 text-gray-500 text-sm">
          Results viewer coming in a future update. Use the API directly to access scraped data: <code className="bg-gray-100 px-2 py-1 rounded">GET /jobs/{jobId}/results</code>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// ── Job Info ──
// ══════════════════════════════════════════

function ScraperJobInfo({ job }: { job: any }) {
  return (
    <div className="space-y-4">
      {/* Metadata */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">Job Metadata</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div><span className="text-gray-500">Type:</span> <span className="ml-1 font-medium">{job.type || 'web'}</span></div>
          <div><span className="text-gray-500">Created:</span> <span className="ml-1">{job.created_at ? new Date(job.created_at).toLocaleString() : '-'}</span></div>
          <div><span className="text-gray-500">Started:</span> <span className="ml-1">{job.started_at ? new Date(job.started_at).toLocaleString() : '-'}</span></div>
          <div><span className="text-gray-500">Completed:</span> <span className="ml-1">{job.completed_at ? new Date(job.completed_at).toLocaleString() : '-'}</span></div>
          <div><span className="text-gray-500">Pages Scraped:</span> <span className="ml-1 font-mono">{job.pages_scraped ?? '-'}</span></div>
          <div><span className="text-gray-500">Errors:</span> <span className="ml-1 font-mono">{job.error_count ?? '-'}</span></div>
          <div><span className="text-gray-500">Duration:</span> <span className="ml-1">{job.duration ? formatDuration(job.duration * 1000) : '-'}</span></div>
          <div><span className="text-gray-500">Items Extracted:</span> <span className="ml-1 font-mono">{job.items_extracted ?? '-'}</span></div>
        </div>
      </div>

      {/* Error */}
      {job.error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-red-700 mb-1">Error</h3>
          <p className="text-sm text-red-600">{job.error}</p>
        </div>
      )}

      {/* Phase Progress */}
      {job.status === 'running' && job.current_phase && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">Phase Progress</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Current Phase:</span> <span className="ml-1 font-medium">{job.current_phase?.replace(/_/g, ' ')}</span></div>
            <div><span className="text-gray-500">Categories Found:</span> <span className="ml-1 font-mono">{job.categories_found ?? '-'}</span></div>
            <div><span className="text-gray-500">Products Found:</span> <span className="ml-1 font-mono">{job.products_found ?? '-'}</span></div>
            <div><span className="text-gray-500">PDFs Downloaded:</span> <span className="ml-1 font-mono">{job.pdfs_downloaded ?? '-'}</span></div>
          </div>
        </div>
      )}

      {/* Configuration */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">Configuration</h3>
        {job.config ? (
          <pre className="json bg-gray-50 rounded p-3 text-xs overflow-auto max-h-48">{JSON.stringify(job.config, null, 2)}</pre>
        ) : (
          <p className="text-sm text-gray-500">No configuration data available</p>
        )}
      </div>

      {/* S3 Results */}
      {job.s3_results && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">S3 Upload Results</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Files Uploaded:</span> <span className="ml-1 font-mono">{job.s3_results.files_uploaded ?? '-'}</span></div>
            <div><span className="text-gray-500">Total Size:</span> <span className="ml-1">{job.s3_results.total_size ?? '-'}</span></div>
            {job.s3_results.path && <div className="col-span-2"><span className="text-gray-500">Path:</span> <span className="ml-1 font-mono text-xs">{job.s3_results.path}</span></div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// ── Job Logs ──
// ══════════════════════════════════════════

function ScraperJobLogs({ scraperApi, jobId, isRunning }: { scraperApi: ScraperApiFn; jobId: string; isRunning: boolean }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [levelFilter, setLevelFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: '500' });
      if (levelFilter) params.set('level', levelFilter);
      const res = await scraperApi(`/jobs/${jobId}/logs?${params}`);
      setLogs(res.data || res.logs || res || []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [scraperApi, jobId, levelFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  usePolling(fetchLogs, 3000, isRunning);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const levelColors: Record<string, string> = {
    debug: 'bg-gray-100 text-gray-600',
    info: 'bg-blue-100 text-blue-700',
    warn: 'bg-yellow-100 text-yellow-700',
    warning: 'bg-yellow-100 text-yellow-700',
    error: 'bg-red-100 text-red-700',
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      {error && <div className="bg-red-50 border border-red-200 rounded p-3 mb-4 text-red-700 text-sm">{error}</div>}

      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {['', 'debug', 'info', 'warn', 'error'].map(level => (
            <button key={level} onClick={() => setLevelFilter(level)}
              className={`px-3 py-1 text-xs rounded-full ${levelFilter === level ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
              {level || 'All'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-500">
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4"><div className="spinner"></div><span className="text-sm">Loading logs...</span></div>
      ) : (
        <div ref={logContainerRef} className="bg-gray-900 rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-xs">
          {logs.length === 0 ? (
            <div className="text-gray-400">No logs available</div>
          ) : (
            logs.map((log: any, i: number) => (
              <div key={i} className="flex gap-2 py-0.5 hover:bg-gray-800">
                <span className="text-gray-500 shrink-0">{log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : ''}</span>
                <span className={`px-1.5 py-0.5 rounded text-xs shrink-0 ${levelColors[log.level?.toLowerCase()] || levelColors.info}`}>
                  {(log.level || 'info').toUpperCase()}
                </span>
                <span className="text-gray-200 break-all">{log.message}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════
// ── Create Job ──
// ══════════════════════════════════════════

function ScraperCreateJob({ scraperApi, onCreated }: { scraperApi: ScraperApiFn; onCreated: (jobId: string | null) => void }) {
  const now = new Date();
  const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

  const [presetId, setPresetId] = useState('agar');
  const [formData, setFormData] = useState({
    name: `AgarScrape-${dateStr}`,
    description: '',
    startUrls: 'https://agar.com.au',
    crawlDepth: 3,
    maxPages: 100,
    rateLimitMin: 1.0,
    rateLimitMax: 3.0,
    followLinks: true,
    respectRobotsTxt: true,
    fileFormat: 'json',
    saveFiles: true,
    uploadToS3: true,
    s3Prefix: 'agar/',
    uploadPdfs: true,
    uploadScreenshots: false,
    uploadCategories: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyPreset = (id: string) => {
    setPresetId(id);
    if (id === 'custom') return;
    const preset = SCRAPER_PRESETS[id];
    if (!preset) return;
    setFormData(prev => ({
      ...prev,
      name: `${preset.outputPrefix}-${dateStr}`,
      startUrls: preset.defaultStartUrls.join('\n'),
      crawlDepth: preset.defaultCrawlDepth,
      maxPages: preset.defaultMaxPages,
      rateLimitMin: preset.rateLimitMin,
      rateLimitMax: preset.rateLimitMax,
      s3Prefix: preset.s3Defaults?.prefix || '',
      uploadPdfs: preset.s3Defaults?.uploadPdfs ?? true,
      uploadScreenshots: preset.s3Defaults?.uploadScreenshots ?? false,
    }));
  };

  const handleSubmit = async (asDraft: boolean) => {
    setSubmitting(true);
    setError(null);
    try {
      const startUrls = formData.startUrls.split('\n').map(u => u.trim()).filter(Boolean);
      if (startUrls.length === 0) throw new Error('At least one start URL is required');

      const payload: any = {
        name: formData.name || `scrape-${dateStr}`,
        description: formData.description,
        type: 'web',
        config: {
          startUrls,
          crawlDepth: Number(formData.crawlDepth),
          maxPages: Number(formData.maxPages),
          rateLimit: { min: Number(formData.rateLimitMin), max: Number(formData.rateLimitMax) },
          followLinks: formData.followLinks,
          respectRobotsTxt: formData.respectRobotsTxt,
        },
        output: {
          saveFiles: formData.saveFiles,
          fileFormat: formData.fileFormat,
          uploadToS3: {
            enabled: formData.uploadToS3,
            prefix: formData.s3Prefix,
            uploadPdfs: formData.uploadPdfs,
            uploadScreenshots: formData.uploadScreenshots,
            uploadCategories: formData.uploadCategories,
          },
        },
      };

      if (asDraft) payload.status = 'pending';

      const res = await scraperApi('/jobs', { method: 'POST', body: JSON.stringify(payload) });
      const newJobId = res.data?.id || res.id || res.jobId;
      onCreated(newJobId);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const updateField = (field: string, value: any) => setFormData(prev => ({ ...prev, [field]: value }));

  return (
    <div className="max-w-3xl">
      {error && <div className="bg-red-50 border border-red-200 rounded p-4 mb-6 text-red-700 text-sm"><strong>Error:</strong> {error} <button onClick={() => setError(null)} className="float-right font-bold">x</button></div>}

      {/* Preset Selector */}
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">Client Preset</h3>
        <select value={presetId} onChange={e => applyPreset(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm">
          <option value="custom">Custom (Manual Configuration)</option>
          {Object.values(SCRAPER_PRESETS).map((p: any) => (
            <option key={p.presetId} value={p.presetId}>{p.displayName}</option>
          ))}
        </select>
        {presetId !== 'custom' && (
          <p className="text-xs text-gray-500 mt-2">Preset values loaded. All fields below are editable.</p>
        )}
      </div>

      {/* Basic Info */}
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">Basic Information</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Job Name *</label>
            <input type="text" value={formData.name} onChange={e => updateField('name', e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={formData.description} onChange={e => updateField('description', e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm" rows={2} placeholder="Optional description" />
          </div>
        </div>
      </div>

      {/* Scraping Configuration */}
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">Scraping Configuration</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start URLs * (one per line)</label>
            <textarea value={formData.startUrls} onChange={e => updateField('startUrls', e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm font-mono" rows={3} required />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Crawl Depth</label>
              <input type="number" min="1" max="10" value={formData.crawlDepth} onChange={e => updateField('crawlDepth', e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Pages</label>
              <input type="number" min="1" value={formData.maxPages} onChange={e => updateField('maxPages', e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rate Limit Min (s)</label>
              <input type="number" min="0" step="0.1" value={formData.rateLimitMin} onChange={e => updateField('rateLimitMin', e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rate Limit Max (s)</label>
              <input type="number" min="0" step="0.1" value={formData.rateLimitMax} onChange={e => updateField('rateLimitMax', e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={formData.followLinks} onChange={e => updateField('followLinks', e.target.checked)} />
              Follow Links
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={formData.respectRobotsTxt} onChange={e => updateField('respectRobotsTxt', e.target.checked)} />
              Respect robots.txt
            </label>
          </div>
        </div>
      </div>

      {/* Output Configuration */}
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <h3 className="text-sm font-semibold text-gray-500 uppercase mb-3">Output Configuration</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">File Format</label>
            <select value={formData.fileFormat} onChange={e => updateField('fileFormat', e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm">
              <option value="json">JSON</option>
              <option value="markdown">Markdown</option>
              <option value="html">HTML</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={formData.saveFiles} onChange={e => updateField('saveFiles', e.target.checked)} />
              Save Files Locally
            </label>
          </div>
        </div>
      </div>

      {/* S3 Upload */}
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-500 uppercase">S3 Upload</h3>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={formData.uploadToS3} onChange={e => updateField('uploadToS3', e.target.checked)} />
            Enable
          </label>
        </div>
        {formData.uploadToS3 && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Path Prefix</label>
              <input type="text" value={formData.s3Prefix} onChange={e => updateField('s3Prefix', e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm font-mono" />
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={formData.uploadPdfs} onChange={e => updateField('uploadPdfs', e.target.checked)} />
                Upload PDFs
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={formData.uploadScreenshots} onChange={e => updateField('uploadScreenshots', e.target.checked)} />
                Upload Screenshots
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={formData.uploadCategories} onChange={e => updateField('uploadCategories', e.target.checked)} />
                Upload Categories
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="flex gap-3">
        <button onClick={() => handleSubmit(false)} disabled={submitting}
          className="px-6 py-3 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 disabled:opacity-50">
          {submitting ? 'Launching...' : 'Launch Run'}
        </button>
        <button onClick={() => handleSubmit(true)} disabled={submitting}
          className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 disabled:opacity-50">
          Save as Draft
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// ── Presets View ──
// ══════════════════════════════════════════

function ScraperPresetsView() {
  const presets = Object.values(SCRAPER_PRESETS);
  return (
    <div>
      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <h3 className="text-lg font-semibold mb-4">Client Presets</h3>
        <p className="text-sm text-gray-500 mb-4">Full preset management (create, edit, import/export) is coming in a future update. Below are the built-in presets.</p>
        <div className="space-y-4">
          {presets.map((preset: any) => (
            <div key={preset.presetId} className="border rounded-lg p-4">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h4 className="font-medium">{preset.displayName}</h4>
                  <span className="text-xs text-gray-500">{preset.baseUrl}</span>
                </div>
                <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">Built-in</span>
              </div>
              <pre className="json bg-gray-50 rounded p-3 text-xs overflow-auto max-h-48">{JSON.stringify(preset, null, 2)}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════
// ── Scraper Tab (orchestrator) ──
// ══════════════════════════════════════════

export function ScraperTab() {
  const [scraperAuth, setScraperAuth] = useState<{ accessToken: string | null; refreshToken: string | null; user: any }>(() => ({
    accessToken: localStorage.getItem('scraperAccessToken') || null,
    refreshToken: localStorage.getItem('scraperRefreshToken') || null,
    user: null,
  }));
  const [scraperView, setScraperView] = useState('dashboard');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [envApiKey, setEnvApiKey] = useState<string | null>(null);
  const [envChecked, setEnvChecked] = useState(false);

  // Use a ref so scraperApi always reads the latest token (avoids stale closures)
  const tokenRef = useRef(scraperAuth.accessToken);
  const refreshTokenRef = useRef(scraperAuth.refreshToken);
  useEffect(() => {
    tokenRef.current = scraperAuth.accessToken;
    refreshTokenRef.current = scraperAuth.refreshToken;
  }, [scraperAuth.accessToken, scraperAuth.refreshToken]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem('scraperAccessToken');
    localStorage.removeItem('scraperRefreshToken');
    localStorage.removeItem('scraperApiKey');
    tokenRef.current = null;
    refreshTokenRef.current = null;
    setScraperAuth({ accessToken: null, refreshToken: null, user: null });
  }, []);

  // Helper to extract token from auth response (handles multiple response formats)
  const extractToken = (data: any): string | null => {
    return data.access_token || data.accessToken || data.token || (data.data && (data.data.access_token || data.data.accessToken || data.data.token)) || null;
  };
  const extractRefreshToken = (data: any): string | null => {
    return data.refresh_token || data.refreshToken || (data.data && (data.data.refresh_token || data.data.refreshToken)) || null;
  };

  const scraperApi: ScraperApiFn = useCallback(async (endpoint: string, options: RequestInit = {}) => {
    const url = `${SCRAPER_BASE_URL}${endpoint}`;

    const doFetch = async (token: string | null) => {
      return fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          ...(options.headers as Record<string, string> || {}),
        },
      });
    };

    let response = await doFetch(tokenRef.current);

    // Auto-refresh on 401: try refresh token first, then re-auth with stored API key
    if (response.status === 401) {
      let refreshed = false;

      // Try refresh token
      if (refreshTokenRef.current) {
        try {
          const refreshRes = await fetch(`${SCRAPER_BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshTokenRef.current }),
          });
          if (refreshRes.ok) {
            const data = await refreshRes.json();
            const newAccess = extractToken(data);
            const newRefresh = extractRefreshToken(data) || refreshTokenRef.current;
            if (newAccess) {
              localStorage.setItem('scraperAccessToken', newAccess);
              localStorage.setItem('scraperRefreshToken', newRefresh!);
              tokenRef.current = newAccess;
              refreshTokenRef.current = newRefresh;
              setScraperAuth(prev => ({ ...prev, accessToken: newAccess, refreshToken: newRefresh }));
              response = await doFetch(newAccess);
              refreshed = true;
            }
          }
        } catch (_) {
          // refresh failed silently
        }
      }

      // Fall back to re-auth with stored API key
      if (!refreshed) {
        const storedKey = localStorage.getItem('scraperApiKey');
        if (storedKey) {
          try {
            const reAuthRes = await fetch(`${SCRAPER_BASE_URL}/auth/api-key`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ api_key: storedKey }),
            });
            if (reAuthRes.ok) {
              const data = await reAuthRes.json();
              const newAccess = extractToken(data);
              const newRefresh = extractRefreshToken(data);
              if (newAccess) {
                localStorage.setItem('scraperAccessToken', newAccess);
                if (newRefresh) localStorage.setItem('scraperRefreshToken', newRefresh);
                tokenRef.current = newAccess;
                refreshTokenRef.current = newRefresh;
                setScraperAuth(prev => ({ ...prev, accessToken: newAccess, refreshToken: newRefresh || null }));
                response = await doFetch(newAccess);
                refreshed = true;
              }
            }
          } catch (_) {
            // re-auth failed silently
          }
        }
      }

      if (!refreshed) {
        handleLogout();
        throw new Error('Session expired. Please log in again.');
      }
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(err.message || err.error || err.detail || 'Scraper request failed');
    }
    return response.json();
  }, [handleLogout]);

  // Shared login helper: calls /auth/api-key, stores tokens, updates refs + state
  const authenticateWithKey = useCallback(async (apiKey: string) => {
    const response = await fetch(`${SCRAPER_BASE_URL}/auth/api-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || err.detail || 'Authentication failed');
    }
    const data = await response.json();
    const accessToken = extractToken(data);
    const refreshToken = extractRefreshToken(data);
    if (!accessToken) throw new Error('No access token in response');
    localStorage.setItem('scraperApiKey', apiKey);
    localStorage.setItem('scraperAccessToken', accessToken);
    if (refreshToken) localStorage.setItem('scraperRefreshToken', refreshToken);
    tokenRef.current = accessToken;
    refreshTokenRef.current = refreshToken;
    setScraperAuth({ accessToken, refreshToken: refreshToken || null, user: data.user || null });
    return accessToken;
  }, []);

  const handleLogin = async (apiKey: string) => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await authenticateWithKey(apiKey);
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  // Fetch env-configured API key on mount, auto-connect if available
  useEffect(() => {
    if (scraperAuth.accessToken || envChecked) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await adminApi<any>('/scraper-config');
        const key = res.data?.apiKey;
        if (cancelled) return;
        if (key) {
          setEnvApiKey(key);
          setAuthLoading(true);
          try {
            await authenticateWithKey(key);
          } catch (_) {
            if (!cancelled) setAuthError('Server-configured API key was rejected. Please enter a valid key.');
          }
          if (!cancelled) setAuthLoading(false);
        }
      } catch (_) {
        // Endpoint not available or admin API key not set -- ignore
      } finally {
        if (!cancelled) setEnvChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, [scraperAuth.accessToken, envChecked, authenticateWithKey]);

  const handleViewJob = (jobId: string) => {
    setSelectedJobId(jobId);
    setScraperView('jobs');
  };

  const handleJobCreated = (jobId: string | null) => {
    if (jobId) {
      setSelectedJobId(jobId);
      setScraperView('jobs');
    } else {
      setScraperView('jobs');
    }
  };

  // Show loading while checking env config
  if (!envChecked && !scraperAuth.accessToken) {
    return <div className="flex items-center gap-2 py-12 justify-center"><div className="spinner"></div><span className="text-sm text-gray-500">Connecting to scraper...</span></div>;
  }

  // Show login if not authenticated
  if (!scraperAuth.accessToken) {
    return <ScraperLoginForm onLogin={handleLogin} error={authError} loading={authLoading} prefillKey={envApiKey || localStorage.getItem('scraperApiKey') || ''} />;
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <ScraperSubNav activeView={scraperView} onNavigate={(v) => { setScraperView(v); setSelectedJobId(null); }} />
        <div className="flex items-center gap-3 text-sm">
          {scraperAuth.user && <span className="text-gray-500">{scraperAuth.user.username || scraperAuth.user.email || ''}</span>}
          <span className="text-xs text-gray-400">API: {SCRAPER_BASE_URL.replace(/https?:\/\//, '').split('/')[0]}</span>
          <button onClick={handleLogout} className="text-red-500 hover:text-red-700 text-xs">Logout</button>
        </div>
      </div>

      {scraperView === 'dashboard' && <ScraperDashboard scraperApi={scraperApi} onViewJob={handleViewJob} />}
      {scraperView === 'jobs' && !selectedJobId && <ScraperJobsList scraperApi={scraperApi} onViewJob={handleViewJob} />}
      {scraperView === 'jobs' && selectedJobId && <ScraperJobDetail scraperApi={scraperApi} jobId={selectedJobId} onBack={() => setSelectedJobId(null)} />}
      {scraperView === 'create' && <ScraperCreateJob scraperApi={scraperApi} onCreated={handleJobCreated} />}
      {scraperView === 'presets' && <ScraperPresetsView />}
    </div>
  );
}
