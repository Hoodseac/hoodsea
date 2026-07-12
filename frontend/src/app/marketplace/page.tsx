"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { usePublicClient } from "wagmi";
import { formatEther } from "viem";
import { useRecentCollections } from "@/hooks/useCollections";
import { NFT_ABI } from "@/lib/contracts";
import { IpfsImage } from "@/components/ui/IpfsImage";

type MarketTab = "nft" | "token";
type PriceSort = "asc" | "desc" | "trending" | "volume";

interface CollectionWithFloor {
  address: string;
  name: string;
  ticker: string;
  coverPhoto: string;
  minted: number;
  mintPrice: string;
  tokenAddress: string | null;
  floorPrice: bigint | null;
  volume: bigint;
  sales: number;
  bondingTimestamp: number; // unix seconds when BondingComplete event was emitted
}

function timeAgo(unix: number): string {
  const secs = Math.floor(Date.now() / 1000) - unix;
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function MarketplacePage() {
  // Marketplace browses the 50 most recent collections (cap protects the RPC from
  // the per-collection listing scan in enrich()). Older ones beyond this set are
  // reachable by pasting their contract address in the search box (see CA lookup).
  const { collections, isLoading } = useRecentCollections(50);
  const client = usePublicClient();
  const [tab, setTab] = useState<MarketTab>("nft");
  const [search, setSearch] = useState("");
  const [priceSort, setPriceSort] = useState<PriceSort>("trending");
  const [enriched, setEnriched] = useState<CollectionWithFloor[]>([]);
  const [loadingEnrich, setLoadingEnrich] = useState(false);

  const bonded = collections.filter(c => c.bonded);
  const tokens = collections.filter(c => c.bonded && c.tokenAddress);

  // Enrich bonded collections with floor price + volume from events
  useEffect(() => {
    if (!bonded.length || !client) return;
    setLoadingEnrich(true);

    const enrich = async () => {
      // Token trade volume comes from the server-side index (one source of truth,
      // identical everywhere). Floor price stays a live on-chain read.
      const volMap: Record<string, bigint> = {};
      try {
        const api = process.env.NEXT_PUBLIC_PROFILE_API || "";
        const v = await fetch(`${api}/api/volume`).then((r) => r.json());
        for (const [addr, wei] of Object.entries(v.byCollection || {})) volMap[String(addr).toLowerCase()] = BigInt(wei as string);
      } catch {}

      const results: CollectionWithFloor[] = await Promise.all(
        bonded.map(async (col) => {
          let floorPrice: bigint | null = null;
          try {
            const prices = await Promise.all(
              Array.from({ length: 100 }, (_, i) =>
                client.readContract({ address: col.address as `0x${string}`, abi: NFT_ABI, functionName: "tokenListPrice", args: [BigInt(i + 1)] })
                  .then(p => ({ tokenId: i + 1, price: p as bigint }))
                  .catch(() => ({ tokenId: i + 1, price: BigInt(0) }))
              )
            );
            const listed = prices.filter(p => p.price > BigInt(0));
            if (listed.length > 0) {
              floorPrice = listed.reduce((min, p) => p.price < min ? p.price : min, listed[0].price);
            }
          } catch {}

          return {
            address: col.address,
            name: col.name,
            ticker: col.ticker,
            coverPhoto: col.coverPhoto,
            minted: col.minted,
            mintPrice: col.mintPrice,
            tokenAddress: col.tokenAddress,
            floorPrice,
            volume: volMap[col.address.toLowerCase()] || BigInt(0),
            sales: 0,
            bondingTimestamp: 0,
          };
        })
      );
      setEnriched(results);
      setLoadingEnrich(false);
    };

    enrich();
  }, [bonded.length, client]);

  const HOT_WINDOW = 7 * 86400; // 7 days in seconds
  const nowSec = Math.floor(Date.now() / 1000);

  const sortedNFTs = [...(enriched.length ? enriched : bonded.map(c => ({ ...c, floorPrice: null, volume: BigInt(0), sales: 0, bondingTimestamp: 0 })))]
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.ticker.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const aHot = a.bondingTimestamp > 0 && nowSec - a.bondingTimestamp < HOT_WINDOW;
      const bHot = b.bondingTimestamp > 0 && nowSec - b.bondingTimestamp < HOT_WINDOW;
      if (priceSort === "volume") return b.volume > a.volume ? 1 : -1;
      if (priceSort === "asc") {
        if (!a.floorPrice && !b.floorPrice) return 0;
        if (!a.floorPrice) return 1;
        if (!b.floorPrice) return -1;
        return a.floorPrice < b.floorPrice ? -1 : 1;
      }
      if (priceSort === "desc") {
        if (!a.floorPrice && !b.floorPrice) return 0;
        if (!a.floorPrice) return 1;
        if (!b.floorPrice) return -1;
        return b.floorPrice < a.floorPrice ? -1 : 1;
      }
      // trending: Hot collections first, then by most minted
      if (aHot !== bHot) return aHot ? -1 : 1;
      return b.minted - a.minted;
    });

  const sortedTokens = [...tokens]
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.ticker.toLowerCase().includes(search.toLowerCase()));

  const totalMinted = bonded.reduce((s, c) => s + c.minted, 0);
  const enrichedVol = enriched.reduce((s, e) => s + e.volume, BigInt(0));

  return (
    <div className="max-w-7xl mx-auto px-4 py-10 pb-24">
      {/* Header */}
      <div className="mb-6 text-center">
        <p className="text-xs font-semibold text-accent uppercase tracking-[0.16em] mb-2">The Market</p>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-ink mb-2">Trade the surfaced</h1>
        <p className="text-sm text-text-secondary max-w-md mx-auto">Bonded collections and live tokens, liquidity locked in the deep. 1.5% fee on trades.</p>
      </div>

      {/* Tabs — centered pill segmented control */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center gap-1 rounded-full border border-line bg-white/70 p-1 shadow-[0_1px_2px_rgba(5,6,0,0.04)]">
          {(["nft", "token"] as MarketTab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-full px-5 py-2 text-sm font-semibold transition-all ${
                tab === t ? "bg-sea text-ink shadow-[0_6px_16px_-8px_rgba(206,246,6,0.9)]" : "text-text-secondary hover:text-ink"
              }`}>
              {t === "nft" ? "NFT Collections" : "Tokens"}
            </button>
          ))}
        </div>
      </div>

      {/* Horizontal banner */}
      {!isLoading && bonded.length > 0 && (
        <div className="mb-6 -mx-4 px-4 overflow-x-auto scrollbar-hide">
          <div className="flex gap-3 pb-1" style={{ width: "max-content" }}>
            {bonded.map(col => (
              <Link key={col.address} href={`/collection/${col.address}`}
                className="flex-shrink-0 flex items-center gap-2.5 px-3 py-2 border border-border rounded-xl bg-surface hover:border-amber transition-colors">
                {col.coverPhoto && (
                  <IpfsImage uri={col.coverPhoto} className="w-8 h-8 object-cover" alt={col.name} />
                )}
                <div>
                  <p className="text-xs font-semibold text-text-primary whitespace-nowrap">{col.name}</p>
                  <p className="font-mono text-[10px] text-accent">${col.ticker} · {col.minted} minted</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className={`grid gap-4 mb-6 ${tab === "nft" ? "grid-cols-3" : "grid-cols-2"}`}>
        {tab === "nft"
          ? [
              { label: "Bonded Collections", value: isLoading ? "..." : String(bonded.length) },
              { label: "Total NFTs Minted", value: isLoading ? "..." : String(totalMinted) },
              { label: "Total Volume", value: enrichedVol > BigInt(0) ? `${parseFloat(formatEther(enrichedVol)).toFixed(3)} ETH` : "-" },
            ].map(s => (
              <div key={s.label} className="card text-center p-4">
                <p className="text-xl font-bold tabular-nums text-ink">{s.value}</p>
                <p className="text-xs text-text-secondary mt-1">{s.label}</p>
              </div>
            ))
          : [
              { label: "Tokens Live", value: isLoading ? "..." : String(tokens.length) },
              { label: "Bonded Collections", value: isLoading ? "..." : String(bonded.length) },
            ].map(s => (
              <div key={s.label} className="card text-center p-4">
                <p className="text-xl font-bold tabular-nums text-ink">{s.value}</p>
                <p className="text-xs text-text-secondary mt-1">{s.label}</p>
              </div>
            ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <input
          className="input-base flex-1"
          placeholder={tab === "nft" ? "Search NFT collections..." : "Search tokens..."}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {tab === "nft" && (
          <div className="flex gap-2 flex-wrap">
            {([["trending", "Trending ↑"], ["volume", "Volume ↑"], ["asc", "Floor ↑"], ["desc", "Floor ↓"]] as [PriceSort, string][]).map(([s, label]) => (
              <button key={s} onClick={() => setPriceSort(s)}
                className={`px-3 py-2 text-sm font-medium rounded-full border transition-colors ${
                  priceSort === s ? "border-ink bg-ink text-white" : "border-line bg-white/70 text-text-secondary hover:text-ink"
                }`}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* NFT Grid */}
      {tab === "nft" && (
        isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="card animate-pulse h-64" />)}
          </div>
        ) : bonded.length === 0 ? (
          <div className="card text-center py-20">
            <p className="text-xl font-semibold text-text-primary mb-2">No bonded collections yet</p>
            <p className="text-sm text-text-secondary mb-6">NFTs appear here after a collection sells out</p>
            <Link href="/explore" className="btn-primary">Explore Collections</Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {sortedNFTs.map((col, i) => (
              <motion.div key={col.address} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <NFTCollectionCard col={col as CollectionWithFloor} />
              </motion.div>
            ))}
          </div>
        )
      )}

      {/* Token Grid */}
      {tab === "token" && (
        isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="card animate-pulse h-64" />)}
          </div>
        ) : tokens.length === 0 ? (
          <div className="card text-center py-20">
            <p className="text-xl font-semibold text-text-primary mb-2">No tokens live yet</p>
            <p className="text-sm text-text-secondary mb-6">Tokens deploy automatically when a collection sells out</p>
            <Link href="/explore" className="btn-primary">Explore Collections</Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {sortedTokens.map((col, i) => (
              <motion.div key={col.address} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Link href={`/token/${col.tokenAddress}`}>
                  <div className="card hover:shadow-card-hover transition-all cursor-pointer group p-0 overflow-hidden">
                    <div className="aspect-[4/3] bg-muted overflow-hidden">
                      {col.coverPhoto ? (
                        <IpfsImage uri={col.coverPhoto} alt={col.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <span className="text-text-dim text-3xl">?</span>
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-1 mb-1">
                        <p className="font-semibold text-sm text-text-primary truncate">{col.name}</p>
                        <span className="text-xs text-accent font-mono shrink-0">${col.ticker}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="w-1.5 h-1.5 bg-brand rounded-full" />
                        <span className="text-xs text-accent font-medium">Token Live</span>
                      </div>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                        <span className="text-xs text-text-secondary">Trade in-app</span>
                        <span className="text-xs font-semibold text-accent">Open →</span>
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )
      )}
    </div>
  );
}

// ─── NFT Collection Card with floor price + buy floor ─────────────────────────

const HOT_WINDOW_CARD = 7 * 86400;

function NFTCollectionCard({ col }: { col: CollectionWithFloor }) {
  const isHot = col.bondingTimestamp > 0 && Math.floor(Date.now() / 1000) - col.bondingTimestamp < HOT_WINDOW_CARD;
  const client = usePublicClient();
  const [floorTokenId, setFloorTokenId] = useState<number | null>(null);

  const findFloor = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!client || !col.floorPrice) return;
    try {
      const prices = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          client.readContract({ address: col.address as `0x${string}`, abi: NFT_ABI, functionName: "tokenListPrice", args: [BigInt(i + 1)] })
            .then(p => ({ tokenId: i + 1, price: p as bigint }))
            .catch(() => ({ tokenId: i + 1, price: BigInt(0) }))
        )
      );
      const listed = prices.filter(p => p.price > BigInt(0));
      if (listed.length > 0) {
        const floor = listed.reduce((min, p) => p.price < min.price ? p : min);
        setFloorTokenId(floor.tokenId);
        window.location.href = `/nft/${col.address}/${floor.tokenId}`;
      }
    } catch {}
  };

  return (
    <Link href={`/collection/${col.address}`}>
      <div className="card hover:shadow-card-hover transition-all cursor-pointer group p-0 overflow-hidden">
        <div className="aspect-[4/3] bg-muted overflow-hidden relative">
          {col.coverPhoto ? (
            <IpfsImage uri={col.coverPhoto} alt={col.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-text-dim text-3xl">?</span>
            </div>
          )}
          {isHot && (
            <span className="absolute top-2 left-2 px-2 py-0.5 text-[10px] font-bold bg-orange-500 text-white rounded-md">
              HOT
            </span>
          )}
        </div>
        <div className="p-3">
          <div className="flex items-start justify-between gap-1 mb-1">
            <p className="font-semibold text-sm text-text-primary truncate">{col.name}</p>
            <div className="flex items-center gap-1.5 shrink-0">
              {isHot && <span className="text-[9px] font-bold text-orange-500">HOT</span>}
              <span className="text-xs text-accent font-mono">${col.ticker}</span>
            </div>
          </div>
          <p className="text-xs text-text-secondary">Sold out</p>

          {/* Floor price + volume */}
          <div className="grid grid-cols-2 gap-1 mt-2 pt-2 border-t border-border">
            <div>
              <p className="text-[10px] font-semibold text-text-dim uppercase tracking-wide">FLOOR</p>
              <p className="text-sm font-bold text-accent">
                {col.floorPrice ? `${parseFloat(formatEther(col.floorPrice)).toFixed(3)} ETH` : "-"}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-text-dim uppercase tracking-wide">VOLUME</p>
              <p className="text-sm font-semibold text-text-primary">
                {col.volume > BigInt(0) ? `${parseFloat(formatEther(col.volume)).toFixed(3)} ETH` : "-"}
              </p>
            </div>
          </div>

          {/* Buy floor button */}
          {col.floorPrice && (
            <button onClick={findFloor} className="btn-primary btn-sm btn-block mt-2">
              BUY FLOOR {parseFloat(formatEther(col.floorPrice)).toFixed(3)} ETH
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}
