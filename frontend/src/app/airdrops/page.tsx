"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { formatEther } from "viem";
import { CONTRACTS, VAULT_ABI, AIRDROP_DISTRIBUTOR_ABI } from "@/lib/contracts";
import {
  checkEligibility, fetchMyClaims, EPOCH_DAYS, formatEpochDate, epochCountdown,
  type EligibilityResult, type MyClaim,
} from "@/lib/airdrop";
import { friendlyTxError } from "@/lib/tx-errors";

const ERC20_MIN = [
  { name: "name", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "totalSupply", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

// NFT-only collections pay the 0.1% trade fee out as WETH (no token to buy back).
const WETH_ADDRESS = (process.env.NEXT_PUBLIC_WETH || "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73").toLowerCase();
const isWeth = (token: string) => token.toLowerCase() === WETH_ADDRESS;

interface TokenAirdrop {
  token: `0x${string}`;
  name: string;
  symbol: string;
  vaultBalance: bigint;
  epochAllocation: bigint; // 1% of supply
  epochTimes: bigint[];
  executed: bigint[];
  ready: boolean[];
  eligibility?: EligibilityResult;
}

function compactToken(wei: bigint): string {
  const n = Number(formatEther(wei));
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toFixed(2);
}

interface ClaimRow {
  token: `0x${string}`;
  symbol: string;
  cumulative: bigint;  // total entitled (merkle leaf)
  claimed: bigint;     // already pulled on-chain
  claimable: bigint;   // cumulative - claimed
  proof: `0x${string}`[];
}

function ClaimSection() {
  const client = usePublicClient();
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyEligible, setOnlyEligible] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client || !address) { setRows([]); return; }
    setLoading(true);
    try {
      const claims: MyClaim[] = await fetchMyClaims(address);
      const out: ClaimRow[] = [];
      for (const c of claims) {
        const token = c.token as `0x${string}`;
        const [claimed, symbol] = await Promise.all([
          client.readContract({ address: CONTRACTS.airdropDistributor, abi: AIRDROP_DISTRIBUTOR_ABI, functionName: "claimed", args: [token, address] }).catch(() => BigInt(0)),
          client.readContract({ address: token, abi: ERC20_MIN, functionName: "symbol" }).catch(() => "TKN"),
        ]);
        const cumulative = BigInt(c.amount);
        const claimedB = claimed as bigint;
        const claimable = cumulative > claimedB ? cumulative - claimedB : BigInt(0);
        out.push({ token, symbol: symbol as string, cumulative, claimed: claimedB, claimable, proof: c.proof });
      }
      out.sort((a, b) => (b.claimable > a.claimable ? 1 : -1));
      setRows(out);
    } finally {
      setLoading(false);
    }
  }, [client, address]);

  useEffect(() => { load(); }, [load]);

  const claimable = rows.filter((r) => r.claimable > BigInt(0));
  const shown = onlyEligible ? claimable : rows;
  const totalClaimableTokens = claimable.length;

  async function claimOne(r: ClaimRow) {
    setBusy(r.token); setMsg(null);
    try {
      await writeContractAsync({
        address: CONTRACTS.airdropDistributor, abi: AIRDROP_DISTRIBUTOR_ABI,
        functionName: "claim", args: [r.token, r.cumulative, r.proof],
      });
      setMsg(`Claimed ${r.symbol}. It may take a moment to reflect.`);
      setTimeout(load, 4000);
    } catch (e: any) {
      setMsg(friendlyTxError(e, "Claim failed"));
    } finally { setBusy(null); }
  }

  async function claimAll() {
    if (claimable.length === 0) return;
    setBusy("all"); setMsg(null);
    try {
      await writeContractAsync({
        address: CONTRACTS.airdropDistributor, abi: AIRDROP_DISTRIBUTOR_ABI,
        functionName: "claimMany",
        args: [claimable.map((r) => r.token), claimable.map((r) => r.cumulative), claimable.map((r) => r.proof)],
      });
      setMsg(`Claiming ${claimable.length} airdrops.`);
      setTimeout(load, 4000);
    } catch (e: any) {
      setMsg(friendlyTxError(e, "Claim all failed"));
    } finally { setBusy(null); }
  }

  if (!address) return null;
  if (!loading && rows.length === 0) return null;

  return (
    <div className="card mb-6 p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-bold text-ink">Your claimable airdrops</p>
          <p className="text-xs text-text-secondary mt-0.5">
            {totalClaimableTokens > 0
              ? `${totalClaimableTokens} token${totalClaimableTokens > 1 ? "s" : ""} ready to claim`
              : "Nothing to claim right now. Allocations never expire."}
          </p>
        </div>
        <button
          onClick={claimAll}
          disabled={busy !== null || claimable.length === 0}
          className="btn-primary shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold"
        >
          {busy === "all" ? "Claiming..." : "Claim all"}
        </button>
      </div>

      <label className="flex items-center gap-2 text-xs text-text-secondary mb-3 select-none cursor-pointer">
        <input type="checkbox" checked={onlyEligible} onChange={(e) => setOnlyEligible(e.target.checked)} className="accent-[#00C805]" />
        Show only eligible
      </label>

      {msg && <p className="text-xs text-accent mb-3">{msg}</p>}

      <div className="space-y-2">
        {shown.map((r) => (
          <div key={r.token} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-white/70 p-3 transition-colors hover:bg-mint/60">
            <div className="min-w-0">
              {isWeth(r.token) ? (
                <span className="text-sm font-semibold font-mono">Trade fees <span className="text-text-secondary">(WETH)</span></span>
              ) : (
                <Link href={`/token/${r.token}`} className="text-sm font-semibold font-mono hover:text-accent">${r.symbol}</Link>
              )}
              <p className="text-xs tabular-nums text-text-secondary mt-0.5">
                {isWeth(r.token)
                  ? `${Number(formatEther(r.claimable)).toLocaleString(undefined, { maximumFractionDigits: 6 })} WETH claimable`
                  : `${compactToken(r.claimable)} ${r.symbol} claimable`}
                {r.claimed > BigInt(0) && <span className="text-text-secondary"> · {isWeth(r.token) ? `${Number(formatEther(r.claimed)).toLocaleString(undefined, { maximumFractionDigits: 6 })} WETH` : `${compactToken(r.claimed)}`} already claimed</span>}
              </p>
            </div>
            <button
              onClick={() => claimOne(r)}
              disabled={busy !== null || r.claimable === BigInt(0)}
              className="btn-secondary shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold"
            >
              {busy === r.token ? "..." : r.claimable === BigInt(0) ? "Claimed" : "Claim"}
            </button>
          </div>
        ))}
        {shown.length === 0 && (
          <p className="text-xs text-text-secondary py-2">No claimable airdrops. Uncheck the filter to see past allocations.</p>
        )}
      </div>
    </div>
  );
}

export default function AirdropsPage() {
  const client = usePublicClient();
  const { address } = useAccount();
  const [items, setItems] = useState<TokenAirdrop[]>([]);
  const [loading, setLoading] = useState(true);

  // Community airdrop stats (daily worth + lifetime), served by the profile API
  const STATS_API = process.env.NEXT_PUBLIC_PROFILE_API || "";
  const [stats, setStats] = useState<{ date: string; day: { eth: number; usd: number }; lifetimeUsd: number } | null>(null);
  const [selDate, setSelDate] = useState("");
  useEffect(() => {
    const q = selDate ? `?date=${selDate}` : "";
    fetch(`${STATS_API}/api/airdrop/stats${q}`).then((r) => r.json()).then(setStats).catch(() => {});
  }, [selDate]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const tokens = (await client.readContract({
          address: CONTRACTS.vault,
          abi: VAULT_ABI,
          functionName: "getManagedTokens",
        })) as `0x${string}`[];

        const rows: TokenAirdrop[] = [];
        for (const token of tokens) {
          const [status, name, symbol, supply] = await Promise.all([
            client.readContract({ address: CONTRACTS.vault, abi: VAULT_ABI, functionName: "getVaultStatus", args: [token] }),
            client.readContract({ address: token, abi: ERC20_MIN, functionName: "name" }).catch(() => "Token"),
            client.readContract({ address: token, abi: ERC20_MIN, functionName: "symbol" }).catch(() => "TKN"),
            client.readContract({ address: token, abi: ERC20_MIN, functionName: "totalSupply" }).catch(() => BigInt(0)),
          ]);
          const [balance, executed, epochTimes, ready] = status as [bigint, bigint[], bigint[], boolean[]];

          let eligibility: EligibilityResult | undefined;
          if (address) eligibility = await checkEligibility(token, address);

          rows.push({
            token,
            name: name as string,
            symbol: symbol as string,
            vaultBalance: balance,
            epochAllocation: (supply as bigint) / BigInt(100), // 1%
            epochTimes: epochTimes as bigint[],
            executed: executed as bigint[],
            ready: ready as boolean[],
            eligibility,
          });
        }
        if (!cancelled) setItems(rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [client, address]);

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 pb-24">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-2">Airdrops</p>
      <h1 className="text-2xl font-bold tracking-tight mb-2">Community airdrop</h1>
      <p className="text-sm text-text-secondary mb-6 leading-relaxed max-w-2xl">
        Every locked token burns 9% of supply per epoch and routes 1% per epoch into a claim pool.
        That 1% is never burned. Each day at 23:30 UTC the oracle selects 100 random participants
        (any wallet that traded the token that day, across the NFT marketplace and the token pool)
        and allocates the pool to them. Allocations are cumulative and never expire, so you can
        claim anytime. Anything not yet allocated rolls over to the next day's draw.
      </p>

      {/* Creator-run token campaigns (separate from the automatic community airdrop) */}
      <div className="card mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="flex items-center gap-3">
          <span className="shrink-0 inline-flex items-center justify-center rounded-2xl bg-ink" style={{ width: 52, height: 52 }} aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M12 3c2.1 2.7 3.3 4.6 3.3 6.2a3.3 3.3 0 1 1-6.6 0C8.7 7.6 9.9 5.7 12 3z" fill="#00C805" />
              <path d="M6.4 12.6c1.2 1.6 1.9 2.7 1.9 3.7a1.9 1.9 0 1 1-3.8 0c0-1 .7-2.1 1.9-3.7z" fill="#00C805" opacity="0.55" />
              <path d="M17.6 12.6c1.2 1.6 1.9 2.7 1.9 3.7a1.9 1.9 0 1 1-3.8 0c0-1 .7-2.1 1.9-3.7z" fill="#00C805" opacity="0.55" />
            </svg>
          </span>
          <div>
            <p className="text-sm font-bold text-ink">Run your own airdrop</p>
            <p className="text-xs text-text-secondary mt-0.5">Distribute any ERC-20 on Robinhood Chain: allowlist or first-come. Or browse and claim community campaigns.</p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/airdrops/campaigns" className="btn-secondary rounded-full px-4 py-1.5 text-xs font-semibold">Browse</Link>
          <Link href="/airdrops/create" className="btn-primary rounded-full px-4 py-1.5 text-xs font-semibold">Create</Link>
        </div>
      </div>

      <ClaimSection />

      {/* Community airdrop stats */}
      {stats && (
        <div className="card mb-6 grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Airdrop this day</p>
              <input
                type="date"
                value={selDate || stats.date}
                onChange={(e) => setSelDate(e.target.value)}
                className="rounded-lg border border-line bg-white/70 px-2 py-1 text-[11px] text-text-secondary focus:outline-none focus:border-ink/30"
              />
            </div>
            <p className="text-2xl font-bold tabular-nums text-ink">{stats.day.eth.toLocaleString(undefined, { maximumFractionDigits: 4 })} <span className="text-base font-semibold text-text-secondary">ETH</span></p>
            <p className="text-xs tabular-nums text-text-secondary mt-0.5">~${stats.day.usd.toLocaleString(undefined, { maximumFractionDigits: 2 })} worth · {stats.date}</p>
          </div>
          <div className="sm:border-l sm:border-line sm:pl-5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-1">Total airdrop to community (lifetime)</p>
            <p className="text-2xl font-bold tabular-nums text-ink">${stats.lifetimeUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
            <p className="text-xs text-text-secondary mt-0.5">distributed to traders since launch</p>
          </div>
        </div>
      )}

      <div className="mb-6">
        <Link href="/marketplace" className="text-xs font-semibold text-accent hover:underline">
          Back to Market
        </Link>
        <span className="text-text-secondary text-xs"> · </span>
        <Link href="/landing/docs#airdrops" className="text-xs font-semibold text-accent hover:underline">
          How eligibility works
        </Link>
      </div>

      {loading && (
        <div className="text-sm text-text-secondary py-12 text-center">Loading airdrops...</div>
      )}

      {!loading && items.length === 0 && (
        <div className="card rounded-2xl border border-border p-8 text-center">
          <p className="text-sm font-semibold mb-1">No airdrops scheduled yet</p>
          <p className="text-xs text-text-secondary max-w-md mx-auto leading-relaxed">
            An airdrop schedule appears here once a bonded token locks its vault. That happens 24
            hours after the token deploys, when anyone calls lockVault on the token page.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {items.map((it) => (
          <div key={it.token} className="card p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <Link href={`/token/${it.token}`} className="text-base font-bold tracking-tight hover:text-accent">
                  {it.name} <span className="text-text-secondary font-mono text-sm">${it.symbol}</span>
                </Link>
                <p className="text-xs tabular-nums text-text-secondary mt-0.5">
                  Vault holds {compactToken(it.vaultBalance)} · {compactToken(it.epochAllocation)} {it.symbol} per epoch
                </p>
              </div>
              {it.eligibility?.eligible ? (
                <div className="text-right shrink-0">
                  <span className="inline-block rounded-full bg-mint px-2.5 py-1 text-[10px] font-semibold text-accent">
                    Selected this epoch
                  </span>
                  <p className="text-xs tabular-nums text-text-secondary mt-1">
                    est {compactToken(BigInt(it.eligibility.amount))} {it.symbol}/epoch
                  </p>
                </div>
              ) : address ? (
                <span className="inline-block shrink-0 rounded-full bg-ink/5 px-2.5 py-1 text-[10px] font-semibold text-text-secondary">
                  Not selected this epoch
                </span>
              ) : null}
            </div>

            {/* Epoch timeline */}
            <div className="grid grid-cols-5 gap-2">
              {EPOCH_DAYS.map((day, i) => {
                const done = it.executed[i] && it.executed[i] !== BigInt(0);
                const isReady = it.ready[i];
                return (
                  <div
                    key={day}
                    className={`rounded-xl border p-2.5 text-center
                      ${done ? "border-brand/30 bg-mint" : isReady ? "border-brand/40 bg-brand/5" : "border-line bg-paper"}`}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Day {day}</p>
                    <p className="text-[10px] tabular-nums text-text-secondary mt-1">{formatEpochDate(it.epochTimes[i])}</p>
                    <p className={`text-[10px] font-semibold mt-1
                      ${done ? "text-accent" : isReady ? "text-brand" : "text-text-secondary"}`}>
                      {done ? "done" : isReady ? "ready" : epochCountdown(it.epochTimes[i])}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
