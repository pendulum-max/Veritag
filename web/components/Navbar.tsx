"use client";

import Link from "next/link";
import { useState } from "react";
import { LanguageSelector } from "@/components/LanguageSelector";
import { PasskeyOnboardingModal } from "@/components/PasskeyOnboardingModal";
import { WalletSelectModal } from "@/components/WalletSelectModal";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet-context";

export function Navbar() {
  const { t } = useI18n();
  const { session, connecting, disconnect } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [passkeyModalOpen, setPasskeyModalOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">
              V
            </span>
            <div>
              <span className="text-lg font-bold tracking-tight text-slate-900">Veritag</span>
              <span className="ml-2 hidden rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 sm:inline-block">
                Stellar Soroban
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <nav className="flex items-center gap-1 text-sm font-medium text-slate-600 sm:gap-3">
              <Link
                href="/"
                className="rounded-md px-2.5 py-1.5 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {t("nav.verify")}
              </Link>
              <Link
                href="/owner"
                className="rounded-md px-2.5 py-1.5 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {t("nav.owner")}
              </Link>
              <Link
                href="/service"
                className="rounded-md px-2.5 py-1.5 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {t("nav.service")}
              </Link>
              <Link
                href="/brand"
                className="rounded-md px-2.5 py-1.5 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {t("nav.brands")}
              </Link>
            </nav>

            <LanguageSelector />

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  if (session) {
                    setMenuOpen((prev) => !prev);
                  } else {
                    setWalletModalOpen(true);
                  }
                }}
                className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800"
              >
                {session
                  ? `${session.address.slice(0, 5)}...${session.address.slice(-4)}`
                  : connecting
                    ? t("nav.connecting")
                    : t("nav.connectWallet")}
              </button>

              {menuOpen && session && (
                <div className="absolute right-0 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl space-y-2.5 z-50">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Stellar &amp; Soroban Wallets
                  </div>
                  <div className="space-y-2">
                    <div className="rounded-xl bg-slate-50 p-2.5 text-xs dark:bg-slate-800">
                      <div className="font-semibold text-slate-800 dark:text-slate-100">
                        {session.label}
                      </div>
                      <div className="mt-1 break-all font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        {session.address}
                      </div>
                      <div className="mt-1 text-[11px] text-emerald-700 font-medium">
                        {session.token ? "Authenticated Session Active" : "Wallet Connected"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setWalletModalOpen(true);
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Switch Wallet
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        disconnect();
                        setMenuOpen(false);
                      }}
                      className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                    >
                      {t("nav.disconnect")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <WalletSelectModal
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        onRequestPasskeyOnboarding={() => setPasskeyModalOpen(true)}
      />

      <PasskeyOnboardingModal
        open={passkeyModalOpen}
        onClose={() => setPasskeyModalOpen(false)}
      />
    </>
  );
}
