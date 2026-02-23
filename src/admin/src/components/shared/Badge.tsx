interface BadgeProps {
  status: string;
  colorMap?: Record<string, string>;
  variant?: 'pill' | 'rounded';
}

const DEFAULT_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  success: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  error: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-600',
  paused: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
};

export function Badge({ status, colorMap, variant = 'rounded' }: BadgeProps) {
  const colors = colorMap || DEFAULT_COLORS;
  const cls = colors[status] || 'bg-gray-100 text-gray-800';
  const shape = variant === 'pill' ? 'rounded-full' : 'rounded';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 ${shape} text-xs font-medium ${cls}`}>
      {(status || 'unknown').replace(/_/g, ' ')}
    </span>
  );
}

// Pre-configured badge for System tab job statuses (solid backgrounds)
const JOB_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-500 text-white',
  downloading: 'bg-blue-500 text-white',
  backing_up: 'bg-yellow-500 text-white',
  resetting: 'bg-orange-500 text-white',
  processing_metadata: 'bg-purple-500 text-white',
  extracting_pdf_metadata: 'bg-indigo-500 text-white',
  generating_embeddings: 'bg-pink-500 text-white',
  cleaning_up: 'bg-cyan-500 text-white',
  completed: 'bg-green-500 text-white',
  failed: 'bg-red-500 text-white',
  cancelled: 'bg-gray-600 text-white',
};

export function JobStatusBadge({ status }: { status: string }) {
  return (
    <span className={`px-2 py-1 rounded text-white text-sm ${JOB_STATUS_COLORS[status] || 'bg-gray-500'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
