import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import { AppThemeProvider } from "@/components/ThemeToggle";
import { WalletProvider } from "@/lib/wallet-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veritag — On-Chain Product Authenticity & Warranty Registry",
  description:
    "Verify genuine products, claim scratch-secret Merkle warranties, and transfer ownership on Stellar Soroban.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <AppThemeProvider>
          <WalletProvider>
            <Navbar />
            <main className="flex-1">{children}</main>
            <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              Veritag · Powered by Stellar Soroban · Chain-anchored authenticity &amp; transferable
              warranties
            </footer>
          </WalletProvider>
        </AppThemeProvider>
      </body>
    </html>
  );
}
