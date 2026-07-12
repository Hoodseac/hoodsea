"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { useAuth } from "@/lib/useAuth";
import { isAddress, getAddress } from "viem";
import toast from "react-hot-toast";
import { CONTRACTS, ORIGIN_AIRDROP_ABI, ERC20_ABI, IS_TESTNET } from "@/lib/contracts";
import { friendlyTxError } from "@/lib/tx-errors";
import { CopyAddress } from "@/components/ui/CopyAddress";
import {
  parseRecipientList, toRawUnits, buildTree, storeCampaignList, fmtAmount, validateTokenForAirdrop,
  snapshotNftHolders, holdersToEntries,
  type AirdropMode, type Entry, type SnapshotResult,
} from "@/lib/originAirdrop";

type Step = 1 | 2 | 3;

const inputCls =
  "input-base";

// Default expiry: 7 days from now, as a datetime-local string.
function defaultExpiry() {
  const d = new Date(Date.now() + 7 * 86400_000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CreateAirdropPage() {
  const { address, isConnected } = useAccount();
  const { login } = useAuth();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<AirdropMode>("MERKLE");

  // token
  const [tokenAddr, setTokenAddr] = useState("");
  const [token, setToken] = useState<{ address: `0x${string}`; symbol: string; decimals: number; balance: bigint } | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);

  // merkle list
  const [recipientSource, setRecipientSource] = useState<"paste" | "snapshot">("paste");
  const [listText, setListText] = useState("");
  const [equalAmount, setEqualAmount] = useState(""); // used when list has no per-row amounts

  // merkle: NFT holder snapshot
  const [nftAddr, setNftAddr] = useState("");
  const [snapshot, setSnapshot] = useState<SnapshotResult | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [loadingHolders, setLoadingHolders] = useState(false);
  const [weightMode, setWeightMode] = useState<"equal" | "weighted">("equal");
  const [snapAmount, setSnapAmount] = useState(""); // per holder (equal) or per NFT (weighted)

  // fcfs
  const [amountPerWallet, setAmountPerWallet] = useState("");
  const [fcfsTotal, setFcfsTotal] = useState("");
  const [gateToken, setGateToken] = useState("");
  const [gateMin, setGateMin] = useState("");

  // common
  const [expiry, setExpiry] = useState(defaultExpiry());
  const [busy, setBusy] = useState<string | null>(null);

  // ── token lookup + anti-dust/scam validation ──
  const loadToken = useCallback(async () => {
    if (!publicClient || !isAddress(tokenAddr)) { toast.error("Enter a valid token address"); return; }
    setLoadingToken(true);
    setToken(null);
    setTokenError(null);
    try {
      const addr = getAddress(tokenAddr) as `0x${string}`;
      const check = await validateTokenForAirdrop(publicClient, address, addr);
      if (!check.ok) {
        setTokenError(check.reason || "Token rejected");
        return;
      }
      setToken({ address: addr, symbol: check.symbol, decimals: check.decimals, balance: check.balance });
    } catch {
      setTokenError("Could not read token");
    } finally {
      setLoadingToken(false);
    }
  }, [publicClient, tokenAddr, address]);

  // ── NFT holder snapshot ──
  const loadHolders = useCallback(async () => {
    if (!publicClient || !isAddress(nftAddr)) { toast.error("Enter a valid NFT collection address"); return; }
    setLoadingHolders(true);
    setSnapshot(null);
    setSnapError(null);
    try {
      const snap = await snapshotNftHolders(publicClient, nftAddr);
      setSnapshot(snap);
    } catch (e: any) {
      setSnapError(e?.message || "Could not snapshot holders");
    } finally {
      setLoadingHolders(false);
    }
  }, [publicClient, nftAddr]);

  // ── merkle parse + tree ──
  const parsed = useMemo(
    () => (mode === "MERKLE" && recipientSource === "paste" ? parseRecipientList(listText) : null),
    [mode, recipientSource, listText],
  );

  const merkle = useMemo(() => {
    if (mode !== "MERKLE" || !token) return null;
    try {
      let entries: Entry[];

      if (recipientSource === "snapshot") {
        if (!snapshot || snapshot.holders.length === 0) return null;
        if (!snapAmount || Number(snapAmount) <= 0) return null;
        entries = holdersToEntries(snapshot.holders, token.decimals, weightMode, snapAmount);
      } else {
        if (!parsed || parsed.rows.length === 0 || parsed.errors.length) return null;
        const needsEqual = !parsed.hasPerRowAmounts;
        if (needsEqual && (!equalAmount || Number(equalAmount) <= 0)) return null;
        // mixed lists (some rows with amounts, some without) are rejected for clarity
        if (parsed.hasPerRowAmounts && parsed.rows.some((r) => !r.amount)) return null;
        entries = parsed.rows.map((r) => {
          const human = parsed.hasPerRowAmounts ? (r.amount as string) : equalAmount;
          return [r.address, toRawUnits(human, token.decimals).toString()];
        });
      }

      const tree = buildTree(entries);
      const total = entries.reduce((acc, e) => acc + BigInt(e[1]), BigInt(0));
      return { entries, root: tree.root as `0x${string}`, total, count: entries.length, tree };
    } catch {
      return null;
    }
  }, [mode, token, recipientSource, parsed, equalAmount, snapshot, snapAmount, weightMode]);

  // ── fcfs totals ──
  const fcfs = useMemo(() => {
    if (mode !== "FCFS" || !token) return null;
    if (!amountPerWallet || Number(amountPerWallet) <= 0) return null;
    if (!fcfsTotal || Number(fcfsTotal) <= 0) return null;
    try {
      const per = toRawUnits(amountPerWallet, token.decimals);
      const total = toRawUnits(fcfsTotal, token.decimals);
      if (total < per) return null;
      const gate = gateToken && isAddress(gateToken) ? (getAddress(gateToken) as `0x${string}`) : null;
      const min = gate && gateMin ? toRawUnits(gateMin, 0) : BigInt(0); // gate min is a raw count/balance
      if (gate && (!gateMin || min === BigInt(0))) return null;
      return { per, total, gate, min, slots: Number(total / per) };
    } catch {
      return null;
    }
  }, [mode, token, amountPerWallet, fcfsTotal, gateToken, gateMin]);

  const totalNeeded = mode === "MERKLE" ? merkle?.total : fcfs?.total;
  const expiryUnix = useMemo(() => Math.floor(new Date(expiry).getTime() / 1000), [expiry]);
  const expiryValid = expiryUnix > Math.floor(Date.now() / 1000);
  const enoughBalance = token && totalNeeded !== undefined ? token.balance >= totalNeeded : false;

  const canReview = !!token && totalNeeded !== undefined && totalNeeded > BigInt(0) && expiryValid;

  // ── submit ──
  async function handleCreate() {
    if (!publicClient || !token || totalNeeded === undefined || !address) return;
    if (!enoughBalance) { toast.error("Insufficient token balance"); return; }
    try {
      // 1) approve if needed
      const allowance = (await publicClient.readContract({
        address: token.address, abi: ERC20_ABI, functionName: "allowance", args: [address, CONTRACTS.originAirdrop],
      })) as bigint;
      if (allowance < totalNeeded) {
        setBusy("approve");
        const ah = await writeContractAsync({
          address: token.address, abi: ERC20_ABI, functionName: "approve",
          args: [CONTRACTS.originAirdrop, totalNeeded],
        });
        await publicClient.waitForTransactionReceipt({ hash: ah });
      }

      // 2) record the next id (sequential) so we can store the merkle list after
      const countBefore = (await publicClient.readContract({
        address: CONTRACTS.originAirdrop, abi: ORIGIN_AIRDROP_ABI, functionName: "campaignsCount",
      })) as bigint;
      const newId = Number(countBefore);

      setBusy("create");
      let hash: `0x${string}`;
      if (mode === "MERKLE" && merkle) {
        hash = await writeContractAsync({
          address: CONTRACTS.originAirdrop, abi: ORIGIN_AIRDROP_ABI, functionName: "createMerkleCampaign",
          args: [token.address, merkle.root, totalNeeded, BigInt(expiryUnix)],
        });
      } else if (mode === "FCFS" && fcfs) {
        hash = await writeContractAsync({
          address: CONTRACTS.originAirdrop, abi: ORIGIN_AIRDROP_ABI, functionName: "createFcfsCampaign",
          args: [token.address, fcfs.per, fcfs.total, fcfs.gate ?? "0x0000000000000000000000000000000000000000", fcfs.min, BigInt(expiryUnix)],
        });
      } else {
        toast.error("Incomplete configuration"); setBusy(null); return;
      }
      await publicClient.waitForTransactionReceipt({ hash });

      // 3) publish the recipient list so claimers can build proofs
      if (mode === "MERKLE" && merkle) {
        setBusy("publish");
        const ok = await storeCampaignList(newId, merkle.root, merkle.entries);
        if (!ok) toast("Campaign created, but the list cache failed. You can re-publish from Browse.", { icon: "!" });
      }

      toast.success("Airdrop campaign created");
      // Land on the campaign's page so the creator can grab the share link / cast it.
      window.location.href = `/airdrops/c/${newId}`;
    } catch (e: any) {
      toast.error(friendlyTxError(e, "Create failed"));
    } finally {
      setBusy(null);
    }
  }

  if (!isConnected) {
    // login() opens the shared wallet picker (browser-injected / Coinbase / WC).
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-bold mb-2">Create an airdrop</h1>
        <p className="text-sm text-text-secondary mb-6">Connect your wallet to set up a token distribution.</p>
        <div className="flex flex-col gap-2 max-w-xs mx-auto">
          <button onClick={() => login()}
            className="px-5 py-2.5 rounded-xl bg-sea text-ink text-sm font-bold hover:opacity-90">
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 pb-24">
      <Link href="/airdrops/campaigns" className="text-xs font-semibold text-accent hover:underline">Back to campaigns</Link>
      <div className="flex items-center gap-4 mt-2 mb-6">
        <img src="/airdrop/hero.webp" alt="" width={72} height={72} className="shrink-0 drop-shadow-[0_8px_24px_rgba(0,200,5,0.35)]" />
        <div>
          <h1 className="text-2xl font-bold mb-1">Create an airdrop</h1>
          <p className="text-sm text-text-secondary">Distribute any ERC-20 on Robinhood Chain. The contract holds your deposit and pays out by your rules. No admin keys, fully on-chain.</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6 text-xs">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full grid place-items-center font-bold ${step >= s ? "bg-ink text-white" : "bg-ink/5 text-text-secondary"}`}>{s}</span>
            <span className={step >= s ? "text-text-primary" : "text-text-secondary"}>{s === 1 ? "Type" : s === 2 ? "Recipients" : "Review"}</span>
            {s < 3 && <span className="w-6 h-px bg-border" />}
          </div>
        ))}
      </div>

      {/* Step 1: mode + token */}
      {step === 1 && (
        <div className="space-y-5">
          <div>
            <p className="text-sm font-semibold mb-2">Airdrop type</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => setMode("MERKLE")}
                className={`text-left rounded-2xl border p-4 transition-colors ${mode === "MERKLE" ? "border-amber bg-amber/5" : "border-border hover:border-amber/40"}`}
              >
                <img src="/airdrop/allowlist.webp" alt="" width={44} height={44} className="mb-2" />
                <p className="text-sm font-bold">Allowlist</p>
                <p className="text-xs text-text-secondary mt-1">Upload a list of wallets (and amounts). Only listed wallets can claim. Use for snapshots, holders, winners.</p>
              </button>
              <button
                onClick={() => setMode("FCFS")}
                className={`text-left rounded-2xl border p-4 transition-colors ${mode === "FCFS" ? "border-amber bg-amber/5" : "border-border hover:border-amber/40"}`}
              >
                <img src="/airdrop/fcfs.webp" alt="" width={44} height={44} className="mb-2" />
                <p className="text-sm font-bold">First come first serve</p>
                <p className="text-xs text-text-secondary mt-1">Fixed amount per wallet until the pool runs out. Optional: require holding a token or NFT to claim.</p>
              </button>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold mb-2">Token to distribute</p>
            <div className="flex gap-2">
              <input className={inputCls} placeholder="0x token address on Robinhood Chain" value={tokenAddr} onChange={(e) => { setTokenAddr(e.target.value); setToken(null); setTokenError(null); }} />
              <button onClick={loadToken} disabled={loadingToken} className="shrink-0 px-4 rounded-xl border border-amber text-accent text-sm font-bold disabled:opacity-40">
                {loadingToken ? "Checking..." : "Load"}
              </button>
            </div>
            {token && (
              <div className="mt-2 flex items-center justify-between rounded-xl border border-brand/30 bg-mint px-3 py-2 text-xs">
                <span className="font-mono font-semibold">${token.symbol}</span>
                <span className="text-text-secondary">Balance: {fmtAmount(token.balance, token.decimals)}</span>
              </div>
            )}
            {tokenError && (
              <div className="mt-2 rounded-xl border border-down/30 bg-down/10 px-3 py-2 text-[12px] text-down">
                {tokenError}
              </div>
            )}
            <p className="mt-2 text-[11px] text-text-secondary">
              {IS_TESTNET
                ? "Tokens are checked for a valid ERC-20 interface and screened for phishing/dust names."
                : "Tokens must be a valid ERC-20 with a live DEX market on Robinhood Chain. Dust and scam tokens are blocked."}
            </p>
          </div>

          <button
            onClick={() => setStep(2)}
            disabled={!token}
            className="w-full py-2.5 rounded-xl bg-sea text-ink text-sm font-bold disabled:opacity-40"
          >
            Continue
          </button>
        </div>
      )}

      {/* Step 2: recipients / config */}
      {step === 2 && token && (
        <div className="space-y-5">
          {mode === "MERKLE" ? (
            <>
              {/* recipient source toggle */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setRecipientSource("paste")}
                  className={`rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${recipientSource === "paste" ? "border-amber bg-amber/5 text-accent" : "border-border text-text-secondary"}`}
                >Paste wallet list</button>
                <button
                  onClick={() => setRecipientSource("snapshot")}
                  className={`rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${recipientSource === "snapshot" ? "border-amber bg-amber/5 text-accent" : "border-border text-text-secondary"}`}
                >Snapshot NFT holders</button>
              </div>

              {recipientSource === "paste" ? (
                <>
                  <div>
                    <p className="text-sm font-semibold mb-1">Recipient list</p>
                    <p className="text-xs text-text-secondary mb-2">One wallet per line. Either <span className="font-mono">0xabc...</span> (equal amount each) or <span className="font-mono">0xabc...,1000</span> (amount per wallet). Lines starting with # are ignored.</p>
                    <textarea
                      className={`${inputCls} font-mono h-44 resize-y`}
                      placeholder={"0x1111111111111111111111111111111111111111\n0x2222222222222222222222222222222222222222,500"}
                      value={listText}
                      onChange={(e) => setListText(e.target.value)}
                    />
                    <div className="flex items-center gap-2 mt-2">
                      <label className="text-xs text-accent font-semibold cursor-pointer hover:underline">
                        Upload .txt / .csv
                        <input type="file" accept=".txt,.csv" className="hidden" onChange={(e) => {
                          const f = e.target.files?.[0]; if (!f) return;
                          const r = new FileReader(); r.onload = () => setListText(String(r.result || "")); r.readAsText(f);
                        }} />
                      </label>
                    </div>
                  </div>

                  {parsed && !parsed.hasPerRowAmounts && parsed.rows.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold mb-1">Amount per wallet</p>
                      <input className={inputCls} placeholder={`e.g. 1000 ${token.symbol}`} value={equalAmount} onChange={(e) => setEqualAmount(e.target.value)} />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <p className="text-sm font-semibold mb-1">NFT collection</p>
                    <p className="text-xs text-text-secondary mb-2">Paste an Hoodsea NFT collection. We snapshot its current holders on-chain and airdrop to them.</p>
                    <div className="flex gap-2">
                      <input className={inputCls} placeholder="0x NFT collection address" value={nftAddr} onChange={(e) => { setNftAddr(e.target.value); setSnapshot(null); setSnapError(null); }} />
                      <button onClick={loadHolders} disabled={loadingHolders} className="shrink-0 px-4 rounded-xl border border-amber text-accent text-sm font-bold disabled:opacity-40">
                        {loadingHolders ? "Reading..." : "Snapshot"}
                      </button>
                    </div>
                    {snapError && <div className="mt-2 rounded-xl border border-down/30 bg-down/10 px-3 py-2 text-[12px] text-down">{snapError}</div>}
                    {snapshot && (
                      <div className="mt-2 rounded-xl border border-brand/30 bg-mint p-3 text-xs">
                        <div className="flex justify-between mb-1"><span className="text-text-secondary">Holders</span><span className="font-semibold">{snapshot.holders.length}</span></div>
                        <div className="flex justify-between mb-2"><span className="text-text-secondary">NFTs held (of {snapshot.minted} minted)</span><span className="font-semibold">{snapshot.totalNfts}</span></div>
                        <div className="space-y-0.5 max-h-28 overflow-auto">
                          {snapshot.holders.slice(0, 6).map((h) => (
                            <div key={h.address} className="flex justify-between font-mono text-[11px]">
                              <CopyAddress address={h.address} display={`${h.address.slice(0, 8)}…${h.address.slice(-4)}`} title="Copy holder address" iconSize={11} className="text-[11px]" />
                              <span className="text-text-secondary">{h.count} NFT{h.count > 1 ? "s" : ""}</span>
                            </div>
                          ))}
                          {snapshot.holders.length > 6 && <p className="text-text-secondary">+{snapshot.holders.length - 6} more</p>}
                        </div>
                      </div>
                    )}
                  </div>

                  {snapshot && (
                    <div>
                      <p className="text-sm font-semibold mb-1">Distribution</p>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <button onClick={() => setWeightMode("equal")} className={`rounded-xl border px-3 py-2 text-xs font-bold ${weightMode === "equal" ? "border-amber bg-amber/5 text-accent" : "border-border text-text-secondary"}`}>Equal per holder</button>
                        <button onClick={() => setWeightMode("weighted")} className={`rounded-xl border px-3 py-2 text-xs font-bold ${weightMode === "weighted" ? "border-amber bg-amber/5 text-accent" : "border-border text-text-secondary"}`}>Weighted by NFTs held</button>
                      </div>
                      <input className={inputCls} placeholder={weightMode === "equal" ? `Amount per holder (e.g. 1000 ${token.symbol})` : `Amount per NFT (e.g. 100 ${token.symbol})`} value={snapAmount} onChange={(e) => setSnapAmount(e.target.value)} />
                    </div>
                  )}
                </>
              )}

              {parsed && parsed.errors.length > 0 && (
                <div className="rounded-xl border border-down/30 bg-down/10 p-3 text-[12px] text-down space-y-0.5 max-h-32 overflow-auto">
                  {parsed.errors.slice(0, 8).map((er, i) => <p key={i}>{er}</p>)}
                  {parsed.errors.length > 8 && <p>+{parsed.errors.length - 8} more</p>}
                </div>
              )}
              {parsed && parsed.hasPerRowAmounts && parsed.rows.some((r) => !r.amount) && (
                <p className="text-xs text-down">Mixed list: every line must include an amount, or none should.</p>
              )}

              {merkle && (
                <div className="rounded-xl border border-line bg-paper p-3 text-xs space-y-1">
                  <div className="flex justify-between"><span className="text-text-secondary">Recipients</span><span className="font-semibold">{merkle.count}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Total to deposit</span><span className="font-semibold">{fmtAmount(merkle.total, token.decimals)} {token.symbol}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Merkle root</span><span className="font-mono">{merkle.root.slice(0, 10)}…{merkle.root.slice(-6)}</span></div>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-sm font-semibold mb-1">Amount per wallet</p>
                  <input className={inputCls} placeholder="e.g. 100" value={amountPerWallet} onChange={(e) => setAmountPerWallet(e.target.value)} />
                </div>
                <div>
                  <p className="text-sm font-semibold mb-1">Total pool</p>
                  <input className={inputCls} placeholder="e.g. 100000" value={fcfsTotal} onChange={(e) => setFcfsTotal(e.target.value)} />
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold mb-1">Holder gate <span className="text-text-secondary font-normal">(optional)</span></p>
                <p className="text-xs text-text-secondary mb-2">Require the claimer to hold at least N of a token or NFT (ERC-20 / ERC-721). Leave blank for open claim. Note: ERC-1155 collections are not supported as a gate.</p>
                <div className="grid grid-cols-2 gap-3">
                  <input className={inputCls} placeholder="Gate token/NFT address" value={gateToken} onChange={(e) => setGateToken(e.target.value)} />
                  <input className={inputCls} placeholder="Min balance (whole units)" value={gateMin} onChange={(e) => setGateMin(e.target.value)} />
                </div>
              </div>
              {fcfs && (
                <div className="rounded-xl border border-line bg-paper p-3 text-xs space-y-1">
                  <div className="flex justify-between"><span className="text-text-secondary">Claim slots</span><span className="font-semibold">~{fcfs.slots}</span></div>
                  <div className="flex justify-between"><span className="text-text-secondary">Total to deposit</span><span className="font-semibold">{fmtAmount(fcfs.total, token.decimals)} {token.symbol}</span></div>
                  {fcfs.gate && <div className="flex justify-between"><span className="text-text-secondary">Gated</span><span className="font-mono">{fcfs.gate.slice(0, 8)}… ≥ {fcfs.min.toString()}</span></div>}
                </div>
              )}
            </>
          )}

          <div>
            <p className="text-sm font-semibold mb-1">Claim deadline</p>
            <input type="datetime-local" className={inputCls} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            {!expiryValid && <p className="text-xs text-down mt-1">Deadline must be in the future.</p>}
            <p className="text-xs text-text-secondary mt-1">After this, unclaimed tokens can be swept back to you.</p>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold">Back</button>
            <button onClick={() => setStep(3)} disabled={!canReview} className="flex-1 py-2.5 rounded-xl bg-sea text-ink text-sm font-bold disabled:opacity-40">Review</button>
          </div>
        </div>
      )}

      {/* Step 3: review + create */}
      {step === 3 && token && totalNeeded !== undefined && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-border p-5 space-y-2 text-sm">
            <Row label="Type" value={mode === "MERKLE" ? "Allowlist" : "First come first serve"} />
            <Row label="Token" value={`$${token.symbol}`} mono />
            <Row label="Total deposit" value={`${fmtAmount(totalNeeded, token.decimals)} ${token.symbol}`} />
            {mode === "MERKLE" && merkle && <Row label="Recipients" value={String(merkle.count)} />}
            {mode === "FCFS" && fcfs && <Row label="Per wallet" value={`${fmtAmount(fcfs.per, token.decimals)} ${token.symbol} · ~${fcfs.slots} slots`} />}
            {mode === "FCFS" && fcfs?.gate && <Row label="Gate" value={`${fcfs.gate.slice(0, 10)}… ≥ ${fcfs.min.toString()}`} mono />}
            <Row label="Deadline" value={new Date(expiry).toLocaleString()} />
          </div>

          {!enoughBalance && (
            <p className="text-xs text-down">Your balance is {fmtAmount(token.balance, token.decimals)} {token.symbol}, not enough for this deposit.</p>
          )}

          <p className="text-xs text-text-secondary">
            You will sign up to two transactions: an approval (if needed) and the campaign creation that transfers your deposit into the contract.
          </p>

          <div className="flex gap-3">
            <button onClick={() => setStep(2)} disabled={!!busy} className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold disabled:opacity-40">Back</button>
            <button onClick={handleCreate} disabled={!!busy || !enoughBalance} className="flex-1 py-2.5 rounded-xl bg-sea text-ink text-sm font-bold disabled:opacity-40">
              {busy === "approve" ? "Approving…" : busy === "create" ? "Creating…" : busy === "publish" ? "Publishing list…" : "Create airdrop"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-text-secondary">{label}</span>
      <span className={`font-semibold text-right ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
