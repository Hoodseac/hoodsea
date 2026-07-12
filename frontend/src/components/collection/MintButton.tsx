"use client";

import { useState, useEffect, useMemo } from "react";
import { useWriteContract, useAccount, useReadContract, useConfig } from "wagmi";
import { useAuth } from "@/lib/useAuth";
import { waitForTransactionReceipt } from "@wagmi/core";
import { parseEventLogs } from "viem";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { friendlyTxError } from "@/lib/tx-errors";
import { NFT_ABI } from "@/lib/contracts";
import { fetchAllowlistFromIPFS, getProof, isInList } from "@/lib/allowlist";
import { MysteryArt } from "./MysteryArt";
import { IpfsImage } from "@/components/ui/IpfsImage";

const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
const RARITY_COLORS = ["#6b7280", "#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#ec4899"];

interface MintResult {
  qty: number;
  rarity: number | null;
  photoURI: string | null;
  revealTiming: string;
  placeholderURI: string; // creator's mystery photo ("" = default art)
}

interface Props {
  collectionAddress: `0x${string}`;
  mintCost: bigint; // unit cost (price + platform fee) for ONE nft
  isOpen: boolean;
  isSoldOut: boolean;
  disabled?: boolean;
  supplyRemaining?: number; // unminted supply left in the collection (out of 100)
}

const PHASE_NAMES = ["TEAM", "GTD", "FCFS", "PUBLIC"];

export function MintButton({ collectionAddress, mintCost, isSoldOut, supplyRemaining }: Props) {
  const { isConnected: authenticated, address } = useAccount();
  const { login } = useAuth();
  const { writeContractAsync, isPending } = useWriteContract();
  const config = useConfig();

  const [qty, setQty] = useState(1);
  const [qtyInput, setQtyInput] = useState("1");
  const updateQty = (n: number) => { setQty(n); setQtyInput(String(n)); };
  const [mintResult, setMintResult] = useState<MintResult | null>(null);
  const [teamList, setTeamList] = useState<string[]>([]);
  const [gtdList, setGtdList] = useState<string[]>([]);
  const [fcfsList, setFcfsList] = useState<string[]>([]);
  // mintedCard removed, replaced by mintResult

  // Read current phase (reverts if none active -> treated as no phase)
  const { data: phaseId } = useReadContract({
    address: collectionAddress,
    abi: NFT_ABI,
    functionName: "currentPhaseId",
  });

  const { data: hasActive } = useReadContract({
    address: collectionAddress,
    abi: NFT_ABI,
    functionName: "hasActivePhase",
  });

  const { data: cid } = useReadContract({
    address: collectionAddress,
    abi: NFT_ABI,
    functionName: "allowlistCID",
  });

  // Collection info for reveal photos
  const { data: colInfo } = useReadContract({
    address: collectionAddress,
    abi: NFT_ABI,
    functionName: "getCollectionInfo",
  });

  // remaining for this wallet in current phase
  const { data: remaining, refetch: refetchRemaining } = useReadContract({
    address: collectionAddress,
    abi: NFT_ABI,
    functionName: "remainingForWallet",
    args: phaseId !== undefined && address ? [Number(phaseId), address] : undefined,
    query: { enabled: phaseId !== undefined && !!address },
  });

  // Fetch allowlist from IPFS
  useEffect(() => {
    if (cid && typeof cid === "string" && cid.length > 0) {
      fetchAllowlistFromIPFS(cid).then((d) => {
        setTeamList(d.team || []);
        setGtdList(d.gtd || []);
        setFcfsList(d.fcfs || []);
      });
    }
  }, [cid]);

  // Eligibility for current phase (0=Team, 1=GTD, 2=FCFS, 3=Public)
  const eligibility = useMemo(() => {
    if (!address) return { eligible: false, label: "CONNECT WALLET" };
    if (!hasActive) return { eligible: false, label: "NO ACTIVE PHASE" };
    const pid = Number(phaseId ?? 3);
    if (pid === 0) {
      return isInList(teamList, address)
        ? { eligible: true, label: "ELIGIBLE: TEAM" }
        : { eligible: false, label: "NOT ON TEAM LIST" };
    }
    if (pid === 1) {
      return isInList(gtdList, address)
        ? { eligible: true, label: "ELIGIBLE: GTD" }
        : { eligible: false, label: "NOT ON GTD LIST" };
    }
    if (pid === 2) {
      return isInList(fcfsList, address)
        ? { eligible: true, label: "ELIGIBLE: FCFS" }
        : { eligible: false, label: "NOT ON FCFS LIST" };
    }
    return { eligible: true, label: "PUBLIC PHASE" }; // pid === 3
  }, [address, hasActive, phaseId, teamList, gtdList, fcfsList]);

  const MAX_UINT = BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935");
  const remainingNum = remaining !== undefined ? (remaining >= MAX_UINT / BigInt(2) ? 9999 : Number(remaining)) : null;
  const maxReached = remainingNum !== null && remainingNum <= 0;

  // proof for current wallet/phase (0=Team, 1=GTD, 2=FCFS, 3=Public)
  const proof = useMemo(() => {
    if (!address) return [];
    const pid = Number(phaseId ?? 3);
    if (pid === 0) return getProof(teamList, address);
    if (pid === 1) return getProof(gtdList, address);
    if (pid === 2) return getProof(fcfsList, address);
    return []; // public: no proof
  }, [address, phaseId, teamList, gtdList, fcfsList]);

  // success chime via Web Audio (no asset file needed)
  const playMintSound = () => {
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      if (ctx.state === "suspended") ctx.resume();
      const now = ctx.currentTime;
      [523.25, 659.25, 783.99].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        const start = now + i * 0.09;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.4);
      });
    } catch {}
  };

  const handleMint = async () => {
    if (!authenticated) { login(); return; }
    const toastId = "mint";
    try {
      toast.loading("Confirm in wallet...", { id: toastId });
      const hash = await writeContractAsync({
        address: collectionAddress,
        abi: NFT_ABI,
        functionName: "mint",
        args: [BigInt(qty), proof],
        value: mintCost * BigInt(qty),
        gas: BigInt(300000 + 200000 * qty),
      });
      toast.loading("Waiting for confirmation...", { id: toastId });
      const receipt = await waitForTransactionReceipt(config, { hash });
      if (receipt.status !== "success") {
        toast.error("Mint transaction failed", { id: toastId });
        return;
      }
      toast.success(`Minted ${qty} NFT${qty > 1 ? "s" : ""}!`, { id: toastId });
      await refetchRemaining();
      playMintSound();

      // Rarity is assigned at sellout, but the seed is drawn from a block mined
      // AFTER this tx (anti-grind), so the final minter cannot read their rarity
      // in the same transaction. If this mint completed bonding, kick off the
      // permissionless reveal in a follow-up tx; rarity stays null here.
      const rarity: number | null = null;
      try {
        const bondingLogs = parseEventLogs({ abi: NFT_ABI, eventName: "BondingComplete", logs: receipt.logs });
        if (bondingLogs.length > 0) {
          writeContractAsync({
            address: collectionAddress,
            abi: NFT_ABI,
            functionName: "revealRarities",
          }).catch(() => {});
        }
      } catch {}

      const photoURI: string | null = null;

      let revealTiming = "instant";
      let placeholderURI = "";
      try {
        const api = process.env.NEXT_PUBLIC_PROFILE_API || "";
        const meta = await fetch(`${api}/api/collection/meta/${collectionAddress}`).then(r => r.json());
        if (meta?.revealTiming) revealTiming = meta.revealTiming;
        if (typeof meta?.unrevealedURI === "string") placeholderURI = meta.unrevealedURI;
      } catch {}

      setMintResult({ qty, rarity, photoURI, revealTiming, placeholderURI });
    } catch (err: any) {
      toast.error(friendlyTxError(err, "Mint failed"), { id: toastId });
    }
  };

  if (isSoldOut) {
    return <div className="w-full py-2 text-center text-xs font-semibold bg-muted text-text-dim border border-border rounded-xl">SOLD OUT</div>;
  }

  const canMint = authenticated && eligibility.eligible && hasActive && !maxReached && !isPending;
  // Wallet limit can be "unlimited" (9999), never show more than the actual unminted supply
  const supplyLeft = supplyRemaining !== undefined ? Math.max(0, Math.min(supplyRemaining, 100)) : 100;
  const effRemaining = remainingNum === null ? null : Math.min(remainingNum, supplyLeft);
  const maxQty = Math.max(1, effRemaining !== null && effRemaining > 0 ? effRemaining : supplyLeft);
  const remainingLabel = effRemaining === null ? null : `${effRemaining} left`;

  return (
    <>
      <div className="space-y-2">
        {/* Eligibility badge, item 10: compact, Unlimited instead of 9999 */}
        <div className={`px-2.5 py-1.5 border rounded-lg text-[11px] font-medium flex items-center justify-between
          ${eligibility.eligible ? "border-brand/40 bg-mint text-accent" : "border-border bg-panel text-text-secondary"}`}>
          <span className="flex items-center gap-1.5">
            {hasActive && phaseId !== undefined && (
              <span className="px-1.5 py-0.5 rounded-md bg-amber/10 text-accent font-bold text-[9px]">
                {PHASE_NAMES[Number(phaseId)] ?? "PUBLIC"}
              </span>
            )}
            {eligibility.label}
          </span>
          {remainingLabel && eligibility.eligible && !maxReached && (
            <span className="text-text-dim">{remainingLabel}</span>
          )}
          {maxReached && <span className="text-down">max reached</span>}
        </div>

        {/* Quantity selector */}
        {canMint && (
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => updateQty(Math.max(1, qty - 1))}
              className="w-7 h-7 border border-border rounded-lg text-accent text-sm hover:border-amber transition-colors">−</button>
            <input
              type="number" min={1} max={maxQty}
              value={qtyInput}
              onChange={(e) => {
                setQtyInput(e.target.value);
                const n = parseInt(e.target.value);
                if (!isNaN(n) && n >= 1 && n <= maxQty) setQty(n);
              }}
              onBlur={() => { if (!qtyInput || isNaN(parseInt(qtyInput))) setQtyInput(String(qty)); }}
              className="font-mono text-base text-text-primary w-12 text-center bg-transparent border-b border-amber/40 outline-none [appearance:textfield]"
            />
            <button onClick={() => updateQty(Math.min(maxQty, qty + 1))}
              className="w-7 h-7 border border-border rounded-lg text-accent text-sm hover:border-amber transition-colors">+</button>
          </div>
        )}

        {/* MINT button, primary CTA */}
        <motion.button
          onClick={handleMint}
          disabled={!canMint}
          whileTap={canMint ? { scale: 0.98 } : {}}
          className="btn-primary mx-auto min-w-[160px]"
        >
          {!authenticated ? "CONNECT WALLET"
            : isPending ? "MINTING..."
            : maxReached ? "MAX REACHED"
            : !eligibility.eligible ? "NOT ELIGIBLE"
            : `MINT ${qty > 1 ? `${qty} NFTs` : "NFT"}`}
        </motion.button>
      </div>

      {/* Mint success / reveal card */}
      {mintResult !== null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm"
          onClick={() => setMintResult(null)}
        >
          <motion.div
            initial={{ scale: 0.85, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            className="relative w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Full-bleed photo or mystery (fills the whole card) */}
            <div className="aspect-[4/5] relative">
              {mintResult.revealTiming === "instant" && mintResult.photoURI ? (
                <img src={mintResult.photoURI} alt="Rarity reveal" className="w-full h-full object-cover" />
              ) : mintResult.placeholderURI ? (
                <IpfsImage uri={mintResult.placeholderURI} alt="Unrevealed" className="w-full h-full object-cover" />
              ) : (
                <MysteryArt className="w-full h-full object-cover" />
              )}

              {/* Rarity badge (instant reveal only) */}
              {mintResult.revealTiming === "instant" && mintResult.rarity !== null && (
                <div className="absolute top-3 left-3">
                  <span className="px-2.5 py-1 text-[10px] font-bold text-white rounded-full shadow"
                    style={{ background: RARITY_COLORS[mintResult.rarity] }}>
                    {RARITY_NAMES[mintResult.rarity]?.toUpperCase()}
                  </span>
                </div>
              )}

              {/* Small plain close button (sky tinted) */}
              <button
                onClick={() => setMintResult(null)}
                aria-label="Close"
                className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-white/20 text-white text-sm hover:bg-white/35 transition-colors backdrop-blur-sm"
              >
                ×
              </button>

              {/* Text overlay on a sky gradient at the bottom */}
              <div className="absolute inset-x-0 bottom-0 pt-16 pb-6 px-5 text-center bg-gradient-to-t from-ink via-ink/80 to-transparent">
                <p className="text-3xl font-bold text-white tracking-tight">
                  You&apos;re in the deep
                </p>
                <p className="text-sm font-semibold text-brand mt-1">
                  Mint successful
                </p>
                <p className="text-sm text-white/75">
                  {mintResult.qty} NFT{mintResult.qty > 1 ? "s" : ""} minted
                </p>
                {mintResult.revealTiming !== "instant" ? (
                  <p className="text-xs text-white/60 mt-0.5">
                    Rarity revealed in {mintResult.revealTiming}
                  </p>
                ) : mintResult.rarity === null ? (
                  <p className="text-xs text-white/60 mt-0.5">
                    Rarity revealed at sellout
                  </p>
                ) : null}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </>
  );
}
