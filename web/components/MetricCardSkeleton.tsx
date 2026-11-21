interface MetricCardSkeletonProps {
  count?: number;
  className?: string;
}

const GRID_COLS_CLASS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
};

/**
 * Pulse-animated skeleton placeholder mimicking metric summary cards while data loads.
 */
export function MetricCardSkeleton({ count = 3, className = "" }: MetricCardSkeletonProps) {
  const colsClass = GRID_COLS_CLASS[Math.min(Math.max(count, 1), 4)] ?? "sm:grid-cols-3";
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading metric summary cards"
      className={`grid gap-3 ${colsClass} ${className}`.trim()}
    >
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-2.5"
        >
          <div className="h-3 w-24 rounded bg-slate-200" />
          <div className="h-6 w-20 rounded bg-slate-300" />
          <div className="h-2.5 w-32 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}
