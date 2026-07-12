"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePublicClient, useWriteContract } from "wagmi";
import { CONTRACTS, ORIGIN_AIRDROP_ABI } from "@/lib/contracts";
import {
  fetchCampaignList, storeCampaignList, treeFromEntries, proofFor,
  hasClaimed, fmtAmount, expiryLabel, MODE_LABEL,
  type Campaign, type Entry,
} from "@/lib/originAirdrop";
import { campaignUrl, copyToClipboard, shareToFarcaster } from "@/lib/share";
import { fetchProfiles, shortAddr, type Identity } from "@/lib/profiles";
import { CopyAddress } from "@/components/ui/CopyAddress";
import { friendlyTxError } from "@/lib/tx-errors";

type ClaimState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "eligible"; amount: bigint; proof?: `0x${string}`[]; merkleAmount?: bigint }
  | { status: "claimed"; amount: bigint }
  | { status: "ineligible"; reason: string };

// Copy-link + Share-on-Farcaster row. On Farcaster the cast embed launches the
// Mini App straight at this campaign (see /airdrops/c/[id] metadata).
export function ShareRow({ campaign: c }: { campaign: Campaign }) {
  const [copied, setCopied] = useState(false);
  const url = campaignUrl(c.id);
  const text = `Claim the $${c.tokenSymbol ?? "token"} airdrop on Hoodsea`;

  async function onCopy() {
    if (await copyToClipboard(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button onClick={onCopy} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-border hover:border-amber/50">
        {copied ? "Link copied" : "Copy link"}
      </button>
      <button onClick={() => shareToFarcaster(text, url)} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-[#8a63d2] text-[#8a63d2]">
        Share on Farcaster
      </button>
    </div>
  );
}

export function CampaignCard({ campaign: c, account, onChanged, showShare = true }: {
  campaign: Campaign; account?: `0x${string}`; onChanged: () => void; showShare?: boolean;
}) {
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [state, setState] = useState<ClaimState>({ status: "idle" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [listMissing, setListMissing] = useState(false);
  const [creatorId, setCreatorId] = useState<Identity | null>(null);

  // Resolve the creator's profile so we can show "Airdrop by @username" (their
  // Hoodsea username, or a short address when they have not set one).
  useEffect(() => {
    let off = false;
    fetchProfiles([c.creator]).then((m) => { if (!off) setCreatorId(m[c.creator.toLowerCase()] || null); });
    return () => { off = true; };
  }, [c.creator]);

  const { text: expText, expired } = expiryLabel(c.expiry);
  const dec = c.tokenDecimals ?? 18;
  const isCreator = account && account.toLowerCase() === c.creator.toLowerCase();
  const poolEmpty = c.mode === "FCFS" && c.remaining < c.amountPerWallet;

  const check = useCallback(async () => {
    if (!client || !account) return;
    setState({ status: "checking" });
    setMsg(null);
    try {
      const already = await hasClaimed(client, c.id, account);
      if (already) { setState({ status: "claimed", amount: BigInt(0) }); return; }

      if (c.mode === "FCFS") {
        const [eligible, amount] = (await client.readContract({
          address: CONTRACTS.originAirdrop, abi: ORIGIN_AIRDROP_ABI, functionName: "fcfsEligible", args: [BigInt(c.id), account],
        })) as [boolean, bigint];
        if (eligible) setState({ status: "eligible", amount });
        else setState({ status: "ineligible", reason: expired ? "Campaign ended" : poolEmpty ? "Pool is empty" : "You do not meet the holder requirement" });
        return;
      }

      const cached = await fetchCampaignList(c.id);
      if (!cached) { setListMissing(true); setState({ status: "ineligible", reason: "Recipient list not published yet" }); return; }
      const tree = treeFromEntries(cached.entries as Entry[]);
      if ((tree.root as string).toLowerCase() !== c.merkleRoot.toLowerCase()) {
        setState({ status: "ineligible", reason: "Published list does not match on-chain root" }); return;
      }
      const mine = proofFor(tree, account);
      if (!mine) { setState({ status: "ineligible", reason: "Your wallet is not on the allowlist" }); return; }
      setState({ status: "eligible", amount: BigInt(mine.amount), proof: mine.proof, merkleAmount: BigInt(mine.amount) });
    } catch (e: any) {
      setState({ status: "ineligible", reason: e?.shortMessage || "Could not check eligibility" });
    }
  }, [client, account, c, expired, poolEmpty]);

  useEffect(() => { setState({ status: "idle" }); setListMissing(false); }, [account, c.id]);

  async function claim() {
    if (!client || state.status !== "eligible") return;
    setBusy(true); setMsg(null);
    try {
      let hash: `0x${string}`;
      if (c.mode === "FCFS") {
        hash = await writeContractAsync({
          address: CONTRACTS.originAirdrop, abi: ORIGIN_AIRDROP_ABI, functionName: "claimFcfs", args: [BigInt(c.id)],
        });
      } else {
        hash = await writeContractAsync({
          address: CONTRACTS.originAirdrop, abi: ORIGIN_AIRDROP_ABI, functionName: "claimMerkle",
          args: [BigInt(c.id), state.merkleAmount as bigint, state.proof as `0x${string}`[]],
        });
      }
      await client.waitForTransactionReceipt({ hash });
      setMsg("Claimed. Tokens are in your wallet.");
      setState({ status: "claimed", amount: state.amount });
      onChanged();
    } catch (e: any) {
      setMsg(friendlyTxError(e, "Claim failed"));
    } finally { setBusy(false); }
  }

  async function sweep() {
    if (!client) return;
    setBusy(true); setMsg(null);
    try {
      const hash = await writeContractAsync({
        address: CONTRACTS.originAirdrop, abi: ORIGIN_AIRDROP_ABI, functionName: "sweep", args: [BigInt(c.id)],
      });
      await client.waitForTransactionReceipt({ hash });
      setMsg("Swept the leftover back to your wallet.");
      onChanged();
    } catch (e: any) {
      setMsg(friendlyTxError(e, "Sweep failed"));
    } finally { setBusy(false); }
  }

  return (
    <div className="card rounded-2xl border border-border p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber/10 text-accent">{MODE_LABEL[c.mode]}</span>
            <Link href={`/token/${c.token}`} className="text-base font-bold font-mono hover:text-accent">${c.tokenSymbol}</Link>
            <Link href={`/airdrops/c/${c.id}`} className="text-xs text-text-secondary hover:text-accent">#{c.id}</Link>
          </div>
          <p className="text-xs text-text-secondary mt-1">
            {c.mode === "FCFS"
              ? `${fmtAmount(c.amountPerWallet, dec)} ${c.tokenSymbol} per wallet · ${fmtAmount(c.remaining, dec)} of ${fmtAmount(c.deposited, dec)} left`
              : `${fmtAmount(c.remaining, dec)} of ${fmtAmount(c.deposited, dec)} ${c.tokenSymbol} unclaimed · ${Number(c.claimedCount)} claimed`}
          </p>
          <p className="text-[11px] text-text-secondary mt-1">
            Airdrop by{" "}
            {creatorId?.username ? (
              <Link href={`/u/${creatorId.username}`} className="font-semibold text-accent hover:underline">@{creatorId.username}</Link>
            ) : (
              <span className="inline-flex items-center gap-1">
                <Link href={`/u/${c.creator}`} className="font-mono hover:text-accent">{shortAddr(c.creator)}</Link>
                <CopyAddress address={c.creator} iconOnly iconSize={11} title="Copy creator address" />
              </span>
            )}
          </p>
        </div>
        <span className={`shrink-0 text-[10px] font-bold px-2 py-1 rounded-full ${expired ? "bg-ink/5 text-text-secondary" : "bg-mint text-accent"}`}>{expText}</span>
      </div>

      {msg && <p className="text-xs text-accent mb-2">{msg}</p>}

      {!account ? (
        <p className="text-xs text-text-secondary">Connect your wallet to check eligibility.</p>
      ) : state.status === "claimed" ? (
        <p className="text-xs font-semibold text-accent">You have claimed this airdrop.</p>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          {state.status === "idle" && !expired && (
            <button onClick={check} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-amber text-accent">Check eligibility</button>
          )}
          {state.status === "checking" && <span className="text-xs text-text-secondary">Checking…</span>}
          {state.status === "eligible" && (
            <>
              <span className="text-xs font-semibold text-accent">Eligible · {fmtAmount(state.amount, dec)} {c.tokenSymbol}</span>
              <button onClick={claim} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-sea text-ink disabled:opacity-40">{busy ? "Claiming…" : "Claim"}</button>
            </>
          )}
          {state.status === "ineligible" && (
            <>
              <span className="text-xs text-text-secondary">{state.reason}</span>
              {!expired && <button onClick={check} className="text-xs text-accent hover:underline">retry</button>}
            </>
          )}
          {expired && state.status === "idle" && <span className="text-xs text-text-secondary">This campaign has ended.</span>}
        </div>
      )}

      {/* share */}
      {showShare && (
        <div className="mt-3 pt-3 border-t border-border">
          <ShareRow campaign={c} />
        </div>
      )}

      {/* creator controls */}
      {isCreator && (
        <div className="mt-3 pt-3 border-t border-border flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-bold text-text-secondary uppercase">You created this</span>
          {expired && !c.swept && c.remaining > BigInt(0) && (
            <button onClick={sweep} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-border disabled:opacity-40">
              {busy ? "…" : `Sweep ${fmtAmount(c.remaining, dec)} ${c.tokenSymbol}`}
            </button>
          )}
          {c.mode === "MERKLE" && listMissing && <RepublishButton campaign={c} />}
        </div>
      )}
    </div>
  );
}

// Creator helper: if the recipient list never reached the cache, let them re-upload it.
function RepublishButton({ campaign: c }: { campaign: Campaign }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <label className="text-xs text-accent font-semibold cursor-pointer hover:underline">
      {busy ? "Publishing…" : msg || "Re-upload recipient list"}
      <input type="file" accept=".txt,.csv,.json" className="hidden" disabled={busy} onChange={async (e) => {
        const f = e.target.files?.[0]; if (!f) return;
        setBusy(true); setMsg(null);
        try {
          const text = await f.text();
          let entries: Entry[];
          if (f.name.endsWith(".json")) {
            const j = JSON.parse(text);
            entries = (j.entries || j) as Entry[];
          } else {
            throw new Error("Please upload the JSON list saved at creation");
          }
          const tree = treeFromEntries(entries);
          if ((tree.root as string).toLowerCase() !== c.merkleRoot.toLowerCase()) { setMsg("Root mismatch"); return; }
          const ok = await storeCampaignList(c.id, tree.root as string, entries);
          setMsg(ok ? "Published" : "Failed");
        } catch (err: any) {
          setMsg(err?.message || "Failed");
        } finally { setBusy(false); }
      }} />
    </label>
  );
}
