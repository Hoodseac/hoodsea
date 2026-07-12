"use client";

import { useEffect, useMemo, useState } from "react";
import { parseEther, formatEther } from "viem";
import { useAccount, useBalance, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { useAuth } from "@/lib/useAuth";
import toast from "react-hot-toast";
import { CONTRACTS, SWAP_ROUTER_ABI, STATE_VIEW_ABI, ERC20_ABI, FEE_HOOK_ABI, poolKeyFor, poolIdFor } from "@/lib/contracts";
import { friendlyTxError } from "@/lib/tx-errors";

const SLIPPAGE_OPTIONS = [1, 3, 5, 10];
const QUICK_ETH = ["0.001", "0.01", "0.05", "0.1"];
const QUICK_PCT = [25, 50, 75, 100];

export function SwapBox({ token, symbol }: { token: `0x${string}`; symbol: string }) {
  const { address } = useAccount();
  const { login } = useAuth();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(5);

  const key = useMemo(() => poolKeyFor(token), [token]);
  const poolId = useMemo(() => poolIdFor(token), [token]);

  const { data: ethBal } = useBalance({ address });
  const { data: tokenBalRaw } = useReadContract({
    address: token, abi: ERC20_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: { enabled: !!address },
  });
  const { data: slot0 } = useReadContract({
    address: CONTRACTS.stateView, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [poolId],
    query: { refetchInterval: 15000 },
  });
  const { data: feeBpsRaw } = useReadContract({
    address: CONTRACTS.feeHook, abi: FEE_HOOK_ABI, functionName: "poolFeeBps", args: [poolId],
  });
  const { data: allowance } = useReadContract({
    address: token, abi: ERC20_ABI, functionName: "allowance",
    args: address ? [address, CONTRACTS.swapRouter] : undefined, query: { enabled: !!address && side === "sell" },
  });

  const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient();

  // price = token per ETH, from sqrtPriceX96 (both 18 decimals)
  const price = useMemo(() => {
    const sp = (slot0 as any)?.[0] as bigint | undefined;
    if (!sp || sp === 0n) return 0;
    const r = Number(sp) / 2 ** 96;
    return r * r;
  }, [slot0]);

  const tokenBal = tokenBalRaw ? Number(formatEther(tokenBalRaw as bigint)) : 0;
  const amtNum = parseFloat(amount) || 0;

  // hook fee in bps (default 1.5% until loaded)
  const feeBps = feeBpsRaw && (feeBpsRaw as bigint) > 0n ? Number(feeBpsRaw as bigint) : 150;
  const keepRatio = 1 - feeBps / 10000;

  // Spot estimate (ignores price impact) used as a fallback before/if the live
  // simulation is unavailable.
  const spotOut = useMemo(() => {
    if (!price || !amtNum) return 0;
    return side === "buy" ? amtNum * price * keepRatio : (amtNum / price) * keepRatio;
  }, [price, amtNum, side, keepRatio]);

  // Live simulated output (accounts for price impact + hook fee). Null until a
  // quote resolves or if the simulation fails (e.g. sell before approval).
  const [liveOut, setLiveOut] = useState<bigint | null>(null);

  // Raw simulated output of swapExactIn with no min, the real amount out.
  async function quoteRaw(zeroForOne: boolean, amountIn: bigint, value: bigint): Promise<bigint | null> {
    if (!publicClient || !address) return null;
    try {
      const { result } = await publicClient.simulateContract({
        address: CONTRACTS.swapRouter, abi: SWAP_ROUTER_ABI, functionName: "swapExactIn",
        args: [key, zeroForOne, amountIn, 0n, address], value, account: address,
      });
      return result as bigint;
    } catch {
      return null; // simulation unavailable; caller falls back
    }
  }

  // Apply slippage to a raw output to get the on-chain minOut.
  function applySlippage(out: bigint): bigint {
    return (out * BigInt(10000 - Math.round(slippage * 100))) / 10000n;
  }

  async function quoteMinOut(zeroForOne: boolean, amountIn: bigint, value: bigint): Promise<bigint> {
    const out = await quoteRaw(zeroForOne, amountIn, value);
    return out === null ? 0n : applySlippage(out);
  }

  // Keep the displayed estimate in sync with a live simulation (debounced).
  useEffect(() => {
    if (!amtNum || !price || !publicClient || !address) { setLiveOut(null); return; }
    let active = true;
    const t = setTimeout(async () => {
      let amountIn: bigint;
      try { amountIn = parseEther(amount); } catch { if (active) setLiveOut(null); return; }
      const out = await quoteRaw(side === "buy", amountIn, side === "buy" ? amountIn : 0n);
      if (active) setLiveOut(out);
    }, 350);
    return () => { active = false; clearTimeout(t); };
  }, [amount, side, price, address, publicClient]);

  // Prefer the live simulation; fall back to the spot estimate.
  const estOut = liveOut !== null ? Number(formatEther(liveOut)) : spotOut;

  async function handleSwap() {
    if (!address) return toast.error("Connect wallet");
    if (!amtNum) return toast.error("Enter an amount");
    if (!price) return toast.error("Pool not ready");

    try {
      if (side === "buy") {
        const amountIn = parseEther(amount);
        if (ethBal && amountIn > ethBal.value) return toast.error("Not enough ETH");
        const minOutWei = await quoteMinOut(true, amountIn, amountIn);
        await writeContractAsync({
          address: CONTRACTS.swapRouter, abi: SWAP_ROUTER_ABI, functionName: "swapExactIn",
          args: [key, true, amountIn, minOutWei, address], value: amountIn,
        });
        toast.success(`Bought ${symbol}`);
      } else {
        const amountIn = parseEther(amount);
        if (tokenBalRaw && amountIn > (tokenBalRaw as bigint)) return toast.error(`Not enough ${symbol}`);
        // approve if needed: wait for the approval to mine before swapping,
        // otherwise the swap tx races ahead of a stale allowance and reverts.
        if (!allowance || (allowance as bigint) < amountIn) {
          toast.loading("Approving...", { id: "appr" });
          const approveHash = await writeContractAsync({
            address: token, abi: ERC20_ABI, functionName: "approve",
            args: [CONTRACTS.swapRouter, amountIn],
          });
          if (publicClient) await publicClient.waitForTransactionReceipt({ hash: approveHash });
          toast.dismiss("appr");
        }
        const minOutWei = await quoteMinOut(false, amountIn, 0n);
        await writeContractAsync({
          address: CONTRACTS.swapRouter, abi: SWAP_ROUTER_ABI, functionName: "swapExactIn",
          args: [key, false, amountIn, minOutWei, address],
        });
        toast.success(`Sold ${symbol}`);
      }
      setAmount("");
    } catch (e: any) {
      toast.dismiss("appr");
      toast.error(friendlyTxError(e, "Swap failed"));
    }
  }

  const inLabel = side === "buy" ? "ETH" : symbol;
  const outLabel = side === "buy" ? symbol : "ETH";
  const inBal = side === "buy" ? (ethBal ? Number(formatEther(ethBal.value)) : 0) : tokenBal;

  const setQuickEth = (v: string) => setAmount(v);
  const setQuickPct = (pct: number) => {
    if (tokenBal <= 0) return;
    const v = pct === 100 ? tokenBal : (tokenBal * pct) / 100;
    setAmount(v.toString());
  };

  return (
    <div className="card p-5">
      {/* Buy/Sell pill toggle */}
      <div className="grid grid-cols-2 gap-1 rounded-full border border-line bg-paper p-1 mb-4">
        {(["buy", "sell"] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setSide(s); setAmount(""); }}
            className={`rounded-full py-1.5 text-sm font-semibold transition-colors ${
              side === s
                ? s === "buy"
                  ? "bg-sea text-ink"
                  : "bg-[#FF494A] text-white"
                : "text-text-secondary hover:text-ink"
            }`}
          >
            {s === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
            You pay ({inLabel})
          </span>
          <button
            onClick={() => setAmount(inBal > 0 ? (side === "buy" ? Math.max(inBal - 0.0005, 0) : inBal).toString() : "")}
            className="text-xs tabular-nums text-text-secondary hover:text-ink"
          >
            Balance: {inBal.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </button>
        </div>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.0"
          className="input-base text-lg font-mono tabular-nums"
        />
        {/* Quick amount chips */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {side === "buy"
            ? QUICK_ETH.map((v) => (
                <button
                  key={v}
                  onClick={() => setQuickEth(v)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    amount === v ? "border-ink bg-ink text-white" : "border-line bg-white/70 text-text-secondary hover:text-ink"
                  }`}
                >
                  {v} ETH
                </button>
              ))
            : QUICK_PCT.map((p) => (
                <button
                  key={p}
                  onClick={() => setQuickPct(p)}
                  className="rounded-full border border-line bg-white/70 px-2.5 py-1 text-[11px] font-semibold text-text-secondary transition-colors hover:text-ink"
                >
                  {p === 100 ? "Max" : `${p}%`}
                </button>
              ))}
        </div>
      </div>

      {/* Output estimate: plain and clear */}
      <div className="mb-3 flex items-center justify-between border-t border-line pt-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">You receive (est)</span>
        <span className="font-mono text-sm tabular-nums text-ink">
          {estOut.toLocaleString(undefined, { maximumFractionDigits: outLabel === "ETH" ? 6 : 2 })} {outLabel}
        </span>
      </div>

      {/* Slippage: preset chips + mini input */}
      <div className="mb-4 flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mr-1">Slippage</span>
        {SLIPPAGE_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setSlippage(s)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums transition-colors ${
              slippage === s ? "border border-ink bg-ink text-white" : "border border-line bg-white/70 text-text-secondary hover:text-ink"
            }`}
          >
            {s}%
          </button>
        ))}
        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-line bg-white/70 px-2 py-1">
          <input
            type="number"
            min={0.1}
            max={50}
            step={0.5}
            value={slippage}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v > 0 && v <= 50) setSlippage(v);
            }}
            className="w-9 bg-transparent text-right text-[11px] font-semibold tabular-nums text-ink outline-none"
          />
          <span className="text-[11px] text-text-secondary">%</span>
        </span>
      </div>

      <button
        onClick={() => (!address ? login() : handleSwap())}
        disabled={isPending || (!!address && !amtNum)}
        className={`w-full rounded-full py-2.5 text-sm font-semibold border transition-colors disabled:opacity-50 disabled:pointer-events-none ${
          side === "buy"
            ? "bg-sea text-ink border-ink/10 hover:bg-sea-bright"
            : "bg-[#FF494A] text-white border-ink/10 hover:bg-[#e93c3d]"
        }`}
      >
        {isPending ? "Confirming..." : !address ? "Connect wallet" : side === "buy" ? `Buy ${symbol}` : `Sell ${symbol}`}
      </button>

      <p className="mt-2 text-center text-[10px] text-text-secondary">
        Liquidity locked. Powered by Uniswap V4 on Robinhood Chain.
      </p>
    </div>
  );
}
