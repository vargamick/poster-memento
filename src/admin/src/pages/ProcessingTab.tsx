import { useState, useEffect, useCallback } from 'react';
import { adminApi, processingApi } from '../api/client';
import { JobStatusBadge } from '../components/shared/Badge';
import { ProgressBar } from '../components/shared/ProgressBar';
import { StageCard } from '../components/shared/StageCard';
import { usePolling } from '../hooks/usePolling';
import { useInstanceConfig } from '../hooks/useInstanceConfig';

/* eslint-disable @typescript-eslint/no-explicit-any */

function PipelineStatusCard({ label, status, color }: { label: string; status: string; color: string }) {
  const colors: Record<string, string> = { gray: 'bg-gray-100 text-gray-700', blue: 'bg-blue-100 text-blue-700', green: 'bg-green-100 text-green-700', red: 'bg-red-100 text-red-700' };
  return (
    <div className={`rounded-lg p-4 ${colors[color] || colors.gray}`}>
      <div className="text-sm font-medium">{label}</div>
      <div className="text-lg font-bold mt-1">{status}</div>
    </div>
  );
}

function ScrapeRuns({ runs, onSelect, selectedRun, loading }: any) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-bold mb-4">Available Scrape Runs</h2>
        <div className="flex items-center gap-2">
          <div className="spinner"></div>
          <span>Loading scrape runs...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h2 className="text-xl font-bold mb-4">Available Scrape Runs</h2>
      {runs.length === 0 ? (
        <p className="text-gray-500">No scrape runs found in S3. Check S3 configuration.</p>
      ) : (
        <div className="space-y-2">
          {runs.map((run: any) => (
            <div
              key={run.runId}
              onClick={() => onSelect(run)}
              className={`border rounded p-3 cursor-pointer hover:bg-gray-50 ${
                selectedRun?.runId === run.runId ? 'border-blue-500 bg-blue-50' : ''
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <span className="font-mono text-sm">{run.runId}</span>
                  <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                    run.type === 'FULL' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {run.type}
                  </span>
                </div>
                <span className="text-sm text-gray-500">{run.sizeFormatted}</span>
              </div>
              <div className="text-sm text-gray-500 mt-1">
                {new Date(run.timestamp).toLocaleString()} | {run.files.pdfCount} PDFs | {run.files.totalFiles} files
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProcessingTab() {
  const { config: instanceConfig } = useInstanceConfig();
  const availableEntityTypes = instanceConfig?.entityTypes || [];

  const [scrapeRuns, setScrapeRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [metaStatus, setMetaStatus] = useState<any>(null);
  const [pdfStatus, setPdfStatus] = useState<any>(null);
  const [embStatus, setEmbStatus] = useState<any>(null);
  const [embInfo, setEmbInfo] = useState<any>(null);
  const [refreshJob, setRefreshJob] = useState<any>(null);
  const [allJobs, setAllJobs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState({ runs: false });

  const [metaOpts, setMetaOpts] = useState({ useCatalog: true, dryRun: false, catalogPath: '' });
  const [pdfOpts, setPdfOpts] = useState({ useCatalog: true, dryRun: false });
  const [embOpts, setEmbOpts] = useState({ entityTypes: availableEntityTypes, batchSize: 10, delayMs: 1000 });
  const [skipCleanup, setSkipCleanup] = useState(false);
  const [metaPreview, setMetaPreview] = useState<any>(null);
  const [embPreview, setEmbPreview] = useState<any>(null);

  const fetchPipelineStatus = useCallback(async () => {
    try {
      const [m, p, e, info] = await Promise.all([
        processingApi<any>('/metadata/status').catch(() => ({ data: null })),
        processingApi<any>('/pdf/status').catch(() => ({ data: null })),
        processingApi<any>('/embeddings/status').catch(() => ({ data: null })),
        processingApi<any>('/embeddings/info').catch(() => ({ data: null })),
      ]);
      setMetaStatus(m.data);
      setPdfStatus(p.data);
      setEmbStatus(e.data);
      setEmbInfo(info.data);
    } catch (err) {
      console.error('Pipeline status fetch error', err);
    }
  }, []);

  const fetchScrapeRuns = useCallback(async () => {
    setLoading(l => ({ ...l, runs: true }));
    try {
      const res = await adminApi<any>('/s3/scrape-runs');
      setScrapeRuns(res.data || []);
    } catch (err) {
      console.error('Scrape runs error', err);
    } finally {
      setLoading(l => ({ ...l, runs: false }));
    }
  }, []);

  const fetchRefreshJob = useCallback(async () => {
    try {
      const res = await adminApi<any>('/refresh/status');
      setRefreshJob(res.data);
    } catch (err) {
      console.error('Refresh status error', err);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const [processingJobs, refreshJobs] = await Promise.all([
        processingApi<any>('/jobs').catch(() => ({ data: [] })),
        adminApi<any>('/refresh/jobs').catch(() => ({ data: [] })),
      ]);
      const combined = [
        ...(processingJobs.data || []).map((j: any) => ({ ...j, source: 'processing' })),
        ...(refreshJobs.data || []).map((j: any) => ({ ...j, type: 'refresh', source: 'admin', status: j.phase })),
      ].sort((a, b) => new Date(b.startedAt || b.updatedAt).getTime() - new Date(a.startedAt || a.updatedAt).getTime());
      setAllJobs(combined.slice(0, 20));
    } catch (err) {
      console.error('Job list error', err);
    }
  }, []);

  useEffect(() => {
    fetchPipelineStatus();
    fetchScrapeRuns();
    fetchRefreshJob();
    fetchJobs();
  }, []);

  const hasRunning = metaStatus?.status === 'running' || pdfStatus?.status === 'running' || embStatus?.status === 'running'
    || (refreshJob && !['completed', 'failed', 'cancelled'].includes(refreshJob.phase));

  usePolling(() => { fetchPipelineStatus(); fetchRefreshJob(); fetchJobs(); }, 3000, !!hasRunning);

  const stageColor = (s: any) => !s ? 'gray' : s.status === 'running' ? 'blue' : s.status === 'completed' ? 'green' : s.status === 'failed' ? 'red' : 'gray';
  const stageLabel = (s: any) => !s ? 'Idle' : s.status === 'running' ? `Running (${s.progress?.percentComplete || 0}%)` : s.status || 'Idle';

  const startMetadata = async () => {
    try {
      setError(null);
      await processingApi('/metadata/start', { method: 'POST', body: JSON.stringify({ options: metaOpts }) });
      fetchPipelineStatus();
      fetchJobs();
    } catch (err: any) { setError(err.message); }
  };

  const loadMetadataPreview = async () => {
    if (!selectedRun) return;
    try {
      const res = await processingApi<any>('/metadata/load', { method: 'POST', body: JSON.stringify({ scrapeRunPath: selectedRun.path }) });
      setMetaPreview(res.data);
    } catch (err: any) { setError(err.message); }
  };

  const startPdf = async () => {
    if (!selectedRun) { setError('Select a scrape run first'); return; }
    try {
      setError(null);
      await processingApi('/pdf/start', { method: 'POST', body: JSON.stringify({ scrapeRunPath: selectedRun.path, options: pdfOpts }) });
      fetchPipelineStatus();
      fetchJobs();
    } catch (err: any) { setError(err.message); }
  };

  const startEmbeddings = async () => {
    try {
      setError(null);
      await processingApi('/embeddings/start', { method: 'POST', body: JSON.stringify({ options: embOpts }) });
      fetchPipelineStatus();
      fetchJobs();
    } catch (err: any) { setError(err.message); }
  };

  const previewEntities = async () => {
    try {
      const types = embOpts.entityTypes.join(',');
      const res = await processingApi<any>(`/embeddings/entities?entityTypes=${types}&limit=100`);
      setEmbPreview(res);
    } catch (err: any) { setError(err.message); }
  };

  const startFullRefresh = async () => {
    try {
      setError(null);
      const body: any = { skipCleanup };
      if (selectedRun) body.scrapeRunPath = selectedRun.path;
      await adminApi('/refresh', { method: 'POST', body: JSON.stringify(body) });
      fetchRefreshJob();
      fetchJobs();
    } catch (err: any) { setError(err.message); }
  };

  const cancelRefresh = async () => {
    if (!refreshJob?.jobId) return;
    try { await adminApi(`/refresh/jobs/${refreshJob.jobId}`, { method: 'DELETE' }); fetchRefreshJob(); } catch (err: any) { setError(err.message); }
  };

  const cancelProcessingJob = async (id: string) => {
    try { await processingApi(`/jobs/${id}`, { method: 'DELETE' }); fetchPipelineStatus(); fetchJobs(); } catch (err: any) { setError(err.message); }
  };

  return (
    <div>
      {error && <div className="bg-red-50 border border-red-200 rounded p-4 mb-6 text-red-700"><strong>Error:</strong> {error} <button onClick={() => setError(null)} className="float-right">x</button></div>}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <PipelineStatusCard label="Metadata" status={stageLabel(metaStatus)} color={stageColor(metaStatus)} />
        <PipelineStatusCard label="PDF" status={stageLabel(pdfStatus)} color={stageColor(pdfStatus)} />
        <PipelineStatusCard label="Embeddings" status={stageLabel(embStatus)} color={stageColor(embStatus)} />
        <PipelineStatusCard label="Embedding Service" status={embInfo?.available ? `${embInfo.provider || 'Ready'}` : 'Unavailable'} color={embInfo?.available ? 'green' : 'red'} />
      </div>

      <ScrapeRuns runs={scrapeRuns} selectedRun={selectedRun} onSelect={setSelectedRun} loading={loading.runs} />

      <StageCard title="Stage 1: Metadata Processing" description="Load and process product metadata from scrape run">
        <div className="space-y-3 pt-3">
          <div className="flex gap-4 items-center flex-wrap">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={metaOpts.useCatalog} onChange={e => setMetaOpts({ ...metaOpts, useCatalog: e.target.checked })} /> Use Catalog
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={metaOpts.dryRun} onChange={e => setMetaOpts({ ...metaOpts, dryRun: e.target.checked })} /> Dry Run
            </label>
            <input type="text" placeholder="Catalog path (optional)" value={metaOpts.catalogPath} onChange={e => setMetaOpts({ ...metaOpts, catalogPath: e.target.value })}
              className="px-2 py-1 border rounded text-sm flex-1 min-w-48" />
          </div>
          <div className="flex gap-2">
            <button onClick={loadMetadataPreview} disabled={!selectedRun} className="px-3 py-1.5 bg-gray-200 rounded text-sm hover:bg-gray-300 disabled:opacity-50">Load Preview</button>
            <button onClick={startMetadata} className="px-3 py-1.5 bg-blue-500 text-white rounded text-sm hover:bg-blue-600">Start Metadata Processing</button>
            <button onClick={() => processingApi('/metadata/sync-catalog', { method: 'POST', body: JSON.stringify({ dryRun: metaOpts.dryRun }) }).then(() => fetchPipelineStatus()).catch((e: any) => setError(e.message))}
              className="px-3 py-1.5 bg-purple-500 text-white rounded text-sm hover:bg-purple-600">Sync Catalog</button>
          </div>
          {metaPreview && (
            <div className="bg-blue-50 rounded p-3 text-sm">
              <strong>Preview:</strong> {metaPreview.scrapeRunInfo?.productCount || 0} products, {metaPreview.scrapeRunInfo?.categoryCount || 0} categories,
              {metaPreview.scrapeRunInfo?.pdfPDSCount || 0} PDS, {metaPreview.scrapeRunInfo?.pdfSDSCount || 0} SDS
            </div>
          )}
          {metaStatus && metaStatus.status === 'running' && <ProgressBar progress={metaStatus.progress?.percentComplete || 0} />}
        </div>
      </StageCard>

      <StageCard title="Stage 2: PDF Processing" description="Extract content from PDF documents">
        <div className="space-y-3 pt-3">
          <div className="flex gap-4 items-center">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={pdfOpts.useCatalog} onChange={e => setPdfOpts({ ...pdfOpts, useCatalog: e.target.checked })} /> Use Catalog
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={pdfOpts.dryRun} onChange={e => setPdfOpts({ ...pdfOpts, dryRun: e.target.checked })} /> Dry Run
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={startPdf} disabled={!selectedRun} className="px-3 py-1.5 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50">
              Start PDF Processing
            </button>
            {!selectedRun && <span className="text-sm text-yellow-600 self-center">Select a scrape run first</span>}
          </div>
          {pdfStatus && pdfStatus.status === 'running' && <ProgressBar progress={pdfStatus.progress?.percentComplete || 0} />}
        </div>
      </StageCard>

      <StageCard title="Stage 3: Embedding Generation" description="Generate vector embeddings for entities">
        <div className="space-y-3 pt-3">
          <div className="flex gap-4 items-center flex-wrap">
            {availableEntityTypes.map(entityType => (
              <label key={entityType} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={embOpts.entityTypes.includes(entityType)}
                  onChange={e => {
                    const types = e.target.checked ? [...embOpts.entityTypes, entityType] : embOpts.entityTypes.filter(t => t !== entityType);
                    setEmbOpts({ ...embOpts, entityTypes: types });
                  }} /> {entityType}
              </label>
            ))}
            <label className="text-sm">Batch Size:
              <input type="number" value={embOpts.batchSize} min="1" max="100" onChange={e => setEmbOpts({ ...embOpts, batchSize: parseInt(e.target.value) || 10 })}
                className="ml-1 w-16 px-2 py-1 border rounded text-sm" />
            </label>
            <label className="text-sm">Delay (ms):
              <input type="number" value={embOpts.delayMs} min="0" step="100" onChange={e => setEmbOpts({ ...embOpts, delayMs: parseInt(e.target.value) || 1000 })}
                className="ml-1 w-20 px-2 py-1 border rounded text-sm" />
            </label>
          </div>
          {!embInfo?.available && <div className="bg-yellow-50 text-yellow-700 p-2 rounded text-sm">Embedding service not available. Check VOYAGE_API_KEY configuration.</div>}
          <div className="flex gap-2">
            <button onClick={previewEntities} className="px-3 py-1.5 bg-gray-200 rounded text-sm hover:bg-gray-300">Preview Entities</button>
            <button onClick={startEmbeddings} disabled={!embInfo?.available} className="px-3 py-1.5 bg-blue-500 text-white rounded text-sm hover:bg-blue-600 disabled:opacity-50">Start Embedding Generation</button>
          </div>
          {embPreview && <div className="bg-blue-50 rounded p-3 text-sm"><strong>Entities to embed:</strong> {embPreview.count || 0}</div>}
          {embStatus && embStatus.status === 'running' && <ProgressBar progress={embStatus.progress?.percentComplete || 0} />}
        </div>
      </StageCard>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-bold mb-4">Full Pipeline Refresh</h2>
        <p className="text-gray-600 mb-2 text-sm">
          {selectedRun ? `Selected: ${selectedRun.runId}` : 'No scrape run selected. Will use most recent FULL run.'}
        </p>
        <div className="flex gap-4 items-center mb-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={skipCleanup} onChange={e => setSkipCleanup(e.target.checked)} /> Skip Cleanup
          </label>
        </div>
        {refreshJob && !['completed', 'failed', 'cancelled'].includes(refreshJob.phase) ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <JobStatusBadge status={refreshJob.phase} />
              <span className="text-sm text-gray-600">{refreshJob.message}</span>
              <div className="spinner"></div>
            </div>
            <ProgressBar progress={refreshJob.progress} />
            <button onClick={cancelRefresh} className="px-3 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600">Cancel</button>
          </div>
        ) : (
          <button onClick={startFullRefresh} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">Start Full Refresh from S3</button>
        )}
        {refreshJob?.phase === 'completed' && refreshJob.stats && (
          <div className="bg-green-50 border border-green-200 rounded p-3 mt-3 text-sm">
            <strong>Completed:</strong> {refreshJob.stats.entitiesCreated?.toLocaleString()} entities, {refreshJob.stats.relationshipsCreated?.toLocaleString()} relationships, {refreshJob.stats.embeddingsGenerated?.toLocaleString()} embeddings
          </div>
        )}
        {refreshJob?.phase === 'failed' && <div className="bg-red-50 border border-red-200 rounded p-3 mt-3 text-sm text-red-700">{refreshJob.error}</div>}
      </div>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Job History</h2>
          <button onClick={fetchJobs} className="px-3 py-1 bg-gray-200 rounded text-sm hover:bg-gray-300">Refresh</button>
        </div>
        {allJobs.length === 0 ? <p className="text-gray-500">No jobs found</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase">
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Progress</th>
                  <th className="px-3 py-2">Started</th>
                  <th className="px-3 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {allJobs.map((j, i) => (
                  <tr key={j.jobId || i} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-xs">{j.type}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${j.status === 'completed' ? 'bg-green-100 text-green-800' : j.status === 'running' ? 'bg-blue-100 text-blue-800' : j.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                        {j.status || j.phase}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">{j.progress?.percentComplete != null ? `${j.progress.percentComplete}%` : j.progress != null ? `${j.progress}%` : '-'}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{j.startedAt ? new Date(j.startedAt).toLocaleString() : '-'}</td>
                    <td className="px-3 py-2">
                      {(j.status === 'running' || j.status === 'pending') && (
                        <button onClick={() => j.source === 'admin' ? cancelRefresh() : cancelProcessingJob(j.jobId)}
                          className="text-red-500 hover:text-red-700 text-xs">Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
