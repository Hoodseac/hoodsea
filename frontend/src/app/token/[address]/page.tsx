"use client";

import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import { useReadContract, useWriteContract } from "wagmi";
import { formatUnits } from "viem";
import Link from "next/link";
import toast from "react-hot-toast";
import { TOKEN_ABI, CONTRACTS, FEE_HOOK_ABI, poolIdFor } from "@/lib/contracts";
import { explorerToken } from "@/lib/chain";
import { friendlyTxError } from "@/lib/tx-errors";
import { ClaimFees } from "@/components/token/ClaimFees";
import { VaultStatus } from "@/components/token/VaultStatus";
import { SwapBox } from "@/components/token/SwapBox";
import { PriceChart } from "@/components/token/PriceChart";
import { RecentTrades } from "@/components/token/RecentTrades";
import { TopHolders } from "@/components/token/TopHolders";
import { UnclaimedFee } from "@/components/token/UnclaimedFee";
import { IpfsImage } from "@/components/ui/IpfsImage";
import { CopyAddress } from "@/components/ui/CopyAddress";

export default function TokenPage() {
  const { address: tokenAddr } = useParams<{ address: string }>();
  const [creatorUsername, setCreatorUsername] = useState<string | null>(null);
  const [creatorTwitter, setCreatorTwitter] = useState<string | null>(null);
  const [websiteURL, setWebsiteURL] = useState<string | null>(null);

  const { data: tokenInfo, isLoading } = useReadContract({
    address: tokenAddr as `0x${string}`,
    abi: TOKEN_ABI,
    functionName: "getTokenInfo",
  });

  useEffect(() => {
    const nftCol = (tokenInfo as any)?.[5];
    if (!nftCol) return;
    const api = process.env.NEXT_PUBLIC_PROFILE_API || "";
    fetch(`${api}/api/collection/meta/${nftCol}`)
      .then(r => r.json())
      .then(d => { if (!d.error && d.websiteURL) setWebsiteURL(d.websiteURL); })
      .catch(() => {});
  }, [tokenInfo]);

  useEffect(() => {
    const creator_ = (tokenInfo as any)?.[4];
    if (!creator_) return;
    const api = process.env.NEXT_PUBLIC_PROFILE_API || "";
    fetch(`${api}/api/profile/${creator_}`)
      .then(r => r.json())
      .then(d => { if (!d.error && d.username) { setCreatorUsername(d.username); if (d.twitter) setCreatorTwitter(d.twitter); } })
      .catch(() => {});
  }, [tokenInfo]);

  const { data: feeBpsRaw } = useReadContract({
    address: CONTRACTS.feeHook,
    abi: FEE_HOOK_ABI,
    functionName: "poolFeeBps",
    args: [poolIdFor(tokenAddr as `0x${string}`)],
    query: { enabled: !!tokenAddr },
  });
  const feeBps = feeBpsRaw && (feeBpsRaw as bigint) > 0n ? Number(feeBpsRaw as bigint) : 150;
  const feePct = feeBps / 100;
  const splitPct = (bps: number) => `${((feePct * bps) / 150).toFixed(2)}%`;

  const { data: totalSupply } = useReadContract({
    address: tokenAddr as `0x${string}`,
    abi: TOKEN_ABI,
    functionName: "totalSupply",
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-page px-6 py-24">
        <div className="animate-pulse space-y-6">
          <div className="h-16 w-1/2 rounded-2xl bg-ink/5" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="aspect-square rounded-3xl bg-ink/5" />
            <div className="space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-8 rounded-xl bg-ink/5" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!tokenInfo) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-text-dim">Token not found</p>
      </div>
    );
  }

  const [name, symbol, image, bio, creator, nftCollection, deployedAt, vaultLocked] =
    tokenInfo;
  // A token on this page is already bonded, so its V4 pool is live and tradeable.
  const trading = true;

  const deployedDate = new Date(Number(deployedAt) * 1000);
  const supplyFormatted = totalSupply
    ? Number(formatUnits(totalSupply, 18)).toLocaleString()
    : "-";

  return (
    <div className="mx-auto max-w-page px-6 py-10">
      {/* Back to collection */}
      <Link
        href={`/collection/${nftCollection}`}
        className="mb-8 inline-block text-xs font-medium text-text-secondary transition-colors hover:text-ink"
      >
        Back to NFT collection
      </Link>

      {/* Hero */}
      <div className="mb-10 grid grid-cols-1 gap-8 md:grid-cols-2">
        {/* Token image */}
        <div className="relative">
          <div className="card relative aspect-[4/3] overflow-hidden p-0 sm:aspect-square">
            {image ? (
              <IpfsImage
                uri={image}
                alt={name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <span className="text-6xl font-bold tracking-tight text-brand/30">
                  {symbol[0]}
                </span>
              </div>
            )}

            {/* Mythic badge */}
            <div className="absolute left-4 top-4">
              <span className="badge border-line bg-white/90 text-mythic backdrop-blur-sm">
                Mythic photo
              </span>
            </div>
          </div>
          <ClaimFees token={tokenAddr as `0x${string}`} />
        </div>

        {/* Info */}
        <div className="flex flex-col gap-5">
          <div>
            <div className="mb-1 flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{name}</h1>
              <span className="badge border-line bg-mint text-accent">${symbol}</span>
            </div>
            <p className="text-sm leading-relaxed text-text-secondary">{bio}</p>
          </div>

          {/* Contract address, prominent + click-to-copy, next to the explorer link */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Contract</span>
            <CopyAddress
              address={tokenAddr}
              short={false}
              iconSize={14}
              title="Copy contract address"
              className="max-w-full break-all text-sm text-ink"
            />
          </div>

          {/* Market links (Blockscout explorer) */}
          <div className="flex flex-wrap gap-2">
            <a
              href={explorerToken(tokenAddr)}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary rounded-full px-4 py-1.5 text-xs font-semibold"
            >
              Blockscout
            </a>
          </div>

          {/* Social links */}
          <div className="flex flex-wrap gap-4">
            {(tokenInfo as any)?.socialX && (
              <a
                href={`https://x.com/${(tokenInfo as any).socialX.replace("@", "")}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-text-secondary transition-colors hover:text-ink"
              >
                X
              </a>
            )}
            {(tokenInfo as any)?.socialGithub && (
              <a
                href={`https://github.com/${(tokenInfo as any).socialGithub}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-text-secondary transition-colors hover:text-ink"
              >
                GitHub
              </a>
            )}
            {(tokenInfo as any)?.socialFarcaster && (
              <a
                href={`https://warpcast.com/${(tokenInfo as any).socialFarcaster.replace("@", "")}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-text-secondary transition-colors hover:text-ink"
              >
                Farcaster
              </a>
            )}
            {websiteURL && (
              <a
                href={websiteURL}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-text-secondary transition-colors hover:text-ink"
              >
                Website
              </a>
            )}
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              { label: "Total supply", value: supplyFormatted },
              { label: "Deployed", value: deployedDate.toLocaleDateString() },
              { label: "Trading", value: trading ? "Live" : "Not yet" },
              { label: "Vault locked", value: vaultLocked ? "Yes" : "Pending 24h" },
              {
                label: "Contract",
                value: `${tokenAddr.slice(0, 6)}...${tokenAddr.slice(-4)}`,
                addr: tokenAddr,
              },
              {
                label: "Creator",
                value: creatorUsername || `${(creator as string).slice(0, 6)}...${(creator as string).slice(-4)}`,
                twitter: creatorTwitter,
                // A resolved username is not an address, so only copy the raw form.
                addr: creatorUsername ? undefined : (creator as string),
              },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-line bg-white/70 p-3">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
                  {stat.label}
                </p>
                {(stat as any).twitter ? (
                  <a
                    href={`https://twitter.com/${(stat as any).twitter.replace("@","")}`}
                    target="_blank" rel="noreferrer"
                    className="font-mono text-sm text-accent hover:underline"
                  >
                    {stat.value}
                  </a>
                ) : (stat as any).addr ? (
                  <CopyAddress
                    address={(stat as any).addr}
                    display={stat.value}
                    title={stat.label === "Contract" ? "Copy contract address" : "Copy creator address"}
                    className="text-sm tabular-nums text-ink"
                  />
                ) : (
                <p
                  className={`font-mono text-sm tabular-nums ${
                    stat.label === "Trading" && trading
                      ? "font-semibold text-brand"
                      : "text-ink"
                  }`}
                >
                  {stat.value}
                </p>
                )}
              </div>
            ))}
          </div>

          {/* Vault lock CTA */}
          {!vaultLocked && (
            <VaultLockButton
              tokenAddress={tokenAddr as `0x${string}`}
              deployedAt={Number(deployedAt)}
            />
          )}
        </div>
      </div>

      {/* Two-column market section: chart + activity left, trade panel right. */}
      {trading && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
          <div className="min-w-0 space-y-6">
            <div className="card">
              <div className="mb-4 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Price chart</p>
                <a
                  href={explorerToken(tokenAddr)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-medium text-text-secondary hover:text-ink"
                >
                  Explorer
                </a>
              </div>
              <PriceChart token={tokenAddr as `0x${string}`} symbol={symbol} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <RecentTrades token={tokenAddr as `0x${string}`} />
              <TopHolders token={tokenAddr as `0x${string}`} />
            </div>
          </div>

          {/* Trade panel */}
          <div className="lg:sticky lg:top-20 h-fit">
            <SwapBox token={tokenAddr as `0x${string}`} symbol={symbol} />
          </div>
        </div>
      )}

      {/* Vault status */}
      <VaultStatus tokenAddress={tokenAddr as `0x${string}`} />

      {/* Fee breakdown reminder */}
      <div className="card mt-8">
        <p className="mb-4 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Token economics</p>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <p className="mb-3 text-xs font-medium text-text-secondary">Trading fee ({feePct.toFixed(1)}% buy + sell)</p>
            <div className="space-y-1.5">
              {[
                { label: "Creator", value: splitPct(100), color: "#00953F" },
                { label: "Platform", value: splitPct(20), color: "#6b7280" },
                { label: "Airdrop vault", value: splitPct(10), color: "#00C805" },
                { label: "Maintenance", value: splitPct(20), color: "#6b7280" },
              ].map((f) => (
                <div key={f.label} className="flex justify-between text-xs">
                  <span className="text-text-secondary">{f.label}</span>
                  <span className="font-mono tabular-nums" style={{ color: f.color }}>{f.value}</span>
                </div>
              ))}
            </div>
            {/* Live, public unclaimed fee (drops to $0 when distributed, grows again
                as new trades accrue fees). Reads the splitter balance on-chain. */}
            <div className="mt-3 border-t border-line pt-3">
              <UnclaimedFee token={tokenAddr as `0x${string}`} />
            </div>
          </div>
          <div>
            <p className="mb-3 text-xs font-medium text-text-secondary">Vault allocation (50% locked)</p>
            <div className="space-y-1.5">
              {[
                { label: "Airdrop (100 random participants)", value: "5%", color: "#00C805" },
                { label: "Burn (over 56 days)", value: "45%", color: "#FF494A" },
              ].map((f) => (
                <div key={f.label} className="flex justify-between text-xs">
                  <span className="text-text-secondary">{f.label}</span>
                  <span className="font-mono tabular-nums" style={{ color: f.color }}>{f.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Vault Lock Button ────────────────────────────────────────────────────────
function VaultLockButton({
  tokenAddress,
  deployedAt,
}: {
  tokenAddress: `0x${string}`;
  deployedAt: number;
}) {
  const { writeContractAsync, isPending } = useWriteContract();
  const now = Math.floor(Date.now() / 1000);
  const canLock = now >= deployedAt + 86400;
  const unlockIn = deployedAt + 86400 - now;
  const hrs = Math.floor(unlockIn / 3600);
  const mins = Math.floor((unlockIn % 3600) / 60);

  const handleLock = async () => {
    try {
      toast.loading("Locking vault...", { id: "vault" });
      await writeContractAsync({
        address: tokenAddress,
        abi: TOKEN_ABI,
        functionName: "lockVault",
      });
      toast.success("Vault locked. 50% of supply secured.", { id: "vault" });
    } catch (err: any) {
      toast.error(friendlyTxError(err, "Lock failed"), { id: "vault" });
    }
  };

  if (!canLock) {
    return (
      <div className="card py-4 text-center">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Vault locks in</p>
        <p className="text-2xl font-bold tabular-nums tracking-tight text-ink">
          {hrs}h {mins}m
        </p>
      </div>
    );
  }

  return (
    <button
      onClick={handleLock}
      disabled={isPending}
      className="btn-primary w-fit"
    >
      {isPending ? "Locking..." : "Lock vault now"}
    </button>
  );
}
