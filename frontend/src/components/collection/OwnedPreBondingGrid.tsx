"use client";

import { useAccount } from "wagmi";
import Link from "next/link";
import { useNFTsInCollection } from "@/hooks/useNFTs";
import { MYSTERY_URI } from "./MysteryArt";

// Pre-bonding view of the NFTs the connected wallet owns in this collection.
// Rarity is hidden until sellout, so cards stay as the mystery placeholder and
// link to the detail page where the owner can sell back to the pool (-50%).
export function OwnedPreBondingGrid({ collectionAddress }: { collectionAddress: `0x${string}` }) {
  const { address } = useAccount();
  const { nfts, isLoading } = useNFTsInCollection(collectionAddress);

  if (!address) return null;
  const owned = nfts.filter((n) => n.owner?.toLowerCase() === address.toLowerCase());

  if (isLoading || owned.length === 0) return null;

  return (
    <div className="mt-12">
      <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-2">YOUR NFTS</p>
      <p className="text-[11px] text-text-dim mb-3">
        Sell back before bonding returns 50% of the pool share. Tap an NFT to sell.
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
        {owned.map((nft) => (
          <Link key={nft.tokenId} href={`/nft/${collectionAddress}/${nft.tokenId}`}
            className="border border-border bg-panel rounded-xl overflow-hidden group relative">
            <div className="aspect-square overflow-hidden bg-surface">
              <img src={MYSTERY_URI} alt={`NFT #${nft.tokenId}`} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
            </div>
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="font-mono text-[10px] text-text-dim">#{nft.tokenId}</span>
              <span className="text-[9px] font-semibold text-down">SELL</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
