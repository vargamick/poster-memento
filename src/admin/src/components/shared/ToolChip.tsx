const COLORS: Record<string, string> = {
  semantic_search: 'bg-blue-100 text-blue-700',
  open_nodes: 'bg-purple-100 text-purple-700',
  find_paths: 'bg-orange-100 text-orange-700',
};

export function ToolChip({ name }: { name: string }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono ${COLORS[name] || 'bg-gray-100 text-gray-700'}`}>
      {name}
    </span>
  );
}
