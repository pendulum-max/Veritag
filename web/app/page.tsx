"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { QrScanner } from "@/components/QrScanner";

const DEMO_BRAND = "GB7TAYRUZGE6TVT7NHP5SMIZRNQA6PLM423EYISAOAP3MKYIQMVYP2JO";
const DEMO_BATCH = "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b";

const PRESETS = [
  {
    label: "Authentic · Unclaimed",
    serial: "CH-2026-000101",
    badgeClass: "bg-emerald-100 text-emerald-800",
  },
  {
    label: "Authentic · Active Warranty",
    serial: "CH-2026-ACTIVE-04",
    badgeClass: "bg-blue-100 text-blue-800",
  },
  {
    label: "Duplicate Claim Warning",
    serial: "CH-2026-DUP-88",
    badgeClass: "bg-amber-100 text-amber-800",
  },
  {
    label: "Safety Recalled Batch",
    serial: "CH-2026-RECALL-19",
    badgeClass: "bg-red-100 text-red-800",
  },
  {
    label: "Counterfeit / Unknown",
    serial: "FAKE-000999",
    badgeClass: "bg-slate-200 text-slate-800",
  },
];

export default function HomePage() {
  const router = useRouter();
  const [brand, setBrand] = useState(DEMO_BRAND);
  const [batch, setBatch] = useState(DEMO_BATCH);
  const [serial, setSerial] = useState("CH-2026-000101");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!brand.trim() || !batch.trim() || !serial.trim()) return;
    router.push(
      `/v/${encodeURIComponent(brand.trim())}/${encodeURIComponent(batch.trim())}/${encodeURIComponent(serial.trim())}`,
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="grid gap-10 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3.5 py-1 text-xs font-semibold text-blue-700">
            Merkle Batch Commits · Lazy Soroban Activation · Passkey Wallets
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            Know what you&apos;re buying. Prove what you own.
          </h1>
          <p className="text-lg leading-relaxed text-slate-600">
            Veritag anchors entire production batches to Stellar Soroban in a single Merkle root,
            defeats QR cloning with hidden scratch-off secrets, and turns product warranties into
            transferable records that follow resale.
          </p>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Instant Verification Demos
            </p>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <Link
                  key={p.serial}
                  href={`/v/${DEMO_BRAND}/${DEMO_BATCH}/${p.serial}`}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition hover:opacity-80 ${p.badgeClass}`}
                >
                  {p.label} →
                </Link>
              ))}
            </div>
          </div>

          <QrScanner />
        </div>

        <div className="lg:col-span-5">
          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
          >
            <h2 className="text-lg font-bold text-slate-900">Verify a Product Tag</h2>
            <p className="text-xs text-slate-500">
              Scan a Veritag QR code on your phone or inspect any serial number directly against
              Soroban.
            </p>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600">
                Brand Stellar Address
              </label>
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600">
                Batch ID (32-byte Hex)
              </label>
              <input
                type="text"
                value={batch}
                onChange={(e) => setBatch(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600">
                Unit Serial Number
              </label>
              <input
                type="text"
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm"
              />
            </div>

            <button
              type="submit"
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Verify On-Chain
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
