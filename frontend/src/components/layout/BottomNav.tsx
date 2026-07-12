"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_LEFT = [
  { href: "/explore", label: "Explore" },
  { href: "/marketplace", label: "Market" },
];
const NAV_RIGHT = [
  { href: "/leaderboard", label: "Ranks" },
  { href: "/portfolio", label: "Me" },
];

export function BottomNav() {
  const pathname = usePathname();

  // landing pages have their own chrome
  if (pathname.startsWith("/landing")) return null;

  const renderLink = ({ href, label }: { href: string; label: string }) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        className={`flex flex-col items-center justify-center flex-1 h-full gap-0.5 text-[10px] transition-colors border-t-2
          ${active ? "font-semibold text-ink border-ink" : "font-medium text-text-secondary border-transparent hover:text-ink"}`}
      >
        {label}
      </Link>
    );
  };

  return (
    <nav className="glass-strong fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-line safe-area-pb">
      <div className="flex items-center justify-around h-14">
        {NAV_LEFT.map(renderLink)}

        {/* Launch: compact pill elevated above the nav bar */}
        <div className="relative flex flex-col items-center justify-center flex-1 h-full">
          <Link
            href="/launch"
            className="btn-primary absolute -top-4 rounded-full px-4 py-1.5 text-xs font-semibold"
          >
            Launch
          </Link>
        </div>

        {NAV_RIGHT.map(renderLink)}
      </div>
    </nav>
  );
}
