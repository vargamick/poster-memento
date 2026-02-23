import React, { useState, useEffect, useCallback, useRef } from 'react';
import { chatApi } from '../api/client';
import { Pagination } from '../components/shared/Pagination';
import { ToolChip } from '../components/shared/ToolChip';
import { formatDuration, formatTokens, formatCost, timeAgo } from '../utils/formatters';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MODEL_INFO: Record<string, { label: string; icon: string; color: string }> = {
  'claude-haiku-4-5-20251001': { label: 'Haiku 4.5', icon: 'H', color: 'bg-emerald-100 text-emerald-700' },
  'claude-sonnet-4-5-20250929': { label: 'Sonnet 4.5', icon: 'S', color: 'bg-violet-100 text-violet-700' },
  'claude-opus-4-20250514': { label: 'Opus 4', icon: 'O', color: 'bg-amber-100 text-amber-700' },
  'claude-opus-4-6': { label: 'Opus 4.6', icon: 'O', color: 'bg-amber-100 text-amber-700' },
  'gpt-4o': { label: 'GPT-4o', icon: 'G', color: 'bg-sky-100 text-sky-700' },
  'gpt-4o-mini': { label: 'GPT-4o Mini', icon: 'g', color: 'bg-sky-50 text-sky-600' },
};

function ModelIcon({ modelId }: { modelId: string | null }) {
  if (!modelId) return <span className="text-gray-300">-</span>;
  const info = MODEL_INFO[modelId] || { label: modelId, icon: modelId.charAt(0).toUpperCase(), color: 'bg-gray-100 text-gray-600' };
  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold cursor-default ${info.color}`}
      title={info.label + (modelId ? ' (' + modelId + ')' : '')}
    >
      {info.icon}
    </span>
  );
}

function SortableHeader({ label, field, sortBy, sortDir, onSort, className }: {
  label: string; field: string; sortBy: string | null; sortDir: string; onSort: (field: string) => void; className?: string;
}) {
  const active = sortBy === field;
  return (
    <th
      className={`px-4 py-3 cursor-pointer select-none hover:text-gray-700 ${className || ''}`}
      onClick={() => onSort(field)}
    >
      <div className={`flex items-center gap-1 ${className && className.includes('text-right') ? 'justify-end' : ''}`}>
        {label}
        <span className={`text-xs ${active ? 'text-blue-500' : 'text-gray-300'}`}>
          {active ? (sortDir === 'asc' ? '\u25B2' : '\u25BC') : '\u25BC'}
        </span>
      </div>
    </th>
  );
}

function LogStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    success: 'bg-green-100 text-green-800',
    error: 'bg-red-100 text-red-800',
    in_progress: 'bg-yellow-100 text-yellow-800',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
      {status}
    </span>
  );
}

function LogStatsPanel({ stats }: { stats: any }) {
  if (!stats) return null;
  const cards = [
    { label: 'Total Queries', value: stats.totalQueries || 0 },
    { label: 'Success Rate', value: stats.successRate ? `${stats.successRate}%` : '-' },
    { label: 'Avg Duration', value: formatDuration(stats.avgDurationMs) },
    { label: 'Avg Tokens', value: formatTokens(stats.avgTokenCount) },
    { label: 'Avg Cost', value: formatCost(stats.avgCost) },
    { label: 'Total Cost', value: formatCost(stats.totalCost) },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
      {cards.map((card, i) => (
        <div key={i} className="bg-white rounded-lg shadow p-4">
          <div className="text-sm text-gray-500">{card.label}</div>
          <div className="text-2xl font-bold mt-1">{card.value}</div>
        </div>
      ))}
    </div>
  );
}

function LogFiltersBar({ filters, onChange, onRefresh, onExport, onDeleteAll, autoRefresh, onToggleAutoRefresh }: any) {
  return (
    <div className="flex flex-wrap gap-3 mb-4 items-center">
      <input type="text" placeholder="Search questions..." value={filters.search || ''}
        onChange={(e) => onChange({ ...filters, search: e.target.value, page: 1 })}
        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64" />
      <select value={filters.status || ''}
        onChange={(e) => onChange({ ...filters, status: e.target.value, page: 1 })}
        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
        <option value="">All statuses</option>
        <option value="success">Success</option>
        <option value="error">Error</option>
        <option value="in_progress">In Progress</option>
      </select>
      <input type="date" value={filters.from || ''}
        onChange={(e) => onChange({ ...filters, from: e.target.value, page: 1 })}
        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      <span className="text-gray-400 text-sm">to</span>
      <input type="date" value={filters.to || ''}
        onChange={(e) => onChange({ ...filters, to: e.target.value, page: 1 })}
        className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      <button onClick={onRefresh} className="px-3 py-1.5 bg-gray-200 rounded-lg text-sm hover:bg-gray-300 transition">Refresh</button>
      <button onClick={() => onExport('csv')} className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm hover:bg-blue-200 transition">Export CSV</button>
      <button onClick={() => onExport('json')} className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-sm hover:bg-blue-200 transition">Export JSON</button>
      <button onClick={onDeleteAll} className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm hover:bg-red-200 transition">Delete All</button>
      <label className="flex items-center gap-1.5 text-sm text-gray-600 ml-auto cursor-pointer">
        <input type="checkbox" checked={autoRefresh} onChange={onToggleAutoRefresh} className="rounded" />
        Auto-refresh
      </label>
    </div>
  );
}

function EventTimeline({ events }: { events: any[] }) {
  if (!events || events.length === 0) return <p className="text-gray-400 text-sm">No events recorded.</p>;

  const icons: Record<string, { icon: string; color: string }> = {
    'stream.start': { icon: '>', color: 'text-blue-500' },
    'progress.status': { icon: '...', color: 'text-yellow-600' },
    'tool.call_complete': { icon: 'T', color: 'text-purple-600' },
    'tool.product': { icon: 'P', color: 'text-green-600' },
    'meta.prompts': { icon: '?', color: 'text-indigo-500' },
    'stream.end': { icon: 'OK', color: 'text-green-600' },
    'stream.error': { icon: 'X', color: 'text-red-600' },
  };

  return (
    <div className="space-y-2">
      {events.map((evt, i) => {
        const { icon, color } = icons[evt.event_type] || { icon: '.', color: 'text-gray-500' };
        return (
          <div key={i} className="flex gap-3 items-start text-sm">
            <span className={`font-mono font-bold w-6 text-center ${color}`}>{icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700">{evt.event_type}</span>
                {evt.tool_name && <ToolChip name={evt.tool_name} />}
                {evt.tool_duration_ms != null && (
                  <span className="text-xs text-gray-400">{formatDuration(evt.tool_duration_ms)}</span>
                )}
              </div>
              {evt.tool_input && (
                <details className="mt-1">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">Input</summary>
                  <pre className="json bg-gray-50 p-2 rounded mt-1">{JSON.stringify(evt.tool_input, null, 2)}</pre>
                </details>
              )}
              {evt.tool_output && (
                <details className="mt-1">
                  <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">Output ({evt.tool_output.length} chars)</summary>
                  <pre className="json bg-gray-50 p-2 rounded mt-1">{evt.tool_output}</pre>
                </details>
              )}
              {evt.event_data && !evt.tool_name && (
                <pre className="json text-gray-500 mt-0.5">{JSON.stringify(evt.event_data, null, 2)}</pre>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QueryLogDetail({ logId }: { logId: number }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    chatApi<any>(`/chat/logs/${logId}`)
      .then((res) => setData(res.data))
      .catch((err) => console.error('Failed to load log detail', err))
      .finally(() => setLoading(false));
  }, [logId]);

  if (loading) return <div className="p-4"><div className="spinner"></div></div>;
  if (!data) return <div className="p-4 text-red-500">Failed to load details</div>;

  const { log, events } = data;

  return (
    <div className="bg-gray-50 border-t border-gray-200 p-4 space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-gray-600 mb-1">Answer</h4>
        <div className="bg-white rounded p-3 text-sm whitespace-pre-wrap max-h-64 overflow-y-auto border">
          {log.answer || <span className="text-gray-400 italic">No answer</span>}
        </div>
      </div>

      {log.error_message && (
        <div>
          <h4 className="text-sm font-semibold text-red-600 mb-1">Error: {log.error_code}</h4>
          <div className="bg-red-50 rounded p-3 text-sm text-red-700 border border-red-200">{log.error_message}</div>
        </div>
      )}

      {log.products && log.products.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-600 mb-1">Products ({log.products.length})</h4>
          <div className="flex flex-wrap gap-2">
            {log.products.map((p: any, i: number) => (
              <div key={i} className="bg-white rounded px-3 py-1.5 text-sm border flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                {p.category && <span className="text-gray-400 text-xs">{p.category}</span>}
                {p.role && <span className={`text-xs px-1 rounded ${p.role === 'recommendation' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{p.role}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {log.follow_up_prompts && log.follow_up_prompts.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-600 mb-1">Follow-up Prompts</h4>
          <ul className="list-disc list-inside text-sm text-gray-600">
            {log.follow_up_prompts.map((p: string, i: number) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-gray-600 mb-2">Event Timeline ({events.length} events)</h4>
        <EventTimeline events={events} />
      </div>
    </div>
  );
}

function QueryLogsTable({ logs, expandedId, onToggleExpand, onDeleteLog, sortBy, sortDir, onSort }: any) {
  if (!logs || logs.length === 0) {
    return <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">No query logs found</div>;
  }

  // Client-side sort
  const sorted = [...logs].sort((a: any, b: any) => {
    if (!sortBy) return 0;
    let valA: any, valB: any;
    switch (sortBy) {
      case 'question': valA = (a.question || '').toLowerCase(); valB = (b.question || '').toLowerCase(); break;
      case 'model': valA = (a.model || '').toLowerCase(); valB = (b.model || '').toLowerCase(); break;
      case 'time': valA = new Date(a.created_at).getTime(); valB = new Date(b.created_at).getTime(); break;
      case 'duration': valA = a.duration_ms || 0; valB = b.duration_ms || 0; break;
      case 'tokens': valA = a.token_count || 0; valB = b.token_count || 0; break;
      case 'cost': valA = parseFloat(a.cost) || 0; valB = parseFloat(b.cost) || 0; break;
      case 'status': valA = a.status || ''; valB = b.status || ''; break;
      default: return 0;
    }
    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            <SortableHeader label="Time" field="time" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortableHeader label="Question" field="question" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortableHeader label="Model" field="model" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <SortableHeader label="Status" field="status" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <th className="px-4 py-3">Tools</th>
            <th className="px-4 py-3">Products</th>
            <SortableHeader label="Duration" field="duration" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="text-right" />
            <SortableHeader label="Tokens" field="tokens" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="text-right" />
            <SortableHeader label="Cost" field="cost" sortBy={sortBy} sortDir={sortDir} onSort={onSort} className="text-right" />
            <th className="px-4 py-3 w-10"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((log: any) => (
            <React.Fragment key={log.id}>
              <tr
                className={`hover:bg-gray-50 cursor-pointer transition ${expandedId === log.id ? 'bg-blue-50' : ''}`}
                onClick={() => onToggleExpand(log.id)}
              >
                <td className="px-4 py-3 whitespace-nowrap text-gray-500" title={new Date(log.created_at).toLocaleString()}>
                  {timeAgo(log.created_at)}
                </td>
                <td className="px-4 py-3 max-w-xs truncate" title={log.question}>
                  {log.question.length > 80 ? log.question.substring(0, 80) + '...' : log.question}
                </td>
                <td className="px-4 py-3 text-center">
                  <ModelIcon modelId={log.model} />
                </td>
                <td className="px-4 py-3"><LogStatusBadge status={log.status} /></td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {(log.tools_called || []).map((t: string, i: number) => <ToolChip key={i} name={t} />)}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  {(log.products || []).length > 0
                    ? (log.products || []).map((p: any) => p.name).join(', ')
                    : '-'
                  }
                </td>
                <td className="px-4 py-3 text-right text-gray-600 font-mono">{formatDuration(log.duration_ms)}</td>
                <td className="px-4 py-3 text-right text-gray-600 font-mono">{formatTokens(log.token_count)}</td>
                <td className="px-4 py-3 text-right text-gray-600 font-mono">{formatCost(log.cost)}</td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteLog(log.id, log.question); }}
                    className="text-gray-400 hover:text-red-600 transition"
                    title="Delete this log"
                  >
                    &#x2715;
                  </button>
                </td>
              </tr>
              {expandedId === log.id && (
                <tr>
                  <td colSpan={10} className="p-0">
                    <QueryLogDetail logId={log.id} />
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function QueryLogsTab() {
  const [logs, setLogs] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [filters, setFilters] = useState({ page: 1, search: '', status: '', from: '', to: '' });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState('asc');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(filters.page));
      params.set('limit', '50');
      if (filters.status) params.set('status', filters.status);
      if (filters.search) params.set('search', filters.search);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);

      const result = await chatApi<any>(`/chat/logs?${params}`);
      setLogs(result.data || []);
      setPagination(result.pagination);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  }, [filters]);

  const fetchStats = useCallback(async () => {
    try {
      const result = await chatApi<any>('/chat/logs/stats');
      setStats(result.data);
    } catch (err) {
      console.error('Failed to load stats', err);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    fetchStats();
  }, [fetchLogs, fetchStats]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        fetchLogs();
        fetchStats();
      }, 10000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, fetchLogs, fetchStats]);

  const handleRefresh = () => { fetchLogs(); fetchStats(); };
  const handlePageChange = (page: number) => setFilters((f) => ({ ...f, page }));
  const handleToggleExpand = (id: number) => setExpandedId(expandedId === id ? null : id);
  const handleSort = (field: string) => {
    if (sortBy === field) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }
    else { setSortBy(field); setSortDir('asc'); }
  };

  const handleExport = async (format: 'json' | 'csv') => {
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.search) params.set('search', filters.search);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      const result = await chatApi<any>(`/chat/logs/export?${params}`);
      const logs = result.data?.logs || result.data || [];

      if (format === 'csv') {
        const escapeCsv = (val: string) => {
          if (!val) return '';
          if (val.includes('"') || val.includes(',') || val.includes('\n')) {
            return '"' + val.replace(/"/g, '""') + '"';
          }
          return val;
        };
        const rows = [
          'Question,Answer',
          ...logs.map((l: any) => `${escapeCsv(l.question || '')},${escapeCsv(l.answer || '')}`),
        ];
        const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `query-logs-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `query-logs-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      setError('Export failed: ' + err.message);
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm('Are you sure you want to delete ALL query logs? This cannot be undone.')) return;
    try {
      await chatApi('/chat/logs', { method: 'DELETE' });
      setError(null);
      handleRefresh();
    } catch (err: any) {
      setError('Delete failed: ' + err.message);
    }
  };

  const handleDeleteLog = async (id: number, question: string) => {
    const preview = question.length > 60 ? question.substring(0, 60) + '...' : question;
    if (!window.confirm(`Delete log #${id}?\n\n"${preview}"`)) return;
    try {
      await chatApi(`/chat/logs/${id}`, { method: 'DELETE' });
      setExpandedId(null);
      handleRefresh();
    } catch (err: any) {
      setError('Delete failed: ' + err.message);
    }
  };

  return (
    <div>
      <LogStatsPanel stats={stats} />

      <LogFiltersBar
        filters={filters}
        onChange={setFilters}
        onRefresh={handleRefresh}
        onExport={handleExport}
        onDeleteAll={handleDeleteAll}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={() => setAutoRefresh(!autoRefresh)}
      />

      {error && (
        <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>
      )}

      {loading && logs.length === 0 ? (
        <div className="flex justify-center p-12"><div className="spinner"></div></div>
      ) : (
        <QueryLogsTable logs={logs} expandedId={expandedId} onToggleExpand={handleToggleExpand} onDeleteLog={handleDeleteLog} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
      )}

      <Pagination pagination={pagination} onPageChange={handlePageChange} />
    </div>
  );
}
