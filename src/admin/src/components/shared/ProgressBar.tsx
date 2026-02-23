export function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="w-full bg-gray-200 rounded-full h-4">
      <div
        className="bg-blue-600 h-4 rounded-full transition-all duration-300"
        style={{ width: `${progress}%` }}
      >
        <span className="text-xs text-white pl-2">{progress}%</span>
      </div>
    </div>
  );
}
