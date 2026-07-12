"use client";

import { useState, useEffect } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { useAuth } from "@/lib/useAuth";
import { formatEther, erc20Abi } from "viem";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useCreatorCollections, useRecentCollections } from "@/hooks/useCollections";
import { NFT_ABI } from "@/lib/contracts";
import { IpfsImage } from "@/components/ui/IpfsImage";
import { CopyAddress } from "@/components/ui/CopyAddress";
import { useRevealedCover } from "@/lib/reveal";

type Tab = "nfts" | "collections" | "tokens" | "activity";

export default function PortfolioPage() {
  const { isConnected: authenticated, address } = useAccount();
  const { login } = useAuth();
  const [tab, setTab] = useState<Tab>("nfts");
  const { addresses: creatorAddresses } = useCreatorCollections(address);

  // Portfolio stats (NFTs owned, tokens held, collections you hold NFTs in)
  const { collections: allCollections } = useRecentCollections();
  const statsClient = usePublicClient();
  const [stats, setStats] = useState({ nfts: 0, tokens: 0, activity: 0 });
  const [ethBal, setEthBal] = useState<number | null>(null);
  const [earnedEth, setEarnedEth] = useState<number | null>(null);
  const [ethPrice, setEthPrice] = useState(0);

  // Reward/value row: wallet value + total creator fee earnings (ETH + USD).
  useEffect(() => {
    if (!address) return;
    const api = process.env.NEXT_PUBLIC_PROFILE_API || "";
    if (statsClient) statsClient.getBalance({ address: address as `0x${string}` }).then((b) => setEthBal(Number(b) / 1e18)).catch(() => {});
    fetch(`${api}/api/earnings/${address}`).then((r) => r.json()).then((d) => { if (d?.earnedWei != null) setEarnedEth(Number(d.earnedWei) / 1e18); }).catch(() => {});
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd").then((r) => r.json()).then((d) => { if (d?.ethereum?.usd) setEthPrice(d.ethereum.usd); }).catch(() => {});
  }, [address, statsClient]);
  const usd = (eth: number | null) => (eth != null && ethPrice > 0 ? `$${(eth * ethPrice).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "");
  useEffect(() => {
    if (!address || !statsClient || !allCollections?.length) return;
    let cancelled = false;
    (async () => {
      let nfts = 0, tokens = 0, activity = 0;
      await Promise.allSettled(allCollections.map(async (col: any) => {
        try {
          const bal = Number(await statsClient.readContract({
            address: col.address as `0x${string}`, abi: NFT_ABI,
            functionName: "balanceOf", args: [address as `0x${string}`],
          }));
          if (bal > 0) { nfts += bal; activity += 1; }
          if (col.tokenAddress) {
            const tb = await statsClient.readContract({
              address: col.tokenAddress as `0x${string}`, abi: NFT_ABI,
              functionName: "balanceOf", args: [address as `0x${string}`],
            }).catch(() => BigInt(0));
            if (Number(tb) > 0) tokens += 1;
          }
        } catch {}
      }));
      if (!cancelled) setStats({ nfts, tokens, activity });
    })();
    return () => { cancelled = true; };
  }, [address, statsClient, allCollections]);

  if (!authenticated) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center gap-6">
        <p className="text-3xl font-bold text-text-primary">Connect your wallet</p>
        <p className="text-text-secondary text-sm">View your NFTs, collections, and tokens</p>
        <button onClick={login} className="btn-primary">Connect Wallet</button>
      </div>
    );
  }

  const shortAddr = address ? `${address.slice(0, 8)}…${address.slice(-6)}` : "";

  return (
    <div className="max-w-7xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center justify-center rounded-2xl bg-ink shrink-0" style={{ width: 48, height: 48 }} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/hoodsea-logo.png" alt="" style={{ width: 30 }} />
          </span>
          <div>
            <p className="text-xs font-semibold text-accent uppercase tracking-[0.16em] mb-1">Your deep</p>
            {address && (
              <CopyAddress
                address={address}
                display={shortAddr}
                iconSize={16}
                title="Copy wallet address"
                className="text-2xl font-bold text-ink"
              />
            )}
          </div>
        </div>
        <Link href="/launch" className="btn-primary self-start sm:self-auto rounded-full">
          Launch a collection
        </Link>
      </div>

      {/* Reward / value row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <div className="card rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold text-text-dim uppercase tracking-wide">Wallet value</p>
            <p className="font-mono text-lg font-bold text-text-primary">{ethBal != null ? ethBal.toFixed(4) : "…"} ETH</p>
          </div>
          {ethBal != null && ethPrice > 0 && <p className="font-mono text-sm text-text-secondary">{usd(ethBal)}</p>}
        </div>
        <div className="card rounded-xl p-4 flex items-center justify-between border-brand/25 bg-mint/50">
          <div>
            <p className="text-[10px] font-semibold text-text-dim uppercase tracking-wide">Total earned (fees)</p>
            <p className="font-mono text-lg font-bold text-accent">{earnedEth != null ? earnedEth.toFixed(4) : "…"} ETH</p>
          </div>
          {earnedEth != null && earnedEth > 0 && ethPrice > 0 && <p className="font-mono text-sm text-text-secondary">{usd(earnedEth)}</p>}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3 mb-8">
        {[
          { label: "NFTs", value: stats.nfts },
          { label: "Creator", value: creatorAddresses.length },
          { label: "Tokens", value: stats.tokens },
          { label: "Activity", value: stats.activity },
        ].map((s) => (
          <div key={s.label} className="card rounded-xl py-3 px-2 text-center">
            <p className="text-xl sm:text-2xl font-bold text-text-primary font-mono">{s.value}</p>
            <p className="text-[10px] sm:text-xs text-text-secondary uppercase tracking-wide mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center gap-1 rounded-full border border-line bg-white/70 p-1 max-w-full overflow-x-auto shadow-[0_1px_2px_rgba(5,6,0,0.04)]">
          {(["nfts", "collections", "tokens", "activity"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 sm:px-5 py-2 text-sm font-semibold whitespace-nowrap transition-all ${
                tab === t
                  ? "bg-sea text-ink shadow-[0_6px_16px_-8px_rgba(206,246,6,0.9)]"
                  : "text-text-secondary hover:text-ink"
              }`}
            >
              {({ nfts: "NFTs", collections: "Creator", tokens: "Tokens", activity: "Activity" } as Record<Tab, string>)[t]}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {tab === "nfts" && <UserNFTsTab address={address!} />}
          {tab === "collections" && (
            creatorAddresses.length === 0 ? (
              <EmptyState
                text="No collections yet"
                sub="Launch your first NFT collection"
                cta={{ label: "Launch Now", href: "/launch" }}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {creatorAddresses.map((addr) => (
                  <CollectionCardByAddress key={addr} address={addr} />
                ))}
              </div>
            )
          )}
          {tab === "tokens" && <UserTokensTab />}
          {tab === "activity" && <UserActivityTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ─── Shared Empty State ───────────────────────────────────────────────────────

function EmptyState({
  text,
  sub,
  cta,
}: {
  text: string;
  sub: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div className="card text-center py-16">
      <div className="relative mx-auto mb-5 w-24 h-24 rounded-3xl bg-ink flex items-center justify-center shadow-[0_16px_36px_-16px_rgba(0,200,5,0.45)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/hoodsea-logo.png"
          alt=""
          loading="lazy"
          decoding="async"
          className="w-3/5 h-3/5 object-contain"
        />
      </div>
      <p className="text-xl font-semibold text-text-primary mb-2">{text}</p>
      <p className="text-sm text-text-secondary mb-6">{sub}</p>
      {cta && (
        <Link href={cta.href} className="btn-primary">
          {cta.label}
        </Link>
      )}
    </div>
  );
}

// ─── Collection Card with real data ──────────────────────────────────────────

function CollectionCardByAddress({ address }: { address: string }) {
  const client = usePublicClient();
  const [info, setInfo] = useState<any>(null);

  useEffect(() => {
    if (!client) return;
    client
      .readContract({
        address: address as `0x${string}`,
        abi: NFT_ABI,
        functionName: "getCollectionInfo",
      })
      .then(setInfo)
      .catch(() => {});
  }, [address, client]);

  // Reveal-aware cover: mystery photo until 24h/7d reveal passes.
  const cover = useRevealedCover(address, Boolean(info?.bondingComplete), info?.photoURIs?.[0] || "");

  return (
    <Link href={`/collection/${address}`}>
      <div className="card hover:shadow-card-hover transition-all cursor-pointer group p-0 overflow-hidden">
        <div className="aspect-[4/3] bg-muted overflow-hidden">
          {cover ? (
            <IpfsImage
              uri={cover}
              alt={info?.name || "Collection"}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-text-dim text-3xl">?</span>
            </div>
          )}
        </div>
        <div className="p-4">
          <p className="font-semibold text-text-primary truncate">
            {info?.name || "Loading..."}
          </p>
          {info?.ticker && (
            <p className="text-sm text-text-secondary">${info.ticker}</p>
          )}
          <div className="mt-1">
            <CopyAddress address={address} title="Copy collection address" className="text-xs text-text-dim" />
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── NFTs Tab, checks balanceOf on all collections ──────────────────────────

function UserNFTsTab({ address }: { address: string }) {
  const { collections, isLoading } = useRecentCollections();
  const client = usePublicClient();
  const [owned, setOwned] = useState<
    { collAddr: string; name: string; balance: number; photo: string }[]
  >([]);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!collections.length || !client) return;
    const check = async () => {
      setChecking(true);
      const results: { collAddr: string; name: string; balance: number; photo: string }[] = [];
      await Promise.allSettled(
        collections.map(async (col) => {
          try {
            const bal = await client.readContract({
              address: col.address as `0x${string}`,
              abi: NFT_ABI,
              functionName: "balanceOf",
              args: [address as `0x${string}`],
            });
            if (Number(bal) > 0) {
              results.push({
                collAddr: col.address,
                name: col.name,
                balance: Number(bal),
                photo: col.coverPhoto,
              });
            }
          } catch {}
        })
      );
      setOwned(results);
      setChecking(false);
    };
    check();
  }, [collections, client, address]);

  if (isLoading || checking) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card animate-pulse h-52" />
        ))}
      </div>
    );
  }

  if (!owned.length) {
    return (
      <EmptyState
        text="No NFTs yet"
        sub="Mint from an active collection to see your NFTs here"
        cta={{ label: "Explore Collections", href: "/explore" }}
      />
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {owned.map((item) => (
        <Link key={item.collAddr} href={`/collection/${item.collAddr}`}>
          <div className="card hover:shadow-card-hover transition-all cursor-pointer group p-0 overflow-hidden">
            <div className="aspect-square bg-muted overflow-hidden">
              {item.photo ? (
                <IpfsImage
                  uri={item.photo}
                  alt={item.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-text-dim text-2xl">?</span>
                </div>
              )}
            </div>
            <div className="p-3">
              <p className="font-semibold text-sm text-text-primary truncate">{item.name}</p>
              <p className="text-xs text-text-secondary">
                {item.balance} NFT{item.balance > 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ─── Tokens Tab ───────────────────────────────────────────────────────────────

function UserTokensTab() {
  const { address } = useAccount();
  const { collections, isLoading } = useRecentCollections();
  const client = usePublicClient();
  const [held, setHeld] = useState<{ token: string; name: string; symbol: string; balance: bigint }[]>([]);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!collections.length || !client || !address) { setChecking(false); return; }
    let cancelled = false;
    (async () => {
      setChecking(true);
      const results: { token: string; name: string; symbol: string; balance: bigint }[] = [];
      await Promise.allSettled(collections.map(async (col: any) => {
        if (!col.tokenAddress) return;
        try {
          const bal = (await client.readContract({
            address: col.tokenAddress as `0x${string}`, abi: erc20Abi,
            functionName: "balanceOf", args: [address as `0x${string}`],
          })) as bigint;
          if (bal > BigInt(0)) {
            let sym = col.ticker || "";
            try { sym = (await client.readContract({ address: col.tokenAddress as `0x${string}`, abi: erc20Abi, functionName: "symbol" })) as string; } catch {}
            results.push({ token: col.tokenAddress, name: col.name || "", symbol: sym, balance: bal });
          }
        } catch {}
      }));
      if (!cancelled) { setHeld(results); setChecking(false); }
    })();
    return () => { cancelled = true; };
  }, [collections, client, address]);

  if (isLoading || checking) {
    return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{[1, 2, 3].map((i) => <div key={i} className="card animate-pulse h-16" />)}</div>;
  }
  if (!held.length) {
    return <EmptyState text="No tokens yet" sub="Tokens you hold appear here after a collection sells out and bonds" />;
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {held.map((t) => (
        <Link key={t.token} href={`/token/${t.token}`} className="card p-4 flex items-center justify-between hover:border-line-strong transition-colors">
          <div className="min-w-0">
            <p className="font-bold text-ink truncate">{t.name} <span className="text-xs font-semibold text-text-secondary">${t.symbol}</span></p>
            <p className="text-xs text-text-secondary mt-0.5">Held balance</p>
          </div>
          <p className="font-mono font-bold text-ink tabular-nums shrink-0">{Number(formatEther(t.balance)).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
        </Link>
      ))}
    </div>
  );
}

// ─── Activity Tab ─────────────────────────────────────────────────────────────

const RARITY_NAMES = ["Common","Uncommon","Rare","Epic","Legendary","Mythic"];
const RARITY_COLORS = ["#6b7280","#22c55e","#3b82f6","#a855f7","#f59e0b","#ec4899"];

type ActivityEvent = {
  type: "mint" | "buy" | "sell" | "list";
  collection: string;
  ticker: string;
  collectionAddr: string;
  tokenId: number;
  rarity?: number;
  price?: bigint;
  blockNumber: number;
  coverPhoto: string;
};

function UserActivityTab() {
  const { address } = useAccount();
  const client = usePublicClient();
  const { collections } = useRecentCollections();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "mint" | "buy" | "sell" | "list">("all");

  useEffect(() => {
    if (!client || !collections.length || !address) return;
    setLoading(true);
    const fetch_ = async () => {
      const all: ActivityEvent[] = [];
      const blockNumber = await client.getBlockNumber();
      const fromBlock = BigInt(Math.max(0, Number(blockNumber) - 45000));

      await Promise.allSettled(
        collections.map(async (col) => {
          const addr = col.address as `0x${string}`;
          const userAddr = address as `0x${string}`;
          try {
            // Mints
            const mintLogs = await client.getLogs({
              address: addr,
              event: { type: "event", name: "NFTMinted", inputs: [{ name: "minter", type: "address", indexed: true }, { name: "tokenId", type: "uint256", indexed: false }, { name: "rarity", type: "uint8", indexed: false }, { name: "price", type: "uint256", indexed: false }] },
              args: { minter: userAddr },
              fromBlock,
            }).catch(() => []);
            for (const log of mintLogs) {
              all.push({ type: "mint", collection: col.name, ticker: col.ticker, collectionAddr: col.address, tokenId: Number((log as any).args.tokenId), rarity: Number((log as any).args.rarity), price: (log as any).args.price as bigint, blockNumber: Number(log.blockNumber), coverPhoto: col.coverPhoto });
            }

            // Buys (user = to)
            const buyLogs = await client.getLogs({
              address: addr,
              event: { type: "event", name: "NFTSold", inputs: [{ name: "tokenId", type: "uint256", indexed: true }, { name: "price", type: "uint256", indexed: false }, { name: "from", type: "address", indexed: false }, { name: "to", type: "address", indexed: false }] },
              fromBlock,
            }).catch(() => []);
            for (const log of buyLogs) {
              const { tokenId, price, from, to } = (log as any).args;
              if ((to as string).toLowerCase() === address.toLowerCase()) {
                all.push({ type: "buy", collection: col.name, ticker: col.ticker, collectionAddr: col.address, tokenId: Number(tokenId), price: price as bigint, blockNumber: Number(log.blockNumber), coverPhoto: col.coverPhoto });
              }
              if ((from as string).toLowerCase() === address.toLowerCase()) {
                all.push({ type: "sell", collection: col.name, ticker: col.ticker, collectionAddr: col.address, tokenId: Number(tokenId), price: price as bigint, blockNumber: Number(log.blockNumber), coverPhoto: col.coverPhoto });
              }
            }

            // Listings
            const listLogs = await client.getLogs({
              address: addr,
              event: { type: "event", name: "NFTListed", inputs: [{ name: "tokenId", type: "uint256", indexed: true }, { name: "price", type: "uint256", indexed: false }, { name: "expiry", type: "uint256", indexed: false }, { name: "seller", type: "address", indexed: false }] },
              fromBlock,
            }).catch(() => []);
            for (const log of listLogs) {
              const { tokenId, price, seller } = (log as any).args;
              if ((seller as string).toLowerCase() === address.toLowerCase()) {
                all.push({ type: "list", collection: col.name, ticker: col.ticker, collectionAddr: col.address, tokenId: Number(tokenId), price: price as bigint, blockNumber: Number(log.blockNumber), coverPhoto: col.coverPhoto });
              }
            }
          } catch {}
        })
      );

      all.sort((a, b) => b.blockNumber - a.blockNumber);
      setEvents(all);
      setLoading(false);
    };
    fetch_();
  }, [collections, address, client]);

  const TYPE_CONFIG = {
    mint:  { label: "MINT",  bg: "bg-blue-50",   text: "text-blue-600"  },
    buy:   { label: "BUY",   bg: "bg-mint",  text: "text-accent" },
    sell:  { label: "SELL",  bg: "bg-down/10",    text: "text-down"   },
    list:  { label: "LIST",  bg: "bg-amber/10",  text: "text-accent"     },
  };

  const filtered = filter === "all" ? events : events.filter(e => e.type === filter);

  if (loading) return (
    <div className="space-y-3">
      {[1,2,3].map(i => <div key={i} className="card animate-pulse h-16" />)}
    </div>
  );

  return (
    <div>
      {/* Filter chips */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(["all", "mint", "buy", "sell", "list"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 text-xs font-semibold border rounded-full transition-colors ${
              filter === f ? "border-ink bg-ink text-white" : "border-line bg-white/70 text-text-secondary hover:text-ink"
            }`}>
            {f.toUpperCase()} {f !== "all" && `(${events.filter(e => e.type === f).length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card text-center py-20">
          <p className="text-lg font-semibold text-text-primary mb-2">No activity yet</p>
          <p className="text-sm text-text-secondary">Your mints and trades will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((ev, i) => {
            const cfg = TYPE_CONFIG[ev.type];
            return (
              <Link key={i} href={`/nft/${ev.collectionAddr}/${ev.tokenId}`}>
                <div className="flex items-center gap-3 px-4 py-3 border border-border rounded-xl hover:border-amber/40 bg-surface transition-colors group cursor-pointer">
                  {ev.coverPhoto ? (
                    <IpfsImage uri={ev.coverPhoto} className="w-10 h-10 object-cover flex-shrink-0" alt={ev.collection} />
                  ) : (
                    <div className="w-10 h-10 bg-muted flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-text-primary group-hover:text-accent transition-colors truncate">
                      {ev.collection} #{ev.tokenId}
                    </p>
                    <p className="text-xs text-text-secondary">
                      ${ev.ticker}
                      {ev.price && ev.price > BigInt(0) ? ` · ${parseFloat(formatEther(ev.price)).toFixed(4)} ETH` : ""}
                      {" · "}Block #{ev.blockNumber.toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {ev.rarity !== undefined && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 border rounded-full hidden sm:inline"
                        style={{ color: RARITY_COLORS[ev.rarity], borderColor: RARITY_COLORS[ev.rarity] + "66", backgroundColor: RARITY_COLORS[ev.rarity] + "11" }}>
                        {RARITY_NAMES[ev.rarity]}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-md ${cfg.bg} ${cfg.text}`}>
                      {cfg.label}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

