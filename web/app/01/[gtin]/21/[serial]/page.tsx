import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveGs1DigitalLink } from "@/lib/stellar";

interface Gs1DigitalLinkPageProps {
  params: Promise<{
    gtin: string;
    serial: string;
  }>;
}

export default async function Gs1DigitalLinkPage({ params }: Gs1DigitalLinkPageProps) {
  const raw = await params;
  const gtin = decodeURIComponent(raw.gtin);
  const serial = decodeURIComponent(raw.serial);

  const resolved = await resolveGs1DigitalLink(gtin, serial);
  if (resolved) {
    redirect(resolved.redirectPath);
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Invalid GS1 Digital Link</h1>
      <p className="text-sm text-slate-600">
        Unable to resolve GTIN <span className="font-mono font-semibold">{gtin}</span> and serial{" "}
        <span className="font-mono font-semibold">{serial}</span>. Ensure the barcode encodes a
        valid 8, 12, 13, or 14-digit GTIN.
      </p>
      <Link
        href="/"
        className="inline-block rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
      >
        Return to Veritag Portal
      </Link>
    </div>
  );
}
