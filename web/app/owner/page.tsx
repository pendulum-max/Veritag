"use client";

import { useState } from "react";
import { registerPasskeySmartWallet, type PasskeyWalletCredential } from "@/lib/passkey";

interface OwnedProductItem {
  unitId: string;
  model: string;
  serial: string;
  brandDomain: string;
  warrantyDaysRemaining: number;
  claimsUsed: number;
}

const INITIAL_PRODUCTS: OwnedProductItem[] = [
  {
    unitId: "55aa66bb77cc88dd99ee00ff112233445566778899aabbccddeeff0011223344",
    model: "Chronos Titan Automatic 41mm",
    serial: "CH-2026-ACTIVE-04",
    brandDomain: "chronos-watches.swiss",
    warrantyDaysRemaining: 630,
    claimsUsed: 1,
  },
];

export default function OwnerPortalPage() {
  const [wallet, setWallet] = useState<PasskeyWalletCredential | null>(null);
  const [transferCode, setTransferCode] = useState<string | null>(null);
  const [redeemUnitId, setRedeemUnitId] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [serviceCenterAddr, setServiceCenterAddr] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleConnectPasskey() {
    try {
      const cred = await registerPasskeySmartWallet("Veritag Owner Passkey");
      setWallet(cred);
      setFeedback(`Connected passkey smart wallet ${cred.stellarSmartAddress.slice(0, 12)}...`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Passkey sign-in failed");
    }
  }

  function handleGenerateTransferCode(unitId: string) {
    const code = `XFER-${unitId.slice(0, 4).toUpperCase()}-${Math.floor(100000 + Math.random() * 900000)}`;
    setTransferCode(code);
    setFeedback(
      "Generated 24-hour one-time resale code. Share this with the buyer to transfer ownership and remaining warranty.",
    );
  }

  function handleRedeemSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!redeemUnitId.trim() || !redeemCode.trim()) return;
    setFeedback(
      `Submitted sponsored redeem_transfer for unit ${redeemUnitId.slice(0, 12)}... with one-time code.`,
    );
    setRedeemCode("");
  }

  function handleFileClaim(unitId: string) {
    if (!serviceCenterAddr.trim()) {
      setFeedback("Enter an authorized service center Stellar address first.");
      return;
    }
    setFeedback(
      `Warranty claim submitted for unit ${unitId.slice(0, 12)}... to service center ${serviceCenterAddr.slice(0, 10)}...`,
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Authentic Products &amp; Warranties</h1>
          <p className="text-sm text-slate-600">
            Manage owned units, generate one-time resale transfer codes, or file warranty claims
            with zero XLM required.
          </p>
        </div>
        <button
          type="button"
          onClick={handleConnectPasskey}
          className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          {wallet
            ? `Passkey: ${wallet.stellarSmartAddress.slice(0, 8)}...`
            : "Sign in with Passkey (WebAuthn)"}
        </button>
      </div>

      {feedback && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {feedback}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {INITIAL_PRODUCTS.map((item) => (
            <div
              key={item.unitId}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-blue-600">{item.brandDomain}</span>
                  <h2 className="text-lg font-bold text-slate-900">{item.model}</h2>
                  <p className="font-mono text-xs text-slate-500">Serial: {item.serial}</p>
                </div>
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                  {item.warrantyDaysRemaining} days warranty left
                </span>
              </div>

              <div className="grid gap-3 pt-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => handleGenerateTransferCode(item.unitId)}
                  className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Create Resale Transfer Code
                </button>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Service Center G..."
                    value={serviceCenterAddr}
                    onChange={(e) => setServiceCenterAddr(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => handleFileClaim(item.unitId)}
                    className="shrink-0 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    File Claim
                  </button>
                </div>
              </div>

              {transferCode && (
                <div className="rounded-xl bg-slate-900 p-4 text-white">
                  <div className="text-xs text-slate-400">One-Time Resale Transfer Code</div>
                  <div className="mt-1 font-mono text-lg font-bold tracking-wider text-emerald-400">
                    {transferCode}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <form
          onSubmit={handleRedeemSubmit}
          className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4 h-fit"
        >
          <h2 className="text-base font-bold text-slate-900">Redeem Resale Transfer</h2>
          <p className="text-xs text-slate-500">
            Buying a second-hand item? Enter the Unit ID and seller&apos;s one-time code to claim
            ownership and preserve its remaining warranty.
          </p>
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600">Unit ID</label>
            <input
              type="text"
              required
              placeholder="64-char hex unit ID"
              value={redeemUnitId}
              onChange={(e) => setRedeemUnitId(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-slate-600">
              One-Time Transfer Code
            </label>
            <input
              type="text"
              required
              placeholder="XFER-XXXX-XXXXXX"
              value={redeemCode}
              onChange={(e) => setRedeemCode(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Redeem &amp; Transfer Ownership
          </button>
        </form>
      </div>
    </div>
  );
}
