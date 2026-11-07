import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veritag — On-Chain Product Authenticity & Warranty Registry",
  description:
    "Verify genuine products, claim scratch-secret Merkle warranties, and transfer ownership on Stellar Soroban.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1">{children}</main>
        <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
          Veritag · Powered by Stellar Soroban · Chain-anchored authenticity &amp; transferable warranties
        </footer>
      </body>
    </html>
  );
}
