"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { checkPlatformAuthenticatorSupport, type PasskeySupportStatus } from "@/lib/passkey";
import { useWallet } from "@/lib/wallet-context";

interface PasskeyOnboardingModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (address: string) => void;
}

export function PasskeyOnboardingModal({
  open,
  onClose,
  onSuccess,
}: PasskeyOnboardingModalProps) {
  const { t } = useI18n();
  const { connectPasskey, connecting, error } = useWallet();
  const [support, setSupport] = useState<PasskeySupportStatus | null>(null);
  const [walletLabel, setWalletLabel] = useState("Veritag Owner Passkey");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLocalError(null);
    void checkPlatformAuthenticatorSupport().then((status) => {
      if (active) setSupport(status);
    });
    return () => {
      active = false;
    };
  }, [open]);

  if (!open) return null;

  async function handleCreate() {
    setLocalError(null);
    const session = await connectPasskey(walletLabel.trim() || "Veritag Owner Passkey");
    if (session) {
      onSuccess?.(session.address);
      onClose();
    } else {
      setLocalError(error ?? "Passkey registration did not complete. Check browser WebAuthn permissions.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="passkey-onboarding-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="passkey-onboarding-title" className="text-lg font-bold text-slate-900">
              {t("passkey.onboardingTitle")}
            </h2>
            <p className="mt-1 text-xs text-slate-600">{t("passkey.onboardingSubtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close passkey onboarding"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {/* Device Biometric Illustrations: FaceID, TouchID, Android / Windows Hello */}
        <div className="grid grid-cols-3 gap-3">
          <div
            className={`flex flex-col items-center rounded-xl border p-3 text-center ${
              support?.platformHint === "apple"
                ? "border-blue-400 bg-blue-50/60"
                : "border-slate-200 bg-slate-50/60"
            }`}
          >
            <svg className="h-9 w-9 text-slate-800" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M4 16v2a2 2 0 002 2h2m8 0h2a2 2 0 002-2v-2" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 10v1m6-1v1m-3-1v3.5a1 1 0 01-1 1h-.5M9 15.5c.8.8 2 1.2 3 1.2s2.2-.4 3-1.2" />
            </svg>
            <span className="mt-2 text-xs font-semibold text-slate-800">{t("passkey.faceIdLabel")}</span>
          </div>

          <div className="flex flex-col items-center rounded-xl border border-slate-200 bg-slate-50/60 p-3 text-center">
            <svg className="h-9 w-9 text-slate-800" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
            </svg>
            <span className="mt-2 text-xs font-semibold text-slate-800">{t("passkey.touchIdLabel")}</span>
          </div>

          <div
            className={`flex flex-col items-center rounded-xl border p-3 text-center ${
              support?.platformHint === "android" || support?.platformHint === "windows"
                ? "border-blue-400 bg-blue-50/60"
                : "border-slate-200 bg-slate-50/60"
            }`}
          >
            <svg className="h-9 w-9 text-slate-800" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
              <rect x="7" y="2" width="10" height="20" rx="2" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 10a2 2 0 114 0c0 1.5-1 2.5-1 4m-1 3h.01" />
            </svg>
            <span className="mt-2 text-xs font-semibold text-slate-800">
              {t("passkey.androidBiometricsLabel")}
            </span>
          </div>
        </div>

        {/* Platform Authenticator Detection Status */}
        {support === null ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
            {t("passkey.checkingSupport")}
          </div>
        ) : support.platformAuthenticatorAvailable ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-800">
            ✓ {t("passkey.supportedMessage")}
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 space-y-1.5">
            <div className="font-bold">{t("passkey.fallbackTitle")}</div>
            <p>{t("passkey.fallbackGuidance")}</p>
          </div>
        )}

        {/* Troubleshooting Guidance */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-1">
          <div className="font-semibold text-slate-800">{t("passkey.troubleshootTitle")}</div>
          <p>{t("passkey.troubleshootSteps")}</p>
        </div>

        <div>
          <label className="block text-xs font-semibold uppercase text-slate-600">
            Wallet Label
          </label>
          <input
            type="text"
            value={walletLabel}
            onChange={(e) => setWalletLabel(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
          />
        </div>

        {(localError || error) && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {localError ?? error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={connecting}
            onClick={() => void handleCreate()}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {connecting ? t("passkey.creatingButton") : t("passkey.createButton")}
          </button>
        </div>
      </div>
    </div>
  );
}
