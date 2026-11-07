import Link from "next/link";

export function Navbar() {
  return (
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

        <nav className="flex items-center gap-1 text-sm font-medium text-slate-600 sm:gap-4">
          <Link
            href="/"
            className="rounded-md px-2.5 py-1.5 transition hover:bg-slate-100 hover:text-slate-900"
          >
            Verify
          </Link>
          <Link
            href="/owner"
            className="rounded-md px-2.5 py-1.5 transition hover:bg-slate-100 hover:text-slate-900"
          >
            Owner
          </Link>
          <Link
            href="/service"
            className="rounded-md px-2.5 py-1.5 transition hover:bg-slate-100 hover:text-slate-900"
          >
            Service
          </Link>
          <Link
            href="/brand"
            className="rounded-md px-2.5 py-1.5 transition hover:bg-slate-100 hover:text-slate-900"
          >
            Brands
          </Link>
        </nav>
      </div>
    </header>
  );
}
