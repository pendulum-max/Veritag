import type { Metadata } from "next";
import Link from "next/link";
import { StatusBanner } from "@/components/StatusBanner";
import { verifyProduct } from "@/lib/stellar";

interface VerifyPageProps {
  params: Promise<{ brand: string; serial: string }>;
}

export async function generateMetadata({ params }: VerifyPageProps): Promise<Metadata> {
  const { brand: rawBrand, serial: rawSerial } = await params;
  const brand = decodeURIComponent(rawBrand);
  const serial = decodeURIComponent(rawSerial);
  const summary = await verifyProduct(brand, "default", serial);
  const brandName = summary.brand.domain ?? brand;
  const title = `${serial} · ${brandName} — Veritag Authenticity Check`;
  const description = summary.authentic
    ? `Genuine & Warranty Protected product verified on Stellar Soroban for ${brandName}.`
    : `Authenticity verification status for serial ${serial} (${brandName}) on Veritag.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "Veritag",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function VerifyProductPage({ params }: VerifyPageProps) {
  const { brand: rawBrand, serial: rawSerial } = await params;
  const brand = decodeURIComponent(rawBrand);
  const serial = decodeURIComponent(rawSerial);
  const summary = await verifyProduct(brand, "default", serial);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          Brand: <strong className="text-slate-800">{summary.brand.domain ?? brand}</strong>
        </span>
        <span className="font-mono">Serial: {serial}</span>
      </div>

      <StatusBanner status={summary.status} />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-500">Brand Verification</div>
          <div className="mt-1 text-base font-bold text-slate-900">
            {summary.brand.verified ? "stellar.toml Verified" : "Unverified Brand"}
          </div>
          <div className="mt-1 truncate font-mono text-xs text-slate-500">
            {summary.brand.address}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-500">Warranty Status</div>
          <div className="mt-1 text-base font-bold text-slate-900">
            {summary.unit
              ? summary.unit.warrantyValid
                ? "Active & Protected"
                : "Expired"
              : summary.batch
                ? `${summary.batch.warrantyMonths} Months on Activation`
                : "Unavailable"}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-500">Soroban Anchor</div>
          <div className="mt-1 truncate font-mono text-xs font-semibold text-slate-800">
            {summary.contractId}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {summary.ledgerSequence ? `Ledger #${summary.ledgerSequence}` : `Source: ${summary.source}`}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm text-slate-600">
          Embed this live verification seal on resale listings.
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/embed/verify/${encodeURIComponent(brand)}/${encodeURIComponent(serial)}`}
            className="rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            View Embed Widget
          </Link>
          <Link
            href="/"
            className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Verify Another Product
          </Link>
        </div>
      </div>
    </div>
  );
}
