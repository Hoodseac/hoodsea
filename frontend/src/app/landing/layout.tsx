import Link from "next/link";
import type { Metadata } from "next";
import { LandingMotion } from "@/components/landing/LandingMotion";
import { Mark } from "@/components/layout/Navbar";

export const metadata: Metadata = {
  title: "Hoodsea — Launch into the deep, surface with a token",
  description:
    "Free-mint NFT collections that bond into tokens on Robinhood Chain. Liquidity locked on Uniswap V3 and V4, on-chain allowlists, anti-snipe reveals and a hard-coded vault that pays holders every epoch.",
};

// Env-driven so no live domain lands in committed files.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const APP_URL = `${SITE_URL}/explore`;
const SUPPORT_URL = `${SITE_URL}/support`;

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-transparent text-gray-900 overflow-x-clip">
      <LandingMotion />
      {/* Landing header */}
      <header className="sticky top-0 z-50 border-b border-gray-100 bg-white/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 text-[15px] font-bold tracking-tight text-ink">
            <Mark />
            Hoodsea
          </Link>
          <nav className="flex items-center gap-2 sm:gap-6">
            <Link href="/docs" className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors px-2">
              Docs
            </Link>
            <Link href="/news" className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors px-2">
              Field&nbsp;Notes
            </Link>
            <a href={SUPPORT_URL} className="text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors px-2">
              Support
            </a>
          </nav>
        </div>
      </header>

      <main className="relative z-10">{children}</main>

      {/* Footer */}
      <footer className="border-t border-gray-100 mt-24">
        <div className="max-w-6xl mx-auto px-5 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-400">
            © {new Date().getFullYear()} Hoodsea. Free-mint collections that bond into tokens on Robinhood Chain
          </p>
          <div className="flex items-center gap-6 text-sm text-gray-400">
            <Link href="/docs" className="hover:text-gray-700 transition-colors">Docs</Link>
            <Link href="/news" className="hover:text-gray-700 transition-colors">Field Notes</Link>
            <a href={SUPPORT_URL} className="hover:text-gray-700 transition-colors">Support</a>
            <a href="https://x.com/hoodsea_" target="_blank" rel="noopener noreferrer" className="hover:text-gray-700 transition-colors">X</a>
            <a href="https://github.com/Hoodseac/hoodsea" target="_blank" rel="noopener noreferrer" className="hover:text-gray-700 transition-colors">GitHub</a>
            <a href={APP_URL} className="hover:text-gray-700 transition-colors">App</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
