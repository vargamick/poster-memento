import { useState, useEffect, useCallback, useRef } from 'react';
import { questionsApi } from '../api/client';
import { ProgressBar } from '../components/shared/ProgressBar';
import { formatDuration, timeAgo } from '../utils/formatters';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function QuestionRunnerTab() {
  const [questions, setQuestions] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [batchStatus, setBatchStatus] = useState<any>(null);
  const [newQuestion, setNewQuestion] = useState('');
  const [batchCount, setBatchCount] = useState(5);
  const [selectionMethod, setSelectionMethod] = useState('sequential_start');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchQuestions = useCallback(async (page = 1) => {
    try {
      const res = await questionsApi<any>(`?page=${page}&limit=50`);
      setQuestions(res.data || []);
      setPagination(res.pagination);
    } catch (err) { console.error('Fetch questions error', err); }
  }, []);

  const fetchBatchStatus = useCallback(async () => {
    try {
      const res = await questionsApi<any>('/run/status');
      setBatchStatus(res.data);
    } catch (err) { console.error('Batch status error', err); }
  }, []);

  useEffect(() => { fetchQuestions(); fetchBatchStatus(); }, []);

  useEffect(() => {
    if (batchStatus?.status === 'running') {
      intervalRef.current = setInterval(fetchBatchStatus, 2000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [batchStatus?.status]);

  const handleAdd = async () => {
    if (!newQuestion.trim()) return;
    try {
      await questionsApi('', { method: 'POST', body: JSON.stringify({ question: newQuestion.trim() }) });
      setNewQuestion('');
      fetchQuestions();
    } catch (err: any) { setError(err.message); }
  };

  const handleDelete = async (id: number) => {
    try { await questionsApi(`/${id}`, { method: 'DELETE' }); fetchQuestions(); } catch (err: any) { setError(err.message); }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm('Delete ALL questions from the bank?')) return;
    try { await questionsApi('', { method: 'DELETE' }); fetchQuestions(); } catch (err: any) { setError(err.message); }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      let content = await file.text();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.some((b, i) => b === 0 && i > 0)) {
        content = new TextDecoder('utf-16le').decode(bytes);
      }
      const res = await questionsApi<any>('/import', { method: 'POST', body: JSON.stringify({ content, fileName: file.name }) });
      setError(null);
      alert(res.message);
      fetchQuestions();
    } catch (err: any) { setError(err.message); }
    e.target.value = '';
  };

  const handleStartBatch = async () => {
    try {
      setError(null);
      await questionsApi('/run', { method: 'POST', body: JSON.stringify({ count: batchCount, selectionMethod }) });
      fetchBatchStatus();
    } catch (err: any) { setError(err.message); }
  };

  const handleCancelBatch = async () => {
    try { await questionsApi('/run/cancel', { method: 'POST' }); fetchBatchStatus(); } catch (err: any) { setError(err.message); }
  };

  const handleProcessAll = async () => {
    const total = pagination?.total || questions.length;
    if (total === 0) { setError('No questions to process'); return; }
    if (!window.confirm(`Process all ${total} questions? This may take a while.`)) return;
    try {
      setError(null);
      await questionsApi('/run', { method: 'POST', body: JSON.stringify({ count: total, selectionMethod: 'sequential_start' }) });
      fetchBatchStatus();
    } catch (err: any) { setError(err.message); }
  };

  const handleProcessSelected = async () => {
    if (selectedIds.size === 0) { setError('No questions selected'); return; }
    try {
      setError(null);
      await questionsApi('/run', { method: 'POST', body: JSON.stringify({ questionIds: Array.from(selectedIds) }) });
      setSelectedIds(new Set());
      fetchBatchStatus();
    } catch (err: any) { setError(err.message); }
  };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === questions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(questions.map(q => q.id)));
    }
  };

  return (
    <div>
      {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error} <button onClick={() => setError(null)} className="float-right">x</button></div>}

      {batchStatus && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-xl font-bold">Batch Run</h2>
            <span className={`px-3 py-1 rounded text-sm font-medium ${batchStatus.status === 'running' ? 'bg-blue-100 text-blue-800' : batchStatus.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
              {batchStatus.status}
            </span>
          </div>
          <ProgressBar progress={batchStatus.progress.total > 0 ? Math.round((batchStatus.progress.processed / batchStatus.progress.total) * 100) : 0} />
          <div className="flex gap-6 mt-3 text-sm text-gray-600">
            <span>Total: {batchStatus.progress.total}</span>
            <span>Processed: {batchStatus.progress.processed}</span>
            <span className="text-green-600">Success: {batchStatus.progress.succeeded}</span>
            <span className="text-red-600">Failed: {batchStatus.progress.failed}</span>
          </div>
          {batchStatus.currentQuestion && (
            <div className="mt-2 text-sm text-gray-500">Current: <em>{batchStatus.currentQuestion.substring(0, 100)}</em></div>
          )}
          {batchStatus.status === 'running' && (
            <button onClick={handleCancelBatch} className="mt-3 px-3 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600">Cancel Batch</button>
          )}
          {batchStatus.results.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Question</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Duration</th>
                    <th className="px-3 py-2">Log ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {batchStatus.results.map((r: any, i: number) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-gray-500">{i + 1}</td>
                      <td className="px-3 py-2 max-w-xs truncate" title={r.question}>{r.question.substring(0, 80)}</td>
                      <td className="px-3 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs ${r.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>{r.status}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{formatDuration(r.durationMs)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.logId || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-xl font-bold mb-4">Run Batch</h2>
        <div className="flex gap-4 items-end flex-wrap">
          <div>
            <label className="block text-sm text-gray-600 mb-1">Questions to run</label>
            <input type="number" value={batchCount} min="1" max="100" onChange={e => setBatchCount(parseInt(e.target.value) || 1)}
              className="w-24 px-3 py-2 border rounded" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Selection method</label>
            <select value={selectionMethod} onChange={e => setSelectionMethod(e.target.value)}
              className="px-3 py-2 border rounded">
              <option value="sequential_start">Sequential (start)</option>
              <option value="sequential_end">Sequential (end)</option>
              <option value="random">Random</option>
            </select>
          </div>
          <button onClick={handleStartBatch} disabled={batchStatus?.status === 'running'}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed">
            {batchStatus?.status === 'running' ? 'Running...' : 'Start Batch'}
          </button>
          <div className="border-l border-gray-300 mx-2 h-8"></div>
          <button onClick={handleProcessAll} disabled={batchStatus?.status === 'running' || (pagination?.total || 0) === 0}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed">
            Process All ({pagination?.total || 0})
          </button>
          <button onClick={handleProcessSelected} disabled={batchStatus?.status === 'running' || selectedIds.size === 0}
            className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed">
            Process Selected ({selectedIds.size})
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">Question Bank ({pagination?.total || 0})</h2>
          <div className="flex gap-2">
            <label className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded text-sm cursor-pointer hover:bg-blue-200">
              Import File
              <input type="file" accept=".txt,.csv" onChange={handleImport} className="hidden" />
            </label>
            <button onClick={handleDeleteAll} className="px-3 py-1.5 bg-red-100 text-red-700 rounded text-sm hover:bg-red-200">Delete All</button>
          </div>
        </div>

        <div className="flex gap-2 mb-4">
          <input type="text" value={newQuestion} onChange={e => setNewQuestion(e.target.value)} placeholder="Type a question..."
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
            className="flex-1 px-3 py-2 border rounded text-sm" />
          <button onClick={handleAdd} className="px-4 py-2 bg-green-500 text-white rounded text-sm hover:bg-green-600">Add</button>
        </div>

        {questions.length === 0 ? <p className="text-gray-400 text-center py-4">No questions yet. Add manually or import a file.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase">
                  <th className="px-3 py-2 w-10">
                    <input type="checkbox" checked={questions.length > 0 && selectedIds.size === questions.length}
                      onChange={toggleSelectAll} className="rounded" aria-label="Select all questions" />
                  </th>
                  <th className="px-3 py-2 w-12">ID</th>
                  <th className="px-3 py-2">Question</th>
                  <th className="px-3 py-2 w-24">Source</th>
                  <th className="px-3 py-2 w-24">Added</th>
                  <th className="px-3 py-2 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {questions.map((q: any) => (
                  <tr key={q.id} className={`hover:bg-gray-50 ${selectedIds.has(q.id) ? 'bg-purple-50' : ''}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selectedIds.has(q.id)}
                        onChange={() => toggleSelect(q.id)} className="rounded" aria-label={`Select question ${q.id}`} />
                    </td>
                    <td className="px-3 py-2 text-gray-400 font-mono">{q.id}</td>
                    <td className="px-3 py-2">{q.question}</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${q.source === 'imported' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>{q.source}</span>
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{timeAgo(q.created_at)}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => handleDelete(q.id)} className="text-gray-400 hover:text-red-600">&times;</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className="flex justify-between items-center mt-3 text-sm text-gray-600">
            <span>{pagination.total} questions</span>
            <div className="flex gap-2">
              <button disabled={pagination.page <= 1} onClick={() => fetchQuestions(pagination.page - 1)} className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-gray-100">Prev</button>
              <span className="px-3 py-1">Page {pagination.page} of {pagination.totalPages}</span>
              <button disabled={pagination.page >= pagination.totalPages} onClick={() => fetchQuestions(pagination.page + 1)} className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-gray-100">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
