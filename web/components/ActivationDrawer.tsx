"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { PUBLIC_CONFIG } from "@/lib/stellar";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useWallet } from "@/lib/wallet-context";

interface ActivationDrawerProps {
  brand: string;
  batchId: string;
  serial: string;
  defaultOpen?: boolean;
  disabled?: boolean;
}

export function ActivationDrawer({
  brand,
  batchId,
  serial,
  defaultOpen = false,
  disabled = false,
}: ActivationDrawerProps) {
  const router = useRouter();
  const { session, connectPasskey, connectRoleKeypair, signContractAction } = useWallet();
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [secret, setSecret] = useState("");
  const [ownerAddress, setOwnerAddress] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const drawerRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const secretInputId = useId();
  const ownerInputId = useId();

  useFocusTrap(isOpen, drawerRef, () => setIsOpen(false));

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
        setIsOpen(true);
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
    if (disabled || !secret.trim() || !ownerAddress.trim()) return;
    setSubmitting(true);
    setStatusMsg("Verifying Merkle proof and sponsoring activation transaction...");
    try {
      const signedTxXdr = await signContractAction("activate");
      const res = await fetch(`${PUBLIC_CONFIG.apiUrl}/v1/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand,
          batchId,
          serial,
          secret: secret.trim(),
          firstOwner: ownerAddress.trim(),
          ...(signedTxXdr ? { signedTxXdr } : {}),
        }),
      });
      const data = (await res.json()) as {
        unitId?: string;
        sponsoredTxHash?: string;
        error?: string;
      };
      if (!res.ok) {
        setStatusMsg(`Activation failed: ${data.error ?? res.statusText}`);
      } else {
        setStatusMsg(
          `Unit activated on-chain! Unit ID: ${data.unitId?.slice(0, 16)}...${
            data.sponsoredTxHash ? ` (Sponsored Tx: ${data.sponsoredTxHash.slice(0, 12)}...)` : ""
          }`,
        );
        router.refresh();
      }
    } catch {
      setStatusMsg("Backend relay offline — connect local backend or submit directly via Soroban RPC.");
    } finally {
      setSubmitting(false);
    }
  }

  const formContent = (
    <form onSubmit={handleActivate} className="mt-4 space-y-4">
      <div>
        <label
          htmlFor={secretInputId}
          className="block text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300"
        >
          Scratch-Off Secret Code
        </label>
        <input
          id={secretInputId}
          type="text"
          required
          placeholder="XXXX-XXXX-XXXX-XXXX"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label
            htmlFor={ownerInputId}
            className="block text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300"
          >
            Owner Wallet Address (Passkey C... or Stellar G...)
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePasskeyCreate}
              className="text-xs font-semibold text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              + Create Passkey Wallet
            </button>
            <button
              type="button"
              onClick={handleDemoOwnerConnect}
              className="text-xs font-semibold text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
            >
              Use Quick Signer
            </button>
          </div>
        </div>
        <input
          id={ownerInputId}
          type="text"
          required
          placeholder="G... or C... smart wallet address"
          value={ownerAddress}
          onChange={(e) => setOwnerAddress(e.target.value)}
          className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
      >
        {submitting
          ? "Verifying Merkle Proof & Sponsoring Tx..."
          : "Activate Product & Start Warranty"}
      </button>

      <div role="status" aria-live="polite" className="min-h-[1.25rem]">
        {statusMsg && (
          <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-200">
            {statusMsg}
          </p>
        )}
      </div>
    </form>
  );

  return (
    <>
      <section
        aria-labelledby={`${titleId}-summary`}
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2
              id={`${titleId}-summary`}
              className="text-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              Claim &amp; Activate Warranty
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Reveal the hidden scratch-off code inside the sealed packaging to mint your unit
              record on Stellar with zero XLM gas fees (sponsored).
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={isOpen}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            Open Activation Drawer
          </button>
        </div>
      </section>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 p-4 backdrop-blur-sm sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setIsOpen(false);
          }}
        >
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Claim &amp; Activate Warranty
                </h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  Serial: <span className="font-mono font-semibold">{serial}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close activation drawer"
                className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="h-5 w-5"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            {formContent}
          </div>
        </div>
      )}
    </>
  );
}
