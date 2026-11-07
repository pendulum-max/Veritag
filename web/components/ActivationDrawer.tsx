"use client";

import { useState } from "react";
import { registerPasskeySmartWallet } from "@/lib/passkey";
import { PUBLIC_CONFIG } from "@/lib/stellar";

interface ActivationDrawerProps {
  brand: string;
  batchId: string;
  serial: string;
}

export function ActivationDrawer({ brand, batchId, serial }: ActivationDrawerProps) {
  const [secret, setSecret] = useState("");
  const [ownerAddress, setOwnerAddress] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handlePasskeyCreate() {
    try {
      const cred = await registerPasskeySmartWallet();
      setOwnerAddress(cred.stellarSmartAddress);
      setStatusMsg(`Passkey wallet bound: ${cred.stellarSmartAddress.slice(0, 10)}...`);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "Passkey setup unavailable");
    }
  }

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    if (!secret.trim() || !ownerAddress.trim()) return;
    setSubmitting(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand,
          batchId,
          serial,
          secret: secret.trim(),
          firstOwner: ownerAddress.trim(),
        }),
      });
      const data = (await res.json()) as { unitId?: string; error?: string };
      if (!res.ok) {
        setStatusMsg(`Activation failed: ${data.error ?? res.statusText}`);
      } else {
        setStatusMsg(`Unit activated on-chain! Unit ID: ${data.unitId?.slice(0, 16)}...`);
      }
    } catch {
      setStatusMsg("Backend relay offline — connect local backend or submit directly via Soroban RPC.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Claim & Activate Warranty</h2>
      <p className="mt-1 text-sm text-slate-600">
        Reveal the hidden scratch-off code inside the sealed packaging to mint your unit record on
        Stellar with zero XLM gas fees (sponsored).
      </p>

      <form onSubmit={handleActivate} className="mt-4 space-y-4">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
            Scratch-Off Secret Code
          </label>
          <input
            type="text"
            required
            placeholder="XXXX-XXXX-XXXX-XXXX"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono text-sm focus:border-blue-600 focus:outline-none"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Owner Wallet Address (Passkey or Stellar G.../C...)
            </label>
            <button
              type="button"
              onClick={handlePasskeyCreate}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700"
            >
              + Create FaceID / Passkey Wallet
            </button>
          </div>
          <input
            type="text"
            required
            placeholder="G... or C... smart wallet address"
            value={ownerAddress}
            onChange={(e) => setOwnerAddress(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 font-mono text-sm focus:border-blue-600 focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {submitting ? "Verifying Merkle Proof & Sponsoring Tx..." : "Activate Product & Start Warranty"}
        </button>

        {statusMsg && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
            {statusMsg}
          </p>
        )}
      </form>
    </div>
  );
}
