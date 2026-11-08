"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PUBLIC_CONFIG } from "@/lib/stellar";
import { useWallet } from "@/lib/wallet-context";

interface ActivationDrawerProps {
  brand: string;
  batchId: string;
  serial: string;
}

export function ActivationDrawer({ brand, batchId, serial }: ActivationDrawerProps) {
  const router = useRouter();
  const { session, connectPasskey, connectRoleKeypair } = useWallet();
  const [secret, setSecret] = useState("");
  const [ownerAddress, setOwnerAddress] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (session?.address) {
      setOwnerAddress(session.address);
    }
  }, [session?.address]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash.startsWith("#s=")) {
      const parsedSecret = decodeURIComponent(window.location.hash.slice(3));
      if (parsedSecret) {
        setSecret(parsedSecret);
      }
    }
  }, []);

  async function handlePasskeyCreate() {
    const created = await connectPasskey();
    if (created) {
      setOwnerAddress(created.address);
      setStatusMsg(`Passkey smart account deployed & connected: ${created.address.slice(0, 12)}...`);
    }
  }

  async function handleDemoOwnerConnect() {
    const connected = await connectRoleKeypair("owner");
    if (connected) {
      setOwnerAddress(connected.address);
      setStatusMsg(`Connected consumer signer: ${connected.address.slice(0, 12)}...`);
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
        router.refresh();
      }
    } catch {
      setStatusMsg("Backend relay offline — connect local backend or submit directly via Soroban RPC.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Claim &amp; Activate Warranty</h2>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Owner Wallet Address (Passkey C... or Stellar G...)
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handlePasskeyCreate}
                className="text-xs font-semibold text-blue-600 hover:text-blue-700"
              >
                + Create Passkey Wallet
              </button>
              <button
                type="button"
                onClick={handleDemoOwnerConnect}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900"
              >
                Use Quick Signer
              </button>
            </div>
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
          {submitting
            ? "Verifying Merkle Proof & Sponsoring Tx..."
            : "Activate Product & Start Warranty"}
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
