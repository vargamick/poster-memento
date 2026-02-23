interface PaginationData {
  page: number;
  totalPages: number;
  total: number;
}

interface PaginationProps {
  pagination: PaginationData | null;
  onPageChange: (page: number) => void;
}

export function Pagination({ pagination, onPageChange }: PaginationProps) {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, totalPages, total } = pagination;
  return (
    <div className="flex items-center justify-between mt-4 text-sm text-gray-600">
      <span>{total} total queries</span>
      <div className="flex gap-2">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-gray-100 transition"
        >
          Previous
        </button>
        <span className="px-3 py-1">Page {page} of {totalPages}</span>
        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="px-3 py-1 rounded border disabled:opacity-40 hover:bg-gray-100 transition"
        >
          Next
        </button>
      </div>
    </div>
  );
}
