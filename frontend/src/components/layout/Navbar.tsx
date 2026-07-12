"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount } from "wagmi";
import { useAuth } from "@/lib/useAuth";
import { robinhoodChain } from "@/lib/chain";
import { ProfilePanel } from "./ProfilePanel";
import { ProfileSetupModal } from "@/components/ui/ProfileSetupModal";
import { TermsModal } from "@/components/ui/TermsModal";
import { useProfile } from "@/hooks/useProfile";

// The Hoodsea mark: ink rounded tile with the green breaking-wave logo centered.
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: 9,
        background: "#050600",
        boxShadow: "0 6px 16px -8px rgba(0,200,5,0.55)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/hoodsea-logo.png"
        alt="Hoodsea"
        width={Math.round(size * 0.72)}
        height={Math.round(size * 0.72)}
        style={{ objectFit: "contain" }}
      />
    </span>
  );
}

const NAV = [
  { href: "/explore", label: "Explore" },
  { href: "/launch", label: "Launch" },
  { href: "/marketplace", label: "Market" },
  { href: "/airdrops", label: "Airdrops" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/support", label: "Support" },
];

function isActive(pathname: string, href: string) {
  return (
    pathname.startsWith(href) ||
    (href === "/explore" && (pathname.startsWith("/collection") || pathname.startsWith("/token")))
  );
}

// Live-on-chain pill, Primehod-style: a soft-pinging dot next to the chain name.
function ChainPill({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border border-line bg-white/70 px-3.5 py-1.5 text-xs font-semibold text-ink ${className}`}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
      </span>
      Live on {robinhoodChain.name}
    </span>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const { address, isConnected } = useAccount();
  const { login, logout } = useAuth();
  const { profile, updateProfile } = useProfile();
  const [profileOpen, setProfileOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(true); // assume accepted until we read localStorage (avoids SSR flash)
  useEffect(() => { setTosAccepted(localStorage.getItem("og_tos_accepted") === "1"); }, []);
  const shortAddr = address ? `${address.slice(0, 6)}...${address.slice(-4)}` : null;

  // Close the mobile menu on navigation.
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  // landing pages have their own chrome
  if (pathname.startsWith("/landing")) return null;

  const doSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (v) { router.push(`/u/${v}`); setQ(""); setMenuOpen(false); }
  };

  const ConnectPill = ({ block = false }: { block?: boolean }) =>
    isConnected ? (
      <button
        onClick={() => { setProfileOpen(true); setMenuOpen(false); }}
        className={`btn-secondary rounded-full px-4 py-2 text-xs font-semibold ${block ? "w-full justify-center" : ""}`}
      >
        <span className="h-2 w-2 rounded-full bg-brand" />
        {profile?.username || shortAddr}
      </button>
    ) : (
      <button
        onClick={() => { login(); setMenuOpen(false); }}
        className={`btn-primary rounded-full px-4 py-2 text-xs font-semibold ${block ? "w-full justify-center" : ""}`}
      >
        Connect
      </button>
    );

  return (
    <>
    <header className="glass-strong sticky top-0 z-50 border-b border-line">
      <nav className="mx-auto flex max-w-page items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 text-[15px] font-bold tracking-tight text-ink">
          <Mark />
          Hoodsea
        </Link>

        <div className="hidden items-center gap-0.5 md:flex">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                  active
                    ? "font-semibold text-ink"
                    : "font-medium text-text-secondary hover:text-ink"
                }`}
              >
                {item.label}
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-x-3 -bottom-[13px] h-[2.5px] rounded-full bg-ink"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
              </Link>
            );
          })}
        </div>

        <div className="flex-1" />

        <form onSubmit={doSearch} className="hidden lg:block">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search user"
            className="input-glow w-36 rounded-full border border-line bg-white/70 px-3.5 py-1.5 text-xs text-ink outline-none placeholder:text-text-dim transition-all"
          />
        </form>

        <ChainPill className="hidden xl:inline-flex" />

        <div className="hidden md:block">
          <ConnectPill />
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-white/70 text-ink transition-colors hover:border-ink/30 md:hidden"
        >
          {menuOpen ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
          )}
        </button>
      </nav>

      {/* Mobile menu */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-line md:hidden"
          >
            <div className="space-y-1 px-4 py-3 sm:px-6">
              {NAV.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className={`block rounded-xl px-3 py-2.5 text-sm ${
                      active ? "bg-ink/5 font-semibold text-ink" : "font-medium text-text-secondary"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}

              <form onSubmit={doSearch} className="pt-1">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search user"
                  className="input-glow w-full rounded-xl border border-line bg-white/70 px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-text-dim transition-all"
                />
              </form>

              <div className="flex items-center justify-between gap-3 pt-2">
                <ChainPill />
                <ConnectPill />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
    <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} onEdit={() => { setProfileOpen(false); setEditOpen(true); }} />
    {isConnected && !tosAccepted && (
      <TermsModal
        onAccept={() => { localStorage.setItem("og_tos_accepted", "1"); setTosAccepted(true); }}
        onDecline={() => { logout(); }}
      />
    )}
    {/* No forced profile popup on connect: users land in the app anonymous by
        default. Setting a username / photo / bio is optional and opened on demand
        from the profile menu (ProfilePanel -> Edit profile), which drives editOpen. */}
    {editOpen && address && (
      <ProfileSetupModal
        address={address}
        editMode
        initialUsername={profile?.username || ""}
        initialTwitter={profile?.twitter || ""}
        initialTwitterVerified={profile?.twitterVerified || false}
        initialAvatar={profile?.avatar || ""}
        initialWebsite={profile?.website || ""}
        initialBio={profile?.bio || ""}
        onComplete={(p) => { updateProfile(p); setEditOpen(false); }}
        onClose={() => setEditOpen(false)}
      />
    )}
    </>
  );
}
