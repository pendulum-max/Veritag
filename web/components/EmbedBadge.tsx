import type { VerificationStatus, VerificationSummary } from "../lib/stellar";

export interface EmbedBadgeMeta {
  label: string;
  brandVerificationLabel: string;
  sealText: string;
  containerClasses: string;
  badgeClasses: string;
  dotClasses: string;
}

const STATUS_BADGE_MAP: Record<
  VerificationStatus,
  { label: string; containerClasses: string; badgeClasses: string; dotClasses: string }
> = {
  AuthenticInactive: {
    label: "Authentic · Unclaimed",
    containerClasses: "border-emerald-200 bg-white",
    badgeClasses: "bg-emerald-50 text-emerald-800 border-emerald-200",
    dotClasses: "bg-emerald-500",
  },
  AuthenticActive: {
    label: "Authentic · Active Warranty",
    containerClasses: "border-blue-200 bg-white",
    badgeClasses: "bg-blue-50 text-blue-800 border-blue-200",
    dotClasses: "bg-blue-600",
  },
  AlreadyClaimedWarning: {
    label: "Warning · Duplicate Claim",
    containerClasses: "border-amber-300 bg-white",
    badgeClasses: "bg-amber-50 text-amber-800 border-amber-200",
    dotClasses: "bg-amber-500",
  },
  Flagged: {
    label: "Alert · Flagged",
    containerClasses: "border-red-300 bg-white",
    badgeClasses: "bg-red-50 text-red-800 border-red-200",
    dotClasses: "bg-red-600",
  },
  Recalled: {
    label: "Safety Recall Active",
    containerClasses: "border-red-400 bg-white",
    badgeClasses: "bg-red-50 text-red-800 border-red-200",
    dotClasses: "bg-red-600",
  },
  Retired: {
    label: "Retired · Replaced",
    containerClasses: "border-slate-300 bg-white",
    badgeClasses: "bg-slate-100 text-slate-800 border-slate-200",
    dotClasses: "bg-slate-500",
  },
  Unknown: {
    label: "Unverified Serial",
    containerClasses: "border-red-300 bg-white",
    badgeClasses: "bg-red-50 text-red-800 border-red-200",
    dotClasses: "bg-red-600",
  },
};

/**
 * Formats remaining warranty duration for compact marketplace badge display.
 */
export function formatRemainingWarranty(
  warrantyExpiry?: number,
  warrantyValid?: boolean,
  warrantyMonths?: number,
  nowSec = Math.floor(Date.now() / 1000),
): string {
  if (typeof warrantyExpiry === "number" && warrantyExpiry > 0) {
    if (warrantyValid === false || warrantyExpiry <= nowSec) {
      return "Warranty Expired";
    }
    const daysLeft = Math.max(1, Math.round((warrantyExpiry - nowSec) / 86_400));
    return `${daysLeft} days left`;
  }
  if (typeof warrantyMonths === "number" && warrantyMonths > 0) {
    return `${warrantyMonths} mo on activation`;
  }
  return "No active warranty";
}

/**
 * Derives display metadata and visual styling for the embeddable verification badge.
 */
export function getEmbedBadgeMeta(summary: VerificationSummary): EmbedBadgeMeta {
  const statusMeta = STATUS_BADGE_MAP[summary.status];
  return {
    ...statusMeta,
    brandVerificationLabel: summary.brand.verified
      ? `Verified Brand${summary.brand.domain ? ` · ${summary.brand.domain}` : ""}`
      : "Unverified Brand",
    sealText: summary.ledgerSequence
      ? `On-Chain Seal · Ledger #${summary.ledgerSequence}`
      : "On-Chain Seal · Stellar Soroban",
  };
}

interface EmbedBadgeProps {
  summary: VerificationSummary;
  brand: string;
  serial: string;
}

/**
 * Compact, responsive, tamper-proof authenticity badge widget for resale marketplace iframes.
 */
export function EmbedBadge({ summary, brand, serial }: EmbedBadgeProps) {
  const meta = getEmbedBadgeMeta(summary);
  const warrantyText = formatRemainingWarranty(
    summary.unit?.warrantyExpiry,
    summary.unit?.warrantyValid,
    summary.batch?.warrantyMonths,
  );
  const verifyHref = `/v/${encodeURIComponent(brand)}/${encodeURIComponent(serial)}`;

  return (
    <aside
      aria-label="Veritag On-Chain Authenticity Badge"
      className={`w-full max-w-md rounded-2xl border p-4 shadow-sm transition-colors ${meta.containerClasses}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-slate-900">
              {meta.brandVerificationLabel}
            </div>
            <div className="truncate font-mono text-[11px] text-slate-500">{serial}</div>
          </div>
        </div>

        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.badgeClasses}`}
        >
          <span className={`h-2 w-2 rounded-full ${meta.dotClasses}`} />
          {meta.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-2.5 text-xs">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Warranty
          </div>
          <div className="mt-0.5 font-semibold text-slate-900">{warrantyText}</div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Contract
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] font-medium text-slate-700">
            {summary.contractId.slice(0, 10)}...{summary.contractId.slice(-4)}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5 text-[11px]">
        <span className="inline-flex items-center gap-1 font-medium text-slate-600">
          <svg
            className="h-3.5 w-3.5 text-blue-600"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          {meta.sealText}
        </span>
        <a
          href={verifyHref}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-blue-600 hover:text-blue-700"
        >
          Verify on Veritag →
        </a>
      </div>
    </aside>
  );
}
