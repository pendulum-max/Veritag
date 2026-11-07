"use client";

import { useState } from "react";

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

  async function handleResolve(claimId: number, unitId: string) {
    const encoder = new TextEncoder();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(reportSummary || `service-report-${claimId}`),
    );
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
    setReportSummary("");
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Authorized Service Center Queue</h1>
        <p className="text-sm text-slate-600">
          Validate unit warranty eligibility on-chain and anchor signed diagnostic report hashes to
          Soroban.
        </p>
      </div>

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
                  onClick={() => handleResolve(claim.claimId, claim.unitId)}
                  className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                >
                  Sign &amp; Resolve Claim
                </button>
              </div>
            ) : (
              <p className="break-all font-mono text-xs text-slate-500">
                Anchored Report SHA-256: {claim.reportHash}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
