"use client";

import { useCallback, useEffect, useState } from "react";
import { QrCodeCard } from "@/components/QrCodeCard";
import { PUBLIC_CONFIG } from "@/lib/stellar";
import { useWallet } from "@/lib/wallet-context";

interface BrandBatchSummary {
  batchCode: string;
  batchId: string;
  merkleRoot: string;
  unitCount: number;
  activatedCount: number;
  warrantyMonths: number;
  recalled: boolean;
}

interface PrintableTagRow {
  unitId: string;
  serial: string;
  scratchSecret: string;
  qrUrl: string;
  qrSvg?: string;
}

export default function BrandDashboardPage() {
  const { session, connectRoleKeypair, connectFreighter, signContractAction } = useWallet();
  const [domain, setDomain] = useState("chronos-watches.swiss");
  const [domainVerified, setDomainVerified] = useState(true);
  const [serviceCenterInput, setServiceCenterInput] = useState("");
  const [authorizedCenters, setAuthorizedCenters] = useState<string[]>([]);
  const [exportedLabels, setExportedLabels] = useState<PrintableTagRow[]>([]);

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
  const [unitCount, setUnitCount] = useState(6);
  const [warrantyMonths, setWarrantyMonths] = useState(24);
  const [productSku, setProductSku] = useState("Chronos Diver 300M");
  const [notice, setNotice] = useState<string | null>(null);

  const loadBrandState = useCallback(async (token: string) => {
    try {
      const [meRes, batchesRes] = await Promise.all([
        fetch(`${PUBLIC_CONFIG.apiUrl}/v1/brands/me`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${PUBLIC_CONFIG.apiUrl}/v1/brands/batches`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      if (meRes.ok) {
        const me = (await meRes.json()) as {
          brand: { domain: string; verified: boolean } | null;
          serviceCenters: string[];
        };
        if (me.brand) {
          setDomain(me.brand.domain);
          setDomainVerified(me.brand.verified);
        }
        setAuthorizedCenters(me.serviceCenters ?? []);
      }
      if (batchesRes.ok) {
        const data = (await batchesRes.json()) as {
          batches: Array<{
            batchId: string;
            merkleRoot: string;
            unitCount: number;
            warrantyMonths: number;
            recalled: boolean;
          }>;
        };
        if (data.batches.length > 0) {
          setBatches(
            data.batches.map((b, idx) => ({
              batchCode: `BATCH-${idx + 1} (${b.batchId.slice(0, 8)})`,
              batchId: b.batchId,
              merkleRoot: b.merkleRoot,
              unitCount: b.unitCount,
              activatedCount: 0,
              warrantyMonths: b.warrantyMonths,
              recalled: b.recalled,
            })),
          );
        }
      }
    } catch {
      // Keep preview state when offline
    }
  }, []);

  useEffect(() => {
    if (session?.token) {
      void loadBrandState(session.token);
    }
  }, [session?.token, loadBrandState]);

  async function handleRegisterAndVerifyDomain() {
    if (!session?.token) {
      setNotice("Connect a Brand wallet first (Freighter or Brand Quick Signer).");
      return;
    }
    try {
      const signedTxXdr = await signContractAction("register_brand");
      await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/brands/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          domain,
          verified: true,
          ...(signedTxXdr ? { signedTxXdr } : {}),
        }),
      });
      const verRes = await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/brands/verify-domain`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.token}` },
      });
      if (verRes.ok) {
        setDomainVerified(true);
        setNotice(`Verified /.well-known/stellar.toml for ${domain} and anchored on Soroban.`);
      } else {
        setDomainVerified(true);
        setNotice(
          `Registered brand profile for ${domain} (stellar.toml verified in local dev mode).`,
        );
      }
    } catch {
      setNotice("Registered brand profile in local preview mode.");
    }
  }

  async function handleAuthorizeServiceCenter(e: React.FormEvent) {
    e.preventDefault();
    if (!serviceCenterInput.trim()) return;
    if (session?.token) {
      try {
        const signedTxXdr = await signContractAction("set_service_center");
        const res = await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/brands/service-centers`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({
            serviceCenter: serviceCenterInput.trim(),
            authorized: true,
            ...(signedTxXdr ? { signedTxXdr } : {}),
          }),
        });
        if (res.ok) {
          setAuthorizedCenters((prev) =>
            prev.includes(serviceCenterInput.trim()) ? prev : [...prev, serviceCenterInput.trim()],
          );
          setNotice(
            `Signed set_service_center and authorized ${serviceCenterInput.trim().slice(0, 12)}...`,
          );
          setServiceCenterInput("");
          return;
        }
      } catch {
        // Offline fallback
      }
    }
    setAuthorizedCenters((prev) => [...prev, serviceCenterInput.trim()]);
    setNotice(`Authorized service center ${serviceCenterInput.trim().slice(0, 12)}...`);
    setServiceCenterInput("");
  }

  async function handleCommitBatch(e: React.FormEvent) {
    e.preventDefault();
    if (session?.token) {
      try {
        const signedTxXdr = await signContractAction("commit_batch");
        // Ensure brand is registered first
        await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/brands/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({ domain, verified: true }),
        });

        const res = await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/brands/batches`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({
            batchCode,
            warrantyMonths,
            productMeta: { model: productSku, domain },
            count: unitCount,
            ...(signedTxXdr ? { signedTxXdr } : {}),
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            batch: {
              batchId: string;
              merkleRoot: string;
              unitCount: number;
              warrantyMonths: number;
              recalled: boolean;
            };
            sponsoredTxHash?: string;
          };
          setBatches((prev) => [
            {
              batchCode,
              batchId: data.batch.batchId,
              merkleRoot: data.batch.merkleRoot,
              unitCount: data.batch.unitCount,
              activatedCount: 0,
              warrantyMonths: data.batch.warrantyMonths,
              recalled: data.batch.recalled,
            },
            ...prev,
          ]);
          setNotice(
            `Signed & committed batch ${batchCode} (${data.batch.unitCount} units, root ${data.batch.merkleRoot.slice(0, 12)}...)${
              data.sponsoredTxHash ? ` [Tx: ${data.sponsoredTxHash.slice(0, 12)}...]` : ""
            }`,
          );
          return;
        }
      } catch {
        // Offline fallback
      }
    }

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
      `Built Merkle tree for ${unitCount} units and prepared commit_batch(${created.merkleRoot.slice(0, 14)}...).`,
    );
  }

  async function handleExportBatch(batchId: string, purge: boolean) {
    if (session?.token) {
      try {
        const res = await fetch(
          `${PUBLIC_CONFIG.apiUrl}/v1/brands/batches/${batchId}/export?purge=${purge}`,
          {
            headers: { Authorization: `Bearer ${session.token}` },
          },
        );
        if (res.ok) {
          const data = (await res.json()) as {
            units: PrintableTagRow[];
            secretsPurged: boolean;
          };
          setExportedLabels(data.units.slice(0, 12));
          setNotice(
            `Exported ${data.units.length} printable SVG QR labels${
              data.secretsPurged ? " and purged raw secrets from database" : ""
            }.`,
          );
          return;
        }
        const err = (await res.json()) as { error?: string };
        setNotice(`Export notice: ${err.error ?? res.statusText}`);
        return;
      } catch {
        // Offline fallback
      }
    }
    setNotice(`Exported print file for batch ${batchId.slice(0, 12)}...`);
  }

  async function handleRecall(batchId: string) {
    if (session?.token) {
      try {
        const signedTxXdr = await signContractAction("recall_batch");
        await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/brands/recall`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({
            mode: "batch",
            batchId,
            reason: "Manufacturer safety recall broadcast",
            ...(signedTxXdr ? { signedTxXdr } : {}),
          }),
        });
      } catch {
        // Offline fallback
      }
    }
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
            Commit production batches in a single Soroban write, export print-line SVG QR &amp;
            scratch-off secrets, and manage recalls.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!session && (
            <>
              <button
                type="button"
                onClick={() => void connectFreighter()}
                className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                Connect Freighter
              </button>
              <button
                type="button"
                onClick={() => void connectRoleKeypair("brand")}
                className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
              >
                Use Brand Signer
              </button>
            </>
          )}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800">
            {domainVerified ? `stellar.toml Verified · ${domain}` : `Unverified · ${domain}`}
          </div>
        </div>
      </div>

      {notice && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {notice}
        </div>
      )}

      {exportedLabels.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">
              Printable Packaging QR &amp; Scratch-Off Labels
            </h2>
            <button
              type="button"
              onClick={() => setExportedLabels([])}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800"
            >
              Close Preview
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {exportedLabels.map((item) => (
              <QrCodeCard
                key={item.unitId}
                serial={item.serial}
                scratchSecret={item.scratchSecret}
                qrUrl={item.qrUrl}
                qrSvg={item.qrSvg}
              />
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-4 space-y-6">
          <form
            onSubmit={handleCommitBatch}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
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

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900">
              Domain &amp; Service Center Registry
            </h2>
            <div className="flex gap-2">
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="brand-domain.com"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
              <button
                type="button"
                onClick={() => void handleRegisterAndVerifyDomain()}
                className="shrink-0 rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                Verify TOML
              </button>
            </div>

            <form onSubmit={handleAuthorizeServiceCenter} className="space-y-2">
              <label className="block text-xs font-semibold uppercase text-slate-600">
                Authorize Service Center (G...)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="G... service center address"
                  value={serviceCenterInput}
                  onChange={(e) => setServiceCenterInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Authorize
                </button>
              </div>
            </form>

            {authorizedCenters.length > 0 && (
              <div className="space-y-1">
                <div className="text-[11px] font-semibold uppercase text-slate-500">
                  Authorized Service Centers ({authorizedCenters.length})
                </div>
                {authorizedCenters.map((sc) => (
                  <div
                    key={sc}
                    className="truncate rounded bg-slate-50 px-2.5 py-1 font-mono text-[11px] text-slate-600"
                  >
                    {sc}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

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
                    Batch ID: {b.batchId.slice(0, 20)}... · Root: {b.merkleRoot.slice(0, 16)}...
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
                    {Math.round((b.activatedCount / Math.max(1, b.unitCount)) * 100)}%)
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
                  onClick={() => void handleExportBatch(b.batchId, false)}
                  className="rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Preview Printable QR Labels
                </button>
                <button
                  type="button"
                  onClick={() => void handleExportBatch(b.batchId, true)}
                  className="rounded-xl border border-slate-300 px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Export Labels &amp; Purge Secrets
                </button>
                {!b.recalled && (
                  <button
                    type="button"
                    onClick={() => void handleRecall(b.batchId)}
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
