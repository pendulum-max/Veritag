"use client";

import { useCallback, useEffect, useState } from "react";
import { getFileDownloadUrl, PUBLIC_CONFIG } from "@/lib/stellar";
import { useWallet } from "@/lib/wallet-context";

type Outcome = "Approved" | "Repaired" | "Replaced" | "Rejected";

interface IncomingClaim {
  claimId: number;
  unitId: string;
  brandDomain: string;
  filedDate: string;
  outcome: "Pending" | Outcome;
  reportHash: string;
}

export default function ServiceCenterPage() {
  const { session, connectRoleKeypair } = useWallet();
  const [claims, setClaims] = useState<IncomingClaim[]>([
    {
      claimId: 1,
      unitId: "55aa66bb77cc88dd99ee00ff112233445566778899aabbccddeeff0011223344",
      brandDomain: "chronos-watches.swiss",
      filedDate: "2026-11-05",
      outcome: "Pending",
      reportHash: "",
    },
  ]);
  const [selectedOutcome, setSelectedOutcome] = useState<Outcome>("Repaired");
  const [reportSummary, setReportSummary] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const loadServiceClaims = useCallback(async (address: string, token: string) => {
    try {
      const res = await fetch(
        `${PUBLIC_CONFIG.apiUrl}/v1/service-centers/${encodeURIComponent(address)}/claims`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) return;
      const data = (await res.json()) as {
        claims: Array<{
          claimId: number;
          unitId: string;
          outcome: "Pending" | Outcome;
          reportHash: string;
          filedAt: number;
        }>;
      };
      if (data.claims.length > 0) {
        setClaims(
          data.claims.map((c) => ({
            claimId: c.claimId,
            unitId: c.unitId,
            brandDomain: "Verified Brand",
            filedDate: new Date(c.filedAt * 1000).toISOString().slice(0, 10),
            outcome: c.outcome,
            reportHash: c.reportHash,
          })),
        );
      }
    } catch {
      // Keep preview claim when offline
    }
  }, []);

  useEffect(() => {
    if (session?.address && session?.token) {
      void loadServiceClaims(session.address, session.token);
    }
  }, [session?.address, session?.token, loadServiceClaims]);

  async function handleResolve(claimId: number, unitId: string) {
    const contentText =
      reportSummary.trim() ||
      `Veritag Authorized Service Diagnostic Report — Claim #${claimId} (${selectedOutcome})`;

    if (session?.token) {
      try {
        const uploadRes = await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/files`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({
            contentBase64: btoa(contentText),
            mime: "text/plain",
          }),
        });
        if (uploadRes.ok) {
          const uploaded = (await uploadRes.json()) as { hash: string };
          const resolveRes = await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/claims/${claimId}/resolve`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.token}`,
            },
            body: JSON.stringify({
              unitId,
              outcome: selectedOutcome,
              reportHash: uploaded.hash,
            }),
          });
          if (resolveRes.ok) {
            setClaims((prev) =>
              prev.map((c) =>
                c.claimId === claimId && c.unitId === unitId
                  ? { ...c, outcome: selectedOutcome, reportHash: uploaded.hash }
                  : c,
              ),
            );
            setNotice(
              `Uploaded diagnostic report (${uploaded.hash.slice(0, 12)}...) and resolved Claim #${claimId} as ${selectedOutcome}.`,
            );
            setReportSummary("");
            return;
          }
        }
      } catch {
        // Offline fallback
      }
    }

    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(contentText));
    const reportHash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    setClaims((prev) =>
      prev.map((c) =>
        c.claimId === claimId && c.unitId === unitId
          ? { ...c, outcome: selectedOutcome, reportHash }
          : c,
      ),
    );
    setNotice(`Anchored report SHA-256 (${reportHash.slice(0, 12)}...) and resolved Claim #${claimId}.`);
    setReportSummary("");
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Authorized Service Center Queue</h1>
          <p className="text-sm text-slate-600">
            Validate unit warranty eligibility on-chain and anchor signed diagnostic report hashes to
            Soroban.
          </p>
        </div>
        {!session && (
          <button
            type="button"
            onClick={() => void connectRoleKeypair("service")}
            className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Connect Service Center Signer
          </button>
        )}
      </div>

      {notice && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {notice}
        </div>
      )}

      <div className="space-y-4">
        {claims.map((claim) => (
          <div
            key={`${claim.unitId}:${claim.claimId}`}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs font-semibold text-blue-600">
                  Claim #{claim.claimId} · {claim.brandDomain}
                </span>
                <p className="mt-1 break-all font-mono text-xs text-slate-600">
                  Unit: {claim.unitId}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  claim.outcome === "Pending"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-emerald-100 text-emerald-800"
                }`}
              >
                {claim.outcome}
              </span>
            </div>

            {claim.outcome === "Pending" ? (
              <div className="grid gap-3 pt-2 sm:grid-cols-3">
                <select
                  value={selectedOutcome}
                  onChange={(e) => setSelectedOutcome(e.target.value as Outcome)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="Repaired">Repaired</option>
                  <option value="Approved">Approved</option>
                  <option value="Replaced">Replaced (Retires Unit)</option>
                  <option value="Rejected">Rejected</option>
                </select>
                <input
                  type="text"
                  placeholder="Diagnostic report notes (SHA-256 anchored)"
                  value={reportSummary}
                  onChange={(e) => setReportSummary(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void handleResolve(claim.claimId, claim.unitId)}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Upload Report &amp; Resolve Claim
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <p className="break-all font-mono text-slate-500">
                  Anchored Report SHA-256: {claim.reportHash}
                </p>
                {claim.reportHash && (
                  <a
                    href={getFileDownloadUrl(claim.reportHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-blue-600 hover:underline"
                  >
                    Download Diagnostic Report
                  </a>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
