"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { detectInstalledWallets, type InstalledWalletsStatus } from "@/lib/stellar";
import { useWallet, type DemoRole, type WalletType } from "@/lib/wallet-context";

interface WalletSelectModalProps {
  open: boolean;
  onClose: () => void;
  onRequestPasskeyOnboarding?: () => void;
}

function getDiagnosticHint(error: string): string {
  const lower = error.toLowerCase();
  if (lower.includes("freighter")) {
    return "Install the Freighter browser extension from freighter.app and unlock your account, or choose Passkey / Albedo.";
  }
  if (lower.includes("xbull")) {
    return "Ensure the xBull browser extension is installed and unlocked, or switch to Albedo (no extension needed).";
  }
  if (lower.includes("albedo")) {
    return "Allow browser popups for this site so the Albedo signing window can open.";
  }
  if (lower.includes("passkey") || lower.includes("webauthn")) {
    return "Verify WebAuthn / biometrics are enabled in your browser and you are on HTTPS or localhost.";
  }
  return "Check your browser extension permissions or try another Stellar wallet provider below.";
}

export function WalletSelectModal({
  open,
  onClose,
  onRequestPasskeyOnboarding,
}: WalletSelectModalProps) {
  const { t } = useI18n();
  const { connecting, error, activeConnector, connectWallet, clearError } = useWallet();
  const [installed, setInstalled] = useState<InstalledWalletsStatus>({
    freighter: false,
    xbull: false,
    albedo: true,
    passkey: true,
  });

  useEffect(() => {
    if (open) {
      setInstalled(detectInstalledWallets());
    }
  }, [open]);

  if (!open) return null;

  async function handleSelect(type: WalletType, role?: DemoRole) {
    if (type === "passkey" && onRequestPasskeyOnboarding) {
      clearError();
      onClose();
      onRequestPasskeyOnboarding();
      return;
    }
    const result = await connectWallet(type, role ? { role } : undefined);
    if (result) {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="wallet-modal-title" className="text-lg font-bold text-slate-900">
              {t("wallet.modalTitle")}
            </h2>
            <p className="mt-1 text-xs text-slate-500">{t("wallet.modalSubtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              clearError();
              onClose();
            }}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        <div className="space-y-2.5">
          {/* Passkey Smart Account (Recommended) */}
          <button
            type="button"
            disabled={connecting}
            onClick={() => void handleSelect("passkey")}
            className={`flex w-full items-center gap-3.5 rounded-xl border p-3.5 text-left transition ${
              activeConnector === "passkey"
                ? "border-blue-500 bg-blue-50/70"
                : "border-blue-200 bg-blue-50/30 hover:border-blue-400 hover:bg-blue-50/60"
            }`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">{t("wallet.passkeyName")}</span>
                <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                  {t("wallet.recommended")}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{t("wallet.passkeyDesc")}</p>
            </div>
          </button>

          {/* Freighter Extension */}
          <button
            type="button"
            disabled={connecting}
            onClick={() => void handleSelect("freighter")}
            className={`flex w-full items-center gap-3.5 rounded-xl border p-3.5 text-left transition ${
              activeConnector === "freighter"
                ? "border-slate-900 bg-slate-50"
                : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2L3 7l9 5 9-5-9-5zM3 17l9 5 9-5M3 12l9 5 9-5" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900">{t("wallet.freighterName")}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    installed.freighter
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {installed.freighter ? t("wallet.installed") : t("wallet.notInstalled")}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{t("wallet.freighterDesc")}</p>
            </div>
          </button>

          {/* xBull Wallet */}
          <button
            type="button"
            disabled={connecting}
            onClick={() => void handleSelect("xbull")}
            className={`flex w-full items-center gap-3.5 rounded-xl border p-3.5 text-left transition ${
              activeConnector === "xbull"
                ? "border-slate-900 bg-slate-50"
                : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900">{t("wallet.xbullName")}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    installed.xbull
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {installed.xbull ? t("wallet.installed") : t("wallet.notInstalled")}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{t("wallet.xbullDesc")}</p>
            </div>
          </button>

          {/* Albedo */}
          <button
            type="button"
            disabled={connecting}
            onClick={() => void handleSelect("albedo")}
            className={`flex w-full items-center gap-3.5 rounded-xl border p-3.5 text-left transition ${
              activeConnector === "albedo"
                ? "border-slate-900 bg-slate-50"
                : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
            }`}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 3" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900">{t("wallet.albedoName")}</span>
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
                  {t("wallet.zeroInstall")}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">{t("wallet.albedoDesc")}</p>
            </div>
          </button>
        </div>

        {/* Connection Error Diagnostics */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900 space-y-1">
            <div className="font-bold">{t("wallet.errorDiagnosticTitle")}</div>
            <div>{error}</div>
            <div className="text-[11px] text-red-700">{getDiagnosticHint(error)}</div>
          </div>
        )}

        {/* Instant Cryptographic Role Signers */}
        <div className="border-t border-slate-100 pt-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Instant Cryptographic Role Signers
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["brand", "owner", "service"] as const).map((role) => (
              <button
                key={role}
                type="button"
                disabled={connecting}
                onClick={() => void handleSelect("keypair", role)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold capitalize text-slate-700 hover:bg-slate-100"
              >
                {role}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
