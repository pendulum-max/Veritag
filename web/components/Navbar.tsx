"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useWallet } from "@/lib/wallet-context";

export function Navbar() {
  const {
    session,
    connecting,
    error,
    connectFreighter,
    connectPasskey,
    connectRoleKeypair,
    disconnect,
  } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const walletDialogRef = useRef<HTMLDivElement | null>(null);

  useFocusTrap(menuOpen, walletDialogRef, () => setMenuOpen(false));

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white dark:bg-blue-600">
            V
          </span>
          <div>
            <span className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Veritag
            </span>
            <span className="ml-2 hidden rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-200 sm:inline-block">
              Stellar Soroban
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-3">
          <nav
            aria-label="Main navigation"
            className="flex items-center gap-1 text-sm font-medium text-slate-700 dark:text-slate-300 sm:gap-3"
          >
            <Link
              href="/"
              className="rounded-md px-2.5 py-1.5 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Verify
            </Link>
            <Link
              href="/owner"
              className="rounded-md px-2.5 py-1.5 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Owner
            </Link>
            <Link
              href="/service"
              className="rounded-md px-2.5 py-1.5 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Service
            </Link>
            <Link
              href="/brand"
              className="rounded-md px-2.5 py-1.5 transition hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Brands
            </Link>
          </nav>

          <ThemeToggle />

          <div className="relative">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={menuOpen}
              aria-label={session ? "Open connected wallet menu" : "Connect wallet"}
              onClick={() => setMenuOpen((prev) => !prev)}
              className="rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500"
            >
              {session
                ? `${session.address.slice(0, 5)}...${session.address.slice(-4)}`
                : connecting
                  ? "Connecting..."
                  : "Connect Wallet"}
            </button>

            {menuOpen && (
              <div
                ref={walletDialogRef}
                role="dialog"
                aria-modal="true"
                aria-label="Stellar and Soroban Wallets"
                tabIndex={-1}
                className="absolute right-0 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-4 shadow-xl space-y-2.5 z-50 dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    Stellar &amp; Soroban Wallets
                  </div>
                  <button
                    type="button"
                    onClick={() => setMenuOpen(false)}
                    aria-label="Close wallet menu"
                    className="rounded-md p-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="h-4 w-4"
                    >
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {session ? (
                  <div className="space-y-2">
                    <div className="rounded-xl bg-slate-50 p-2.5 text-xs dark:bg-slate-800">
                      <div className="font-semibold text-slate-800 dark:text-slate-100">
                        {session.label}
                      </div>
                      <div className="mt-1 break-all font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        {session.address}
                      </div>
                      <div className="mt-1 text-[11px] text-emerald-700 font-medium dark:text-emerald-400">
                        {session.token ? "Authenticated Session Active" : "Local Signer Ready"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        disconnect();
                        setMenuOpen(false);
                      }}
                      className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-950"
                    >
                      Disconnect Wallet
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        await connectPasskey();
                        setMenuOpen(false);
                      }}
                      className="w-full rounded-xl bg-blue-600 px-3 py-2 text-left text-xs font-semibold text-white hover:bg-blue-700"
                    >
                      Passkey Smart Wallet (secp256r1)
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await connectFreighter();
                        setMenuOpen(false);
                      }}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-left text-xs font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Freighter Extension (G...)
                    </button>
                    <div className="pt-1 text-[11px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                      Instant Cryptographic Role Signers
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      <button
                        type="button"
                        onClick={async () => {
                          await connectRoleKeypair("brand");
                          setMenuOpen(false);
                        }}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        Brand
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await connectRoleKeypair("owner");
                          setMenuOpen(false);
                        }}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        Owner
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await connectRoleKeypair("service");
                          setMenuOpen(false);
                        }}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        Service
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <p role="alert" className="text-[11px] text-red-700 dark:text-red-400">
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
