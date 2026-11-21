"use client";

import { ErrorDiagnosticsCard } from "@/components/ErrorBoundary";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <ErrorDiagnosticsCard error={error} onReset={reset} />
    </div>
  );
}
