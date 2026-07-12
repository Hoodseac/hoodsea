"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { CollectionCard } from "@/components/collection/CollectionCard";
import { HeroCarousel } from "@/components/collection/HeroCarousel";
import { useRecentCollections, type CollectionMeta } from "@/hooks/useCollections";
import { fetchProfiles, type Identity } from "@/lib/profiles";

export default function ExplorePage() {
  const { collections, isLoading } = useRecentCollections(50);
  const [search, setSearch] = useState("");
  const [identities, setIdentities] = useState<Record<string, Identity>>({});

  useEffect(() => {
    const addrs = collections.map((c) => c.creator).filter(Boolean);
    if (addrs.length) fetchProfiles(addrs).then(setIdentities).catch(() => {});
  }, [collections]);

  const nowSec = Math.floor(Date.now() / 1000);

  // Featured = most-minted active collections, for the swipeable hero.
  const featured = useMemo(
    () => [...collections].filter((c) => c.minted > 0).sort((a, b) => b.minted - a.minted).slice(0, 6),
    [collections]
  );

  // Sections. `collections` arrives newest-first from the hook.
  const liveBonding = useMemo(
    () => [...collections].filter((c) => c.mintOpen && !c.bonded).sort((a, b) => b.minted - a.minted),
    [collections]
  );
  const recentlyBonded = useMemo(() => collections.filter((c) => c.bonded), [collections]);
  const liveTokens = useMemo(() => collections.filter((c) => c.bonded && c.tokenAddress), [collections]);
  const upcoming = useMemo(
    () => collections.filter((c) => !c.mintOpen && !c.bonded && c.startTime > nowSec),
    [collections, nowSec]
  );
  const newest = collections;

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return collections.filter(
      (c) => c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q) || c.bio.toLowerCase().includes(q)
    );
  }, [collections, search]);

  const searching = search.trim().length > 0;

  return (
    <div className="relative">
      {/* Hero grid backdrop */}
      <div aria-hidden className="hero-grid pointer-events-none absolute inset-x-0 top-0 h-72" />
      <div className="relative mx-auto max-w-page px-6 py-8">
      {/* Header */}
      <div className="mb-5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-1">The board</p>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink">Surfacing now</h1>
        <p className="mt-1 text-sm text-text-secondary">Free-mint collections bonding into tokens on Robinhood Chain.</p>
      </div>

      {/* Search */}
      <input
        className="input-base w-full mb-6 max-w-md"
        placeholder="Search by name, ticker, bio"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {/* Search mode: flat grid of matches */}
      {searching ? (
        searchResults.length === 0 ? (
          <div className="card text-center py-16">
            <p className="text-lg font-semibold text-ink mb-1">Nothing found</p>
            <p className="text-sm text-text-secondary">No results for &quot;{search}&quot;</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-text-secondary mb-4">{searchResults.length} result{searchResults.length !== 1 ? "s" : ""}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {searchResults.map((col) => <CollectionCard key={col.address} collection={col} />)}
            </div>
          </>
        )
      ) : isLoading ? (
        <div className="space-y-8">
          {[1, 2].map((s) => (
            <div key={s}>
              <div className="h-5 w-40 bg-ink/5 animate-pulse rounded mb-3" />
              <div className="flex gap-4 overflow-hidden">
                {[1, 2, 3, 4].map((i) => <div key={i} className="w-64 sm:w-72 flex-shrink-0 card animate-pulse h-72" />)}
              </div>
            </div>
          ))}
        </div>
      ) : collections.length === 0 ? (
        <div className="card text-center py-20">
          <p className="text-xl font-semibold text-ink mb-2">Nothing in the water yet</p>
          <p className="text-sm text-text-secondary">Be the first to drop a collection.</p>
        </div>
      ) : (
        <div className="space-y-9">
          {/* Featured hero */}
          {featured.length > 0 && <HeroCarousel items={featured} identities={identities} />}

          <Rail title="Live bonding" subtitle="Filling now, on the way to sellout" items={liveBonding} />
          <Rail title="Recently bonded" subtitle="Just surfaced with a token" items={recentlyBonded} />
          <Rail title="Live tokens" subtitle="Tradable now" items={liveTokens} variant="token" />
          <Rail title="Newest drops" subtitle="Fresh in the water" items={newest} />
          <Rail title="Upcoming" subtitle="Scheduled to open" items={upcoming} />
        </div>
      )}
      </div>
    </div>
  );
}

// Horizontal, swipeable rail of collection cards. Renders nothing when empty so
// quiet sections do not leave a hole.
function Rail({ title, subtitle, items, variant }: { title: string; subtitle?: string; items: CollectionMeta[]; variant?: "token" }) {
  const scroller = useRef<HTMLDivElement>(null);
  if (!items || items.length === 0) return null;

  const nudge = (dir: number) => scroller.current?.scrollBy({ left: dir * 320, behavior: "smooth" });

  return (
    <section>
      <div className="flex items-end justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-ink leading-tight">{title}</h2>
          {subtitle && <p className="text-xs text-text-secondary">{subtitle}</p>}
        </div>
        <div className="hidden sm:flex items-center gap-1.5">
          <button onClick={() => nudge(-1)} aria-label="Scroll left"
            className="w-7 h-7 inline-flex items-center justify-center rounded-full border border-line bg-white/70 text-text-secondary hover:border-ink/30 hover:text-ink transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <button onClick={() => nudge(1)} aria-label="Scroll right"
            className="w-7 h-7 inline-flex items-center justify-center rounded-full border border-line bg-white/70 text-text-secondary hover:border-ink/30 hover:text-ink transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>
      </div>
      <div ref={scroller} className="flex gap-4 overflow-x-auto pb-2 -mx-6 px-6 scrollbar-hide snap-x">
        {items.map((col, i) => (
          <motion.div
            key={col.address + (variant || "")}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.3) }}
            className="w-64 sm:w-72 flex-shrink-0 snap-start"
          >
            <CollectionCard collection={col} />
          </motion.div>
        ))}
      </div>
    </section>
  );
}
