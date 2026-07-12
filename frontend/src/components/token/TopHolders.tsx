"use client";

// Top token holders. ERC20 has no on chain holder list, so we collect candidate
// addresses from Transfer events, then read their live balanceOf (accurate) and
// rank them. System addresses (the V4 pool, the airdrop vault, zero) are excluded
// so the list shows real holders.
import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { usePublicClient } from "wagmi";
import { CONTRACTS } from "@/lib/contracts";
import { explorerAddress } from "@/lib/chain";
import { CopyAddress } from "@/components/ui/CopyAddress";

const ERC20_MIN = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function TopHolders({ token }: { token: `0x${string}` }) {
  const client = usePublicClient();
  const [holders, setHolders] = useState<{ addr: string; pct: number; amount: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client) return;
    let on = true;
    (async () => {
      setLoading(true);
      try {
        const exclude = new Set<string>([
          "0x0000000000000000000000000000000000000000",
          CONTRACTS.poolManager.toLowerCase(),
          CONTRACTS.vault.toLowerCase(),
          token.toLowerCase(),
        ]);
        // Collect candidate holder addresses from Transfer logs.
        const latest = await client.getBlockNumber();
        const step = BigInt(4500);
        let end = latest;
        const cands = new Set<string>();
        for (let i = 0; i < 10 && cands.size < 120; i++) {
          const start = end > step ? end - step : BigInt(0);
          const logs = await client.getLogs({
            address: token, fromBlock: start, toBlock: end,
            event: { type: "event", name: "Transfer", inputs: [
              { name: "from", type: "address", indexed: true },
              { name: "to", type: "address", indexed: true },
              { name: "value", type: "uint256", indexed: false },
            ] },
          }).catch(() => []);
          for (const l of logs) {
            const to = (l as any).args.to as string;
            if (to) cands.add(to.toLowerCase());
          }
          if (start === BigInt(0)) break;
          end = start - BigInt(1);
        }
        const list = [...cands].filter((a) => !exclude.has(a)).slice(0, 80);
        const supplyRaw = await client.readContract({ address: token, abi: ERC20_MIN, functionName: "totalSupply" }).catch(() => BigInt(0));
        const supply = Number(formatEther(supplyRaw as bigint)) || 1;
        const bals = await Promise.all(list.map(async (a) => {
          const b = await client.readContract({ address: token, abi: ERC20_MIN, functionName: "balanceOf", args: [a as `0x${string}`] }).catch(() => BigInt(0));
          return { addr: a, amount: Number(formatEther(b as bigint)) };
        }));
        const ranked = bals
          .filter((h) => h.amount > 0)
          .sort((a, b) => b.amount - a.amount)
          .slice(0, 8)
          .map((h) => ({ ...h, pct: (h.amount / supply) * 100 }));
        if (on) setHolders(ranked);
      } catch { if (on) setHolders([]); }
      finally { if (on) setLoading(false); }
    })();
    return () => { on = false; };
  }, [client, token]);

  return (
    <div className="card p-5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-3">Top holders</p>
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-7 animate-pulse rounded bg-ink/5" />)}</div>
      ) : holders.length === 0 ? (
        <p className="py-6 text-center text-xs text-text-dim">No holders yet.</p>
      ) : (
        <div className="divide-y divide-line">
          {holders.map((h, i) => (
            <div key={h.addr} className="flex items-center gap-3 py-1.5 transition-colors hover:bg-mint/60">
              <span className="w-4 font-mono text-[11px] tabular-nums text-text-dim">{i + 1}</span>
              {/* Address copies on click; a distinct icon opens the explorer. */}
              <CopyAddress address={h.addr} display={short(h.addr)} title="Copy holder address" className="flex-1 text-xs text-text-secondary" />
              <a href={explorerAddress(h.addr)} target="_blank" rel="noreferrer" aria-label="View on explorer"
                className="flex-shrink-0 text-text-dim transition-colors hover:text-accent">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
              </a>
              <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink/5">
                <div className="grad h-full rounded-full" style={{ width: `${Math.min(100, h.pct)}%` }} />
              </div>
              <span className="w-12 text-right font-mono text-xs tabular-nums text-ink">{h.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
