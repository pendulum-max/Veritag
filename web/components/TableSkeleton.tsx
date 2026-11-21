interface TableSkeletonProps {
  rows?: number;
  columns?: number;
  className?: string;
}

const WIDTH_CLASSES = ["w-3/4", "w-1/2", "w-2/3", "w-5/6", "w-1/3"];

/**
 * Pulse-animated skeleton loader mimicking data table rows to prevent layout shifts.
 */
export function TableSkeleton({
  rows = 4,
  columns = 4,
  className = "",
}: TableSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading table data"
      className={`animate-pulse rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4 ${className}`.trim()}
    >
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <div className="h-4 w-40 rounded bg-slate-200" />
        <div className="h-6 w-24 rounded-full bg-slate-200" />
      </div>

      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div
            key={rowIdx}
            className="grid gap-4 rounded-xl bg-slate-50 px-4 py-3"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns }).map((__, colIdx) => {
              const widthClass = WIDTH_CLASSES[(rowIdx + colIdx) % WIDTH_CLASSES.length] ?? "w-3/4";
              return (
                <div
                  key={colIdx}
                  className={`h-3.5 rounded ${colIdx === 0 ? "bg-slate-300" : "bg-slate-200"} ${widthClass}`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
