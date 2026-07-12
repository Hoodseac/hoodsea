"use client";

// Native price chart built from on-chain Uniswap V4 swaps for this token's pool.
// External charts (DexScreener) don't index a freshly launched V4 pool for a
// while, so a new token showed an empty chart. This reads the PoolManager Swap
// events for the pool directly and plots price per trade, it works the moment
// the first swap lands, with no third-party indexer.
import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { usePublicClient, useReadContract } from "wagmi";
import { CONTRACTS, STATE_VIEW_ABI, poolIdFor } from "@/lib/contracts";

const TOTAL_SUPPLY_ABI = [
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

// Format an ETH amount as a plain decimal string, never scientific notation
// (a per-token price like 6.4e-9 ETH is unreadable; market cap in whole ETH is
// the friendly number, but small values still need clean formatting).
function fmtEth(n: number): string {
  if (!isFinite(n) || n === 0) return "0";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  // < 1: show up to 8 significant decimals without exponent, trim trailing zeros.
  const s = n.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

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

// currency0 = ETH, currency1 = token. (sqrtP/2^96)^2 = token per ETH.
// Chart shows the token's price in ETH = 1 / (token per ETH).
function ethPerToken(sqrtPriceX96: bigint): number {
  const r = Number(sqrtPriceX96) / 2 ** 96;
  const tokenPerEth = r * r;
  return tokenPerEth > 0 ? 1 / tokenPerEth : 0;
}

export function PriceChart({ token, symbol }: { token: `0x${string}`; symbol: string }) {
  const client = usePublicClient();
  const [points, setPoints] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const poolId = poolIdFor(token);

  // Total supply so we can show market cap (price × supply) in whole ETH instead
  // of an unreadable per-token price.
  const { data: totalSupplyRaw } = useReadContract({
    address: token, abi: TOTAL_SUPPLY_ABI, functionName: "totalSupply",
  });
  const supply = totalSupplyRaw ? Number(formatEther(totalSupplyRaw as bigint)) : 0;

  // Current spot price (also the chart's last point if there are no recent swaps).
  const { data: slot0 } = useReadContract({
    address: CONTRACTS.stateView, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [poolId],
    query: { refetchInterval: 20000 },
  });
  const spot = (() => {
    const sp = (slot0 as any)?.[0] as bigint | undefined;
    return sp && sp > 0n ? ethPerToken(sp) : 0;
  })();

  useEffect(() => {
    if (!client) return;
    let on = true;
    (async () => {
      setLoading(true);
      try {
        const latest = await client.getBlockNumber();
        // drpc free serves filtered getLogs reliably up to ~5k blocks; stay under
        // that. Walk back a bounded number of windows and stop once trades thin
        // out, so a low-volume token doesn't spend many calls on empty ranges.
        const step = BigInt(4500);
        const series: number[] = [];
        let end = latest;
        let emptyStreak = 0;
        for (let i = 0; i < 12; i++) {
          const start = end > step ? end - step : BigInt(0);
          const logs = await client.getLogs({
            address: CONTRACTS.poolManager,
            event: POOL_MANAGER_SWAP,
            args: { id: poolId },
            fromBlock: start,
            toBlock: end,
          }).catch(() => []);
          // logs are chronological within the window; prepend older windows.
          const prices = logs.map((l) => ethPerToken((l as any).args.sqrtPriceX96 as bigint)).filter((p) => p > 0);
          series.unshift(...prices);
          emptyStreak = prices.length ? 0 : emptyStreak + 1;
          if (start === BigInt(0)) break;
          if (series.length >= 150) break;
          if (series.length > 0 && emptyStreak >= 2) break; // history exhausted
          end = start - BigInt(1);
        }
        if (on) setPoints(series);
      } catch {
        if (on) setPoints([]);
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => { on = false; };
  }, [client, token]);

  // Append the live spot as the latest point so the chart always ends at "now",
  // then convert each price into a market cap in ETH (price × supply), a whole
  // ETH number instead of a tiny per-token price shown in scientific notation.
  const priceSeries = spot > 0 ? [...points, spot] : points;
  const data = supply > 0 ? priceSeries.map((p) => p * supply) : priceSeries;
  const unit = supply > 0 ? "ETH mcap" : "ETH";

  if (loading) {
    return <div className="h-[320px] flex items-center justify-center text-xs text-text-dim animate-pulse">Loading chart…</div>;
  }

  if (data.length < 2) {
    return (
      <div className="h-[320px] flex flex-col items-center justify-center gap-2 border border-border rounded-xl bg-surface">
        <p className="text-sm text-text-secondary">No trades yet</p>
        {data.length > 0 && (
          <p className="font-mono text-xs text-accent">{fmtEth(data[data.length - 1])} {unit}</p>
        )}
        <p className="text-[11px] text-text-dim">The chart fills in as soon as the first swap lands.</p>
      </div>
    );
  }

  // Build the SVG path.
  const W = 1000, H = 320, PAD = 8;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || max || 1;
  const x = (i: number) => PAD + (i / (data.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => PAD + (1 - (v - min) / range) * (H - 2 * PAD);
  const line = data.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(data.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
  const up = data[data.length - 1] >= data[0];
  const stroke = up ? "#22c55e" : "#ef4444";

  return (
    <div className="border border-border rounded-xl bg-surface p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-sm font-bold" style={{ color: stroke }}>
          {fmtEth(data[data.length - 1])} {unit}
        </span>
        <span className="text-[11px] text-text-dim">{points.length} trade{points.length === 1 ? "" : "s"}{supply > 0 ? " · market cap" : " · price in ETH"}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 300 }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="pcfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#pcfill)" />
        <path d={line} fill="none" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between text-[10px] text-text-dim mt-1 font-mono">
        <span>low {fmtEth(min)}</span>
        <span>high {fmtEth(max)}</span>
      </div>
    </div>
  );
}
