import { useState, useEffect, useCallback } from 'react';
import { adminApi, chatApi } from '../api/client';
import { useInstanceConfig } from '../hooks/useInstanceConfig';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function OperationsTab() {
  const { config } = useInstanceConfig();
  const hasQueryLogs = config?.features?.queryLogs !== false && config?.modelType === 'chat';

  const [resetPreview, setResetPreview] = useState<any>(null);
  const [loading, setLoading] = useState({ reset: false });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchResetPreview = useCallback(async () => {
    try {
      const res = await adminApi<any>('/reset/preview');
      setResetPreview(res.data);
    } catch (err: any) { console.error('Reset preview error', err); }
  }, []);

  useEffect(() => { fetchResetPreview(); }, []);

  const resetDatabases = async () => {
    if (!window.confirm('Are you sure? This will delete ALL data. A backup will be created automatically.')) return;
    setLoading(l => ({ ...l, reset: true }));
    try {
      await adminApi('/reset', { method: 'POST', headers: { 'x-admin-confirm': 'RESET' } });
      setSuccess('Database reset complete. Backup was created.');
      fetchResetPreview();
    } catch (err: any) { setError(err.message); }
    finally { setLoading(l => ({ ...l, reset: false })); }
  };

  const clearQueryLogs = async () => {
    if (!window.confirm('Delete ALL query logs? This cannot be undone.')) return;
    try {
      const res = await chatApi<any>('/chat/logs', { method: 'DELETE' });
      setSuccess(res.message || 'Query logs cleared');
    } catch (err: any) { setError(err.message); }
  };

  return (
    <div>
      <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-6 text-yellow-800">
        <strong>Warning:</strong> Operations on this page are destructive and cannot be easily undone. Proceed with caution.
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded mb-4">{error} <button onClick={() => setError(null)} className="float-right">x</button></div>}
      {success && <div className="bg-green-50 text-green-700 p-3 rounded mb-4">{success} <button onClick={() => setSuccess(null)} className="float-right">x</button></div>}

      <div className="bg-white rounded-lg shadow border-l-4 border-red-400 p-6 mb-6">
        <h2 className="text-xl font-bold mb-4 text-red-700">Database Reset</h2>
        {resetPreview && (
          <div className="bg-yellow-50 border border-yellow-200 rounded p-4 mb-4">
            <p className="font-semibold text-yellow-800">This will delete:</p>
            <ul className="mt-2 text-sm text-yellow-700">
              <li>{resetPreview.willDelete.entities.toLocaleString()} entities</li>
              <li>{resetPreview.willDelete.relationships.toLocaleString()} relationships</li>
              <li>{resetPreview.willDelete.embeddings.toLocaleString()} embeddings</li>
            </ul>
            <p className="mt-2 text-sm text-yellow-600">Estimated time: {resetPreview.estimatedDuration}</p>
            <p className="mt-1 text-sm text-green-700">A backup will be created automatically before reset.</p>
          </div>
        )}
        <button onClick={resetDatabases} disabled={loading.reset}
          className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50">
          {loading.reset ? 'Resetting...' : 'Reset Databases'}
        </button>
      </div>

      {hasQueryLogs && (
        <div className="bg-white rounded-lg shadow border-l-4 border-orange-400 p-6 mb-6">
          <h2 className="text-xl font-bold mb-4 text-orange-700">Clear Query Logs</h2>
          <p className="text-sm text-gray-600 mb-4">Delete all query logs and associated events from PostgreSQL.</p>
          <button onClick={clearQueryLogs} className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600">Delete All Query Logs</button>
        </div>
      )}
    </div>
  );
}
