"use client";

// Live trade feed for a token, built from on chain Uniswap V4 swaps. Gives the
// token page real market activity instead of empty space. No third party indexer.
import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { usePublicClient } from "wagmi";
import { CONTRACTS, poolIdFor } from "@/lib/contracts";
import { explorerTx } from "@/lib/chain";
import { CopyAddress } from "@/components/ui/CopyAddress";

const POOL_MANAGER_SWAP = {
  type: "event",
  name: "Swap",
  inputs: [
    { name: "id", type: "bytes32", indexed: true },
    { name: "sender", type: "address", indexed: true },
    { name: "amount0", type: "int128", indexed: false },
    { name: "amount1", type: "int128", indexed: false },
    { name: "sqrtPriceX96", type: "uint160", indexed: false },
    { name: "liquidity", type: "uint128", indexed: false },
    { name: "tick", type: "int24", indexed: false },
    { name: "fee", type: "uint24", indexed: false },
  ],
} as const;

interface Trade {
  buy: boolean;        // true = ETH into pool (someone bought the token)
  eth: number;
  tokens: number;
  trader: string;
  ts: number;          // unix seconds
  tx: string;
}

function timeAgo(sec: number): string {
  const d = Math.floor(Date.now() / 1000) - sec;
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
function fmt(n: number): string {
  if (n === 0) return "0";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

export function RecentTrades({ token }: { token: `0x${string}` }) {
  const client = usePublicClient();
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const poolId = poolIdFor(token);

  useEffect(() => {
    if (!client) return;
    let on = true;
    (async () => {
      setLoading(true);
      try {
        const latest = await client.getBlockNumber();
        const step = BigInt(4500);
        let end = latest;
        const raw: any[] = [];
        for (let i = 0; i < 8 && raw.length < 25; i++) {
          const start = end > step ? end - step : BigInt(0);
          const logs = await client.getLogs({
            address: CONTRACTS.poolManager, event: POOL_MANAGER_SWAP,
            args: { id: poolId }, fromBlock: start, toBlock: end,
          }).catch(() => []);
          raw.unshift(...logs);
          if (start === BigInt(0)) break;
          end = start - BigInt(1);
        }
        const recent = raw.slice(-15).reverse(); // newest first, cap calls
        // Resolve block time + the real trader (tx sender, not the router).
        const blockTimes = new Map<string, number>();
        const out: Trade[] = [];
        for (const l of recent) {
          let a0 = BigInt((l as any).args.amount0);
          let a1 = BigInt((l as any).args.amount1);
          // V4 Swap amounts are from the swapper's perspective: buying the token
          // means the swapper PAYS ETH (amount0 negative). Sell = amount0 positive.
          const buy = a0 < BigInt(0);
          const ethAbs = a0 < BigInt(0) ? -a0 : a0;
          const tokAbs = a1 < BigInt(0) ? -a1 : a1;
          const bk = String(l.blockNumber);
          if (!blockTimes.has(bk)) {
            const blk = await client.getBlock({ blockNumber: l.blockNumber }).catch(() => null);
            blockTimes.set(bk, blk ? Number(blk.timestamp) : 0);
          }
          let trader = (l as any).args.sender as string;
          const tx = await client.getTransaction({ hash: l.transactionHash }).catch(() => null);
          if (tx?.from) trader = tx.from;
          out.push({
            buy, eth: Number(formatEther(ethAbs)), tokens: Number(formatEther(tokAbs)),
            trader, ts: blockTimes.get(bk) || 0, tx: l.transactionHash,
          });
        }
        if (on) setTrades(out);
      } catch { if (on) setTrades([]); }
      finally { if (on) setLoading(false); }
    })();
    return () => { on = false; };
  }, [client, token]);

  return (
    <div className="card p-5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-3">Recent trades</p>
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-7 animate-pulse rounded bg-ink/5" />)}</div>
      ) : trades.length === 0 ? (
        <p className="py-6 text-center text-xs text-text-dim">No trades yet. Be the first to buy.</p>
      ) : (
        <div className="overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-3 border-b border-line pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
            <span>Type</span><span>ETH</span><span className="text-right">Trader</span><span className="text-right">Time</span>
          </div>
          <div className="max-h-80 divide-y divide-line overflow-y-auto">
            {trades.map((t, i) => (
              <a key={i} href={explorerTx(t.tx)} target="_blank" rel="noreferrer"
                className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 py-1.5 text-xs transition-colors hover:bg-mint/60">
                <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: t.buy ? "#00C805" : "#FF494A" }}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.buy ? "#00C805" : "#FF494A" }} />
                  {t.buy ? "Buy" : "Sell"}
                </span>
                <span className="font-mono tabular-nums text-ink">{fmt(t.eth)}</span>
                {/* Row opens the tx; clicking the trader copies their address instead. */}
                <span className="flex justify-end">
                  <CopyAddress address={t.trader} display={short(t.trader)} title="Copy trader address" className="text-xs text-text-secondary" />
                </span>
                <span className="text-right font-mono tabular-nums text-text-dim">{timeAgo(t.ts)}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
