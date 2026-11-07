import { ActivationDrawer } from "@/components/ActivationDrawer";
import { StatusBanner } from "@/components/StatusBanner";
import { verifyProduct } from "@/lib/stellar";

interface VerifyPageProps {
  params: Promise<{
    brand: string;
    batch: string;
    serial: string;
  }>;
}

function formatUnixDate(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export default async function PublicVerifyPage({ params }: VerifyPageProps) {
  const raw = await params;
  const brand = decodeURIComponent(raw.brand);
  const batch = decodeURIComponent(raw.batch);
  const serial = decodeURIComponent(raw.serial);

  const summary = await verifyProduct(brand, batch, serial);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6 sm:px-6">
      <StatusBanner status={summary.status} />

      {summary.suspiciousScanVolume && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <strong>High Scan Frequency Alert:</strong> This tag has been scanned{" "}
          <strong>{summary.scanCount}</strong> times. High scan counts on supposedly factory-sealed
          goods often indicate cloned outer packaging.
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Manufacturer
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-base font-bold text-slate-900">
              {summary.brand.domain ?? "Unverified Issuer"}
            </span>
            {summary.brand.verified && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                stellar.toml Verified
              </span>
            )}
          </div>
          <p className="mt-2 break-all font-mono text-xs text-slate-500">{summary.brand.address}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Scan Telemetry &amp; Serial
          </div>
          <div className="mt-2 text-base font-bold font-mono text-slate-900">{serial}</div>
          <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
            <span>Public Scans: {summary.scanCount}</span>
            <span>
              Warranty Term: {summary.batch ? `${summary.batch.warrantyMonths} months` : "N/A"}
            </span>
          </div>
        </div>
      </section>

      {summary.unit && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              Warranty &amp; Anonymized Provenance
            </h2>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                summary.unit.warrantyValid
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              {summary.unit.warrantyValid ? "Warranty Active" : "Warranty Inactive / Expired"}
            </span>
          </div>

          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-3.5">
              <dt className="text-xs text-slate-500">Current Owner (Pseudonymous)</dt>
              <dd className="mt-1 font-mono font-semibold text-slate-900">
                {summary.unit.ownerAnonymized}
              </dd>
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5">
              <dt className="text-xs text-slate-500">Activated / Expires</dt>
              <dd className="mt-1 font-semibold text-slate-900">
                {formatUnixDate(summary.unit.activatedAt)} →{" "}
                {formatUnixDate(summary.unit.warrantyExpiry)}
              </dd>
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5">
              <dt className="text-xs text-slate-500">Resales / Service Claims</dt>
              <dd className="mt-1 font-semibold text-slate-900">
                {summary.unit.ownershipTransfers} transfers · {summary.unit.claimsUsed} claims
              </dd>
            </div>
          </dl>
        </section>
      )}

      {summary.status === "AuthenticInactive" && (
        <ActivationDrawer brand={brand} batchId={batch} serial={serial} />
      )}

      <section className="rounded-2xl border border-slate-200 bg-slate-900 p-5 text-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Independent Chain Proof (Stellar Soroban)
          </h3>
          <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-blue-300">
            {summary.ledgerSequence ? `Ledger #${summary.ledgerSequence}` : summary.source}
          </span>
        </div>
        <div className="mt-3 space-y-1.5 font-mono text-xs">
          <div className="break-all">
            <span className="text-slate-400">Contract ID: </span>
            {summary.contractId}
          </div>
          <div className="break-all">
            <span className="text-slate-400">Unit ID: </span>
            {summary.unitId}
          </div>
          {summary.batch && (
            <div className="break-all">
              <span className="text-slate-400">Batch Merkle Root: </span>
              {summary.batch.merkleRoot}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
