import type { VerificationStatus } from "@/lib/stellar";

const STATUS_META: Record<
  VerificationStatus,
  {
    badge: string;
    title: string;
    description: string;
    classes: string;
    dotClasses: string;
  }
> = {
  AuthenticInactive: {
    badge: "Authentic · Unclaimed",
    title: "Genuine Factory Unit — Ready for First Activation",
    description:
      "This serial belongs to a verified manufacturer Merkle batch on Stellar and has never been claimed.",
    classes: "border-emerald-200 bg-emerald-50 text-emerald-950",
    dotClasses: "bg-emerald-500",
  },
  AuthenticActive: {
    badge: "Authentic · Activated",
    title: "Genuine Registered Product",
    description:
      "Verified on-chain with active provenance and tamper-proof warranty tracking.",
    classes: "border-blue-200 bg-blue-50 text-blue-950",
    dotClasses: "bg-blue-600",
  },
  AlreadyClaimedWarning: {
    badge: "Warning · Duplicate Claim Detected",
    title: "Already Claimed — Potential Cloned Label or Resale Unit",
    description:
      "Multiple activation attempts were recorded against this unit's secret. If sold as factory-sealed, treat with caution.",
    classes: "border-amber-300 bg-amber-50 text-amber-950",
    dotClasses: "bg-amber-500",
  },
  Flagged: {
    badge: "Alert · Unit Flagged",
    title: "Flagged by Manufacturer",
    description:
      "The brand has flagged this specific serial number due to theft, diversion, or counterfeit evidence.",
    classes: "border-red-300 bg-red-50 text-red-950",
    dotClasses: "bg-red-600",
  },
  Recalled: {
    badge: "Safety Alert · Batch Recalled",
    title: "Product Recall Active",
    description:
      "The manufacturer has issued an on-chain recall for this production batch. Do not use or resell this item.",
    classes: "border-red-400 bg-red-50 text-red-950",
    dotClasses: "bg-red-600",
  },
  Retired: {
    badge: "Retired · Replaced Under Warranty",
    title: "Original Unit Retired",
    description:
      "This unit was permanently retired following an authorized warranty replacement.",
    classes: "border-slate-300 bg-slate-100 text-slate-900",
    dotClasses: "bg-slate-500",
  },
  Unknown: {
    badge: "Unrecognized Serial",
    title: "Not Found in Any Committed Batch",
    description:
      "No valid Merkle batch commitment matches this QR code on Stellar. Likely counterfeit or invalid link.",
    classes: "border-red-300 bg-red-50 text-red-950",
    dotClasses: "bg-red-600",
  },
};

export function StatusBanner({ status }: { status: VerificationStatus }) {
  const meta = STATUS_META[status];
  return (
    <section className={`rounded-2xl border p-6 shadow-sm ${meta.classes}`}>
      <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider shadow-sm">
        <span className={`h-2.5 w-2.5 rounded-full ${meta.dotClasses}`} />
        {meta.badge}
      </div>
      <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{meta.title}</h1>
      <p className="mt-2 text-sm leading-relaxed opacity-90 sm:text-base">{meta.description}</p>
    </section>
  );
}
