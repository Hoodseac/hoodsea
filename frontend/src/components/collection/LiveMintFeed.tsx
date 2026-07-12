"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePublicClient } from "wagmi";
import { motion, AnimatePresence } from "framer-motion";
import { fetchProfiles, shortAddr, type Identity } from "@/lib/profiles";
import { CopyAddress } from "@/components/ui/CopyAddress";

interface MintRow {
  key: string;
  minter: string;
  qty: number;
  block: number;
  ts: number;
}

function timeAgo(ts: number): string {
  if (!ts) return "";
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Live feed of recent minters for a collection. Polls NFTMinted events and
// groups them per transaction (a mint of qty N emits N events in one tx).
export function LiveMintFeed({ collectionAddress }: { collectionAddress: `0x${string}` }) {
  const client = usePublicClient();
  const [rows, setRows] = useState<MintRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Identity>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client) return;
    let active = true;

    const load = async () => {
      try {
        const current = await client.getBlockNumber();
        const fromBlock = BigInt(Math.max(0, Number(current) - 45000));
        const logs = await client.getLogs({
          address: collectionAddress,
          event: {
            type: "event",
            name: "NFTMinted",
            inputs: [
              { name: "minter", type: "address", indexed: true },
              { name: "tokenId", type: "uint256", indexed: false },
              { name: "rarity", type: "uint8", indexed: false },
              { name: "price", type: "uint256", indexed: false },
            ],
          },
          fromBlock,
        });

        // Group by transaction (one mint call = one row)
        const byTx = new Map<string, { minter: string; qty: number; block: number }>();
        for (const log of logs) {
          const tx = log.transactionHash || `${log.blockNumber}-${(log as any).args?.minter}`;
          const prev = byTx.get(tx) || { minter: (log as any).args.minter as string, qty: 0, block: Number(log.blockNumber) };
          byTx.set(tx, { ...prev, qty: prev.qty + 1 });
        }

        const grouped = Array.from(byTx.entries())
          .map(([key, v]) => ({ key, ...v, ts: 0 }))
          .sort((a, b) => b.block - a.block)
          .slice(0, 12);

        // Resolve block timestamps for the shown rows
        const blocks = Array.from(new Set(grouped.map((g) => g.block)));
        const tsMap = new Map<number, number>();
        await Promise.all(
          blocks.map(async (bn) => {
            try {
              const blk = await client.getBlock({ blockNumber: BigInt(bn) });
              tsMap.set(bn, Number(blk.timestamp));
            } catch {}
          })
        );
        for (const g of grouped) g.ts = tsMap.get(g.block) || 0;

        if (!active) return;
        setRows(grouped);
        fetchProfiles(grouped.map((g) => g.minter)).then((p) => active && setProfiles(p)).catch(() => {});
      } catch {}
      finally {
        if (active) setLoading(false);
      }
    };

    load();
    const iv = setInterval(load, 15000);
    return () => { active = false; clearInterval(iv); };
  }, [client, collectionAddress]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-surface border border-border rounded-lg animate-pulse" />)}
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="text-xs text-text-dim text-center py-6">No mints yet. Be the first.</p>;
  }

  return (
    <div className="space-y-1.5">
      <AnimatePresence initial={false}>
        {rows.map((r) => {
          const id = profiles[r.minter.toLowerCase()];
          const name = id?.username || shortAddr(r.minter);
          return (
            <motion.div
              key={r.key}
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 px-3 py-2 border border-border rounded-lg bg-surface"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse flex-shrink-0" />
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <Link href={`/u/${r.minter}`} className={`text-sm truncate hover:text-accent transition-colors ${id?.username ? "font-semibold text-text-primary" : "font-mono text-text-primary"}`}>{name}</Link>
                <CopyAddress address={r.minter} iconOnly iconSize={11} title="Copy minter address" className="flex-shrink-0" />
              </div>
              <span className="text-xs text-text-secondary flex-shrink-0">
                minted <span className="font-semibold text-accent">{r.qty}</span>
              </span>
              <span className="text-[10px] text-text-dim flex-shrink-0 w-16 text-right">{timeAgo(r.ts)}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
