"use client";

import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useReadContract, useWriteContract, useAccount } from "wagmi";
import { formatEther } from "viem";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { NFT_ABI, RARITY } from "@/lib/contracts";
import { IpfsImage } from "@/components/ui/IpfsImage";
import { MintButton } from "@/components/collection/MintButton";
import { RarityBar } from "@/components/collection/RarityBar";
import { VaultStatus } from "@/components/token/VaultStatus";
import { MintCountdown } from "@/components/ui/MintCountdown";
import { NFTGrid } from "@/components/collection/NFTGrid";
import { OwnedPreBondingGrid } from "@/components/collection/OwnedPreBondingGrid";

// Code-split: CreatorPanel only renders for the collection's creator (most
// visitors never see it), and LiveMintFeed sits below the fold, defer both so
// the common visitor's initial bundle stays small.
const CreatorPanel = dynamic(() => import("@/components/collection/CreatorPanel").then((m) => m.CreatorPanel), { ssr: false });
const LiveMintFeed = dynamic(() => import("@/components/collection/LiveMintFeed").then((m) => m.LiveMintFeed), { ssr: false, loading: () => null });
import { MYSTERY_URI } from "@/components/collection/MysteryArt";
import { useReveal } from "@/hooks/useReveal";
import { IdentityCell } from "@/components/ui/IdentityCell";
import { CopyAddress } from "@/components/ui/CopyAddress";
import { fetchProfiles, type Identity } from "@/lib/profiles";
import { friendlyTxError } from "@/lib/tx-errors";

export default function CollectionPage() {
  const { address: collectionAddr } = useParams<{ address: string }>();
  const { address: userAddr } = useAccount();
  const [collectionWebsite, setCollectionWebsite] = useState<string | null>(null);
  const [creatorIdentity, setCreatorIdentity] = useState<Identity | undefined>(undefined);

  useEffect(() => {
    if (!collectionAddr) return;
    const api = process.env.NEXT_PUBLIC_PROFILE_API || "";
    fetch(`${api}/api/collection/meta/${collectionAddr}`)
      .then(r => r.json())
      .then(d => { if (!d.error && d.websiteURL) setCollectionWebsite(d.websiteURL); })
      .catch(() => {});
  }, [collectionAddr]);

  const { data: mintStatus } = useReadContract({
    address: collectionAddr as `0x${string}`,
    abi: NFT_ABI,
    functionName: "getMintStatus",
    query: { refetchInterval: 5000 },
  });

  const { data: info } = useReadContract({
    address: collectionAddr as `0x${string}`,
    abi: NFT_ABI,
    functionName: "getCollectionInfo",
  });

  const { data: hasActivePhase } = useReadContract({
    address: collectionAddr as `0x${string}`,
    abi: NFT_ABI,
    functionName: "hasActivePhase",
    query: { refetchInterval: 5000 },
  });

  const { writeContractAsync } = useWriteContract();

  // Resolve the deployer's profile (username + X link) for the "Deployed by" line
  const creatorAddr = (info as any)?.creator as string | undefined;
  useEffect(() => {
    if (!creatorAddr || /^0x0+$/i.test(creatorAddr)) return;
    fetchProfiles([creatorAddr])
      .then((p) => setCreatorIdentity(p[creatorAddr.toLowerCase()]))
      .catch(() => {});
  }, [creatorAddr]);

  // Reveal state drives the mystery photo (same one used in the mystery menu)
  // until rarities unlock at sellout.
  const reveal = useReveal(collectionAddr, Boolean((info as any)?.bondingComplete));

  const [_loadedInfo, setLoadedInfo] = useState(false);
  useEffect(() => {
    if (info && mintStatus) setLoadedInfo(true);
  }, [info, mintStatus]);
  const [_notFound, setNotFound] = useState(false);
  useEffect(() => {
    if (!info || !mintStatus) {
      const t = setTimeout(() => setNotFound(true), 8000);
      return () => clearTimeout(t);
    }
  }, [info, mintStatus]);

  if (!mintStatus || !info) {
    if (_notFound) return (
      <div className="max-w-5xl mx-auto px-4 py-24 text-center">
        <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-4">NOT FOUND</p>
        <h1 className="text-2xl font-bold text-text-primary mb-2">Collection Not Found</h1>
        <p className="text-sm text-text-secondary mb-6">This collection does not exist or is from an older deployment.</p>
        <a href="/explore" className="btn-primary">Back to Explore</a>
      </div>
    );
    return (
      <div className="max-w-7xl mx-auto px-4 py-24">
        <div className="animate-pulse space-y-8">
          <div className="h-12 bg-panel w-1/3" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="aspect-square bg-panel" />
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 bg-panel" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const [isOpen, isScheduled, startTime, endTime, minted, remaining, bonded] = mintStatus;
  const mintedNum = Number(minted);
  const remainingNum = Number(remaining);
  // Collection size = what has minted plus what is still mintable. Drives the
  // bonding progress against the real supply (collections run 10 to 10,000).
  const totalSupply = mintedNum + remainingNum;
  const bondingPct = totalSupply > 0 ? Math.round((mintedNum / totalSupply) * 100) : 0;
  const soldOut = totalSupply > 0 && remainingNum <= 0;

  const mintPriceETH = formatEther(info.mintPrice);
  const totalMintCost = info.mintPrice + info.platformFeeETH;

  // For timed reveals (24h/7d) the art itself stays hidden behind the mystery
  // photo until reveal. Instant collections show their art right away.
  const hideArt = !reveal.revealed && reveal.timing !== "instant";
  const coverUri = hideArt ? (reveal.placeholderURI || MYSTERY_URI) : (info.photoURIs[0] || "");

  const handleTriggerOpen = async () => {
    try {
      await writeContractAsync({
        address: collectionAddr as `0x${string}`,
        abi: NFT_ABI,
        functionName: "triggerMintOpen",
      });
      toast.success("Mint opened!");
    } catch (err: any) {
      toast.error(friendlyTxError(err, "Transaction failed"));
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-12">
      {/* Top grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
        {/* Left: Cover */}
        <div className="relative">
          <div className="aspect-[4/3] sm:aspect-square bg-surface border border-border overflow-hidden">
            {coverUri ? (
              <IpfsImage
                uri={coverUri}
                alt={info.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <span
                  className="text-6xl text-accent/20"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {info.name[0]}
                </span>
              </div>
            )}

            {/* Status overlay */}
            <div className="absolute top-4 left-4 flex gap-2">
              {bonded ? (
                <span className="badge border-line bg-ink text-white">Bonded</span>
              ) : (isOpen || hasActivePhase) ? (
                <span className="badge border-line bg-white/90 text-accent backdrop-blur-sm flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse" />
                  MINTING LIVE
                </span>
              ) : isScheduled ? (
                <span className="badge border-line bg-white/90 text-sky-600 backdrop-blur-sm">Scheduled</span>
              ) : (
                <span className="badge border-line bg-white/90 text-text-secondary backdrop-blur-sm">Not started</span>
              )}
            </div>
          </div>

          {/* Photo strip, visible only after reveal, Mythic (index 5) hidden */}
          {reveal.revealed && (
            <div className="grid grid-cols-5 gap-1 mt-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className={`aspect-square bg-surface border overflow-hidden ${
                    i < info.photoCount ? "border-border/60" : "border-transparent opacity-20"
                  }`}
                >
                  {info.photoURIs[i] && (
                    <IpfsImage
                      uri={info.photoURIs[i]}
                      alt={`photo-${i}`}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Info + Mint */}
        <div className="flex flex-col gap-6">
          {/* Name + ticker */}
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "clamp(2rem,5vw,3rem)",
                  letterSpacing: "0.04em",
                }}
              >
                {info.name}
              </h1>
              <span className="badge border-amber/40 text-accent text-xs">${info.ticker}</span>
            </div>
            <p className="font-body text-sm text-text-secondary leading-relaxed">{info.bio}</p>
            {creatorAddr && (
              <div className="flex items-center gap-2 mt-3">
                <span className="text-[10px] font-semibold text-text-dim uppercase tracking-wide">Deployed by</span>
                <IdentityCell address={creatorAddr} identity={creatorIdentity} linkToProfile />
              </div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] font-semibold text-text-dim uppercase tracking-wide">Contract</span>
              <CopyAddress address={collectionAddr} title="Copy collection address" className="text-xs text-text-dim" />
            </div>
          </div>

          {/* Social links */}
          <div className="flex flex-wrap gap-4">
            {collectionWebsite && (
              <a href={/^https?:\/\//.test(collectionWebsite) ? collectionWebsite : `https://${collectionWebsite}`}
                target="_blank" rel="noreferrer"
                className="text-xs font-medium text-text-dim hover:text-accent transition-colors">
                Website
              </a>
            )}
            {info.socialX && (
              <a href={`https://x.com/${info.socialX.replace("@", "")}`} target="_blank" rel="noreferrer"
                className="text-xs font-medium text-text-dim hover:text-accent transition-colors">
                X/{info.socialX}
              </a>
            )}
            {info.socialGithub && (
              <a href={`https://github.com/${info.socialGithub}`} target="_blank" rel="noreferrer"
                className="text-xs font-medium text-text-dim hover:text-accent transition-colors">
                GH/{info.socialGithub}
              </a>
            )}
            {info.socialFarcaster && (
              <a href={`https://warpcast.com/${info.socialFarcaster.replace("@", "")}`} target="_blank" rel="noreferrer"
                className="text-xs font-medium text-text-dim hover:text-accent transition-colors">
                FC/{info.socialFarcaster}
              </a>
            )}
          </div>

          {/* Bonding progress */}
          <div className="card">
            <div className="flex justify-between text-xs mb-3">
              <span className="text-accent font-semibold uppercase tracking-wide">BONDING CURVE</span>
              <span className="font-mono text-text-primary">{mintedNum}/{totalSupply}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden mb-3">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${bondingPct}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
                className={`h-full ${bonded ? "bg-amber" : "bg-amber/60"}`}
              />
            </div>
            <div className="flex justify-between text-[10px] text-text-dim">
              <span>{bondingPct}% filled</span>
              <span>{Number(remaining)} remaining</span>
            </div>
          </div>

          {/* Mint price */}
          <div className="card">
            <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-3">MINT PRICE</p>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-text-dim">Creator price</span>
                <span className="font-mono text-text-primary">
                  {mintPriceETH === "0" ? "FREE" : `${mintPriceETH} ETH`}
                </span>
              </div>
              {totalMintCost > BigInt(0) && (
                <div className="flex justify-between text-xs border-t border-border pt-2 mt-2">
                  <span className="text-accent font-semibold">TOTAL</span>
                  <span className="font-mono text-accent font-semibold">{formatEther(totalMintCost)} ETH</span>
                </div>
              )}
            </div>
          </div>

          {/* Countdown if scheduled */}
          {isScheduled && !isOpen && Number(startTime) > 0 && (
            <div className="card">
              <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-3">OPENS IN</p>
              <MintCountdown
                startTime={Number(startTime)}
                onExpired={handleTriggerOpen}
              />
            </div>
          )}

          {/* TTL countdown */}
          {isOpen && Number(endTime) > 0 && (
            <div className="card">
              <p className="text-xs font-semibold text-down uppercase tracking-wide mb-3">CLOSING IN</p>
              <MintCountdown startTime={0} endTime={Number(endTime)} isEnd />
            </div>
          )}

          {/* Mint button */}
          {!bonded && (
            <MintButton
              collectionAddress={collectionAddr as `0x${string}`}
              mintCost={totalMintCost}
              isOpen={!!(isOpen || hasActivePhase)}
              isSoldOut={soldOut}
              disabled={(!isOpen && !hasActivePhase) || soldOut}
              supplyRemaining={remainingNum}
            />
          )}

          {/* Token link post-bonding, compact, content-width navigation CTA
              (NOT a full-width button), centered under the Mint Price card. */}
          {bonded && info.tokenAddress && info.tokenAddress !== "0x0000000000000000000000000000000000000000" && (
            <div className="flex justify-center">
              <a
                href={`/token/${info.tokenAddress}`}
                className="inline-flex items-center justify-center gap-1.5 font-semibold text-sm text-white rounded-xl transition-all duration-200 active:scale-95"
                style={{
                  minWidth: 140, maxWidth: 220, height: 42, padding: "0 22px",
                  background: "linear-gradient(135deg, #00C805 0%, #00953F 100%)",
                  boxShadow: "0 4px 14px rgba(0,200,5,0.3)",
                }}
              >
                Trade Token
                <span aria-hidden>&rarr;</span>
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Live mint feed, who just minted. Only relevant while minting; once the
          collection bonds it auto-disappears and the NFT marketplace below takes
          over. */}
      {!bonded && (
        <div className="mb-8 border-t border-border pt-8">
          <div className="card max-w-2xl">
            <div className="flex items-center gap-2 mb-4">
              <p className="text-xs font-semibold text-accent uppercase tracking-wide">LIVE MINTS</p>
              <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
            </div>
            <div className="max-h-80 overflow-y-auto pr-1">
              <LiveMintFeed collectionAddress={collectionAddr as `0x${string}`} />
            </div>
          </div>
        </div>
      )}

      {/* Pre-reveal we hide rarities behind the mystery photo (no odds/percent).
          After sellout reveal we show the exact final breakdown. */}
      {info && !(Number(startTime) > 0 && Date.now() / 1000 - Number(startTime) > 86400) && (
        <div className="mb-8">
          <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-4">
            {reveal.revealed ? "RARITY BREAKDOWN" : "RARITY"}
          </p>
          {reveal.revealed ? (
            <RarityBar revealed />
          ) : (
            <div className="card flex flex-col sm:flex-row items-center gap-5">
              <IpfsImage
                uri={reveal.placeholderURI || MYSTERY_URI}
                alt="Mystery"
                className="w-40 h-40 rounded-xl object-cover border border-border flex-shrink-0"
              />
              <div className="text-center sm:text-left">
                <p className="text-sm font-semibold text-text-primary mb-1">Rarities hidden</p>
                <p className="text-xs text-text-secondary leading-relaxed">
                  Every NFT stays a mystery until the collection sells out. Rarities are shuffled
                  and revealed the moment it does.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pre-bonding: your NFTs (sell back to pool) */}
      {!bonded && <OwnedPreBondingGrid collectionAddress={collectionAddr as `0x${string}`} />}

      {/* NFT Grid, post bonding marketplace */}
      {bonded && (
        <div className="mt-12">
          <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-4">MARKETPLACE</p>
          <NFTGrid collectionAddress={collectionAddr as `0x${string}`} bonded={Boolean(bonded)} />
        </div>
      )}

      {/* Vault status if token exists */}
      {bonded && info.tokenAddress && info.tokenAddress !== "0x0000000000000000000000000000000000000000" && (
        <div className="mt-12">
          <VaultStatus tokenAddress={info.tokenAddress as `0x${string}`} creator={(info as any).creator} />
          {info && mintStatus && (
            <CreatorPanel
              collectionAddress={collectionAddr as `0x${string}`}
              creator={(info as any).creator}
              mintPrice={(info as any).mintPrice as bigint}
              minted={Number((mintStatus as any)[4] ?? 0)}
              bonded={!!(info as any).bondingComplete}
            />
          )}
        </div>
      )}
    </div>
  );
}
