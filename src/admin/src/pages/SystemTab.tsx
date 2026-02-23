import { useState, useEffect, useCallback } from 'react';
import { adminApi } from '../api/client';
import { JobStatusBadge } from '../components/shared/Badge';
import { ProgressBar } from '../components/shared/ProgressBar';

/* eslint-disable @typescript-eslint/no-explicit-any */

function Dashboard({ health, stats, onRefresh }: { health: any; stats: any; onRefresh: () => void }) {
  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">System Status</h2>
        <button onClick={onRefresh} className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300">Refresh</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">Health</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Neo4j:</span>
              <span className={health?.neo4j?.connected ? 'text-green-600' : 'text-red-600'}>
                {health?.neo4j?.connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>PostgreSQL:</span>
              <span className={health?.postgres?.connected ? 'text-green-600' : 'text-red-600'}>
                {health?.postgres?.connected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>S3:</span>
              <span className={health?.s3?.configured ? 'text-green-600' : 'text-yellow-600'}>
                {health?.s3?.configured ? 'Configured' : 'Not Configured'}
              </span>
            </div>
          </div>
        </div>

        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">Neo4j</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Entities:</span>
              <span className="font-mono">{stats?.neo4j?.entities?.toLocaleString() || 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Relationships:</span>
              <span className="font-mono">{stats?.neo4j?.relationships?.toLocaleString() || 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Labels:</span>
              <span className="font-mono">{stats?.neo4j?.labels?.length || 0}</span>
            </div>
          </div>
        </div>

        <div className="border rounded p-4">
          <h3 className="font-semibold mb-2">PostgreSQL</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span>Embeddings:</span>
              <span className="font-mono">{stats?.postgres?.embeddings?.toLocaleString() || 0}</span>
            </div>
            <div className="flex justify-between">
              <span>Table Size:</span>
              <span className="font-mono">{stats?.postgres?.tableSize || '0 bytes'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function JobStatus({ job, onCancel }: { job: any; onCancel: (id: string) => void }) {
  if (!job) return null;
  const isRunning = !['completed', 'failed', 'cancelled'].includes(job.phase);

  return (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Current Job</h2>
        {isRunning && (
          <button onClick={() => onCancel(job.jobId)} className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">Cancel</button>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <JobStatusBadge status={job.phase} />
          <span className="text-gray-600">{job.message}</span>
          {isRunning && <div className="spinner"></div>}
        </div>

        <ProgressBar progress={job.progress} />

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Job ID:</span>
            <span className="ml-2 font-mono">{job.jobId}</span>
          </div>
          <div>
            <span className="text-gray-500">Started:</span>
            <span className="ml-2">{new Date(job.startedAt).toLocaleString()}</span>
          </div>
          {job.scrapeRunId && (
            <div>
              <span className="text-gray-500">Scrape Run:</span>
              <span className="ml-2 font-mono text-xs">{job.scrapeRunId}</span>
            </div>
          )}
          {job.backupTimestamp && (
            <div>
              <span className="text-gray-500">Backup:</span>
              <span className="ml-2 font-mono text-xs">{job.backupTimestamp}</span>
            </div>
          )}
        </div>

        {job.error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-red-700">
            <strong>Error:</strong> {job.error}
          </div>
        )}

        {job.phase === 'completed' && job.stats && (
          <div className="bg-green-50 border border-green-200 rounded p-3">
            <strong>Results:</strong>
            <ul className="mt-2 text-sm">
              <li>Entities created: {job.stats.entitiesCreated?.toLocaleString()}</li>
              <li>Relationships created: {job.stats.relationshipsCreated?.toLocaleString()}</li>
              <li>Embeddings generated: {job.stats.embeddingsGenerated?.toLocaleString()}</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function SystemTab() {
  const [health, setHealth] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [healthRes, statsRes] = await Promise.all([
        adminApi<any>('/health'),
        adminApi<any>('/stats'),
      ]);
      setHealth(healthRes);
      setStats(statsRes.data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, []);

  return (
    <div>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-4 mb-6 text-red-700">
          <strong>Error:</strong> {error}
          <button onClick={() => setError(null)} className="float-right">x</button>
        </div>
      )}
      <Dashboard health={health} stats={stats} onRefresh={fetchStatus} />
    </div>
  );
}
