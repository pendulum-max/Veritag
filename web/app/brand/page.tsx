"use client";

import { useState } from "react";

interface BrandBatchSummary {
  batchCode: string;
  batchId: string;
  merkleRoot: string;
  unitCount: number;
  activatedCount: number;
  warrantyMonths: number;
  recalled: boolean;
}

export default function BrandDashboardPage() {
  const [batches, setBatches] = useState<BrandBatchSummary[]>([
    {
      batchCode: "CH-2026-LOT1",
      batchId: "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
      merkleRoot: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      unitCount: 1000,
      activatedCount: 642,
      warrantyMonths: 24,
      recalled: false,
    },
  ]);

  const [batchCode, setBatchCode] = useState("CH-2026-LOT2");
  const [unitCount, setUnitCount] = useState(500);
  const [warrantyMonths, setWarrantyMonths] = useState(24);
  const [productSku, setProductSku] = useState("Chronos Diver 300M");
  const [notice, setNotice] = useState<string | null>(null);

  async function handleCommitBatch(e: React.FormEvent) {
    e.preventDefault();
    const enc = new TextEncoder();
    const batchDigest = await crypto.subtle.digest("SHA-256", enc.encode(batchCode));
    const rootDigest = await crypto.subtle.digest(
      "SHA-256",
      enc.encode(`${batchCode}:${productSku}:${unitCount}`),
    );
    const toHex = (buf: ArrayBuffer) =>
      Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

    const created: BrandBatchSummary = {
      batchCode,
      batchId: toHex(batchDigest),
      merkleRoot: toHex(rootDigest),
      unitCount,
      activatedCount: 0,
      warrantyMonths,
      recalled: false,
    };
    setBatches((prev) => [created, ...prev]);
    setNotice(
      `Built Merkle tree for ${unitCount} units and prepared commit_batch(${created.merkleRoot.slice(0, 14)}...) for Freighter/Multisig signing.`,
    );
  }

  function handleRecall(batchId: string) {
    setBatches((prev) =>
      prev.map((b) => (b.batchId === batchId ? { ...b, recalled: true } : b)),
    );
    setNotice(
      `Emergency batch recall broadcast for ${batchId.slice(0, 14)}... — all public QR scans now show Safety Recall immediately.`,
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Manufacturer Brand Console</h1>
          <p className="text-sm text-slate-600">
            Commit production batches in a single Soroban write, export print-line QR &amp;
            scratch-off secrets, and manage recalls.
          </p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800">
          stellar.toml Domain Verified · chronos-watches.swiss
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {notice}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-12">
        <form
          onSubmit={handleCommitBatch}
          className="lg:col-span-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4 h-fit"
        >
          <h2 className="text-base font-bold text-slate-900">Commit New Production Batch</h2>
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600">
              Batch Lot Code
            </label>
            <input
              type="text"
              required
              value={batchCode}
              onChange={(e) => setBatchCode(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600">
              Product Model / Metadata
            </label>
            <input
              type="text"
              required
              value={productSku}
              onChange={(e) => setProductSku(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600">Units</label>
              <input
                type="number"
                min={1}
                max={50000}
                value={unitCount}
                onChange={(e) => setUnitCount(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600">
                Warranty (Mo)
              </label>
              <input
                type="number"
                min={0}
                max={240}
                value={warrantyMonths}
                onChange={(e) => setWarrantyMonths(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Generate Merkle Root &amp; Commit
          </button>
        </form>

        <div className="lg:col-span-8 space-y-4">
          {batches.map((b) => (
            <div
              key={b.batchId}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">{b.batchCode}</h3>
                  <p className="font-mono text-xs text-slate-500">
                    Merkle Root: {b.merkleRoot.slice(0, 24)}...
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    b.recalled ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"
                  }`}
                >
                  {b.recalled ? "Recalled" : "Committed On-Chain"}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Batch Size</div>
                  <div className="font-bold text-slate-900">{b.unitCount.toLocaleString()}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Activated Units</div>
                  <div className="font-bold text-slate-900">
                    {b.activatedCount.toLocaleString()} (
                    {Math.round((b.activatedCount / b.unitCount) * 100)}%)
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Warranty</div>
                  <div className="font-bold text-slate-900">{b.warrantyMonths} months</div>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setNotice(
                      `Exported CSV print file for ${b.batchCode} and queued post-print secret purge.`,
                    )
                  }
                  className="rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Export Print CSV &amp; Purge Secrets
                </button>
                {!b.recalled && (
                  <button
                    type="button"
                    onClick={() => handleRecall(b.batchId)}
                    className="rounded-xl border border-red-300 bg-red-50 px-3.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                  >
                    Recall Entire Batch
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
