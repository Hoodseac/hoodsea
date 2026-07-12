// src/hooks/useCollections.ts
import { useReadContract, usePublicClient } from "wagmi";
import { useState, useEffect } from "react";
import { CONTRACTS, LAUNCHPAD_ABI, NFT_ABI } from "@/lib/contracts";
import { formatEther } from "viem";
import { resolveReveal } from "@/lib/reveal";

const API = process.env.NEXT_PUBLIC_PROFILE_API || "";

export interface CollectionMeta {
  address: string;
  name: string;
  ticker: string;
  bio: string;
  /** Cover already resolved for reveal: real art when shown, mystery photo while hidden */
  coverPhoto: string;
  minted: number;
  /** collection size (minted + remaining); collections run 10 to 10,000 */
  supply?: number;
  bonded: boolean;
  mintOpen: boolean;
  startTime: number;
  mintPrice: string;
  tokenAddress: string | null;
  creator: string;
  /** true once rarities/art are unlocked (instant, or past the 24h/7d window) */
  revealed: boolean;
}

export function useRecentCollections(limit = 20) {
  const [collections, setCollections] = useState<CollectionMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const client = usePublicClient();

  const { data: allAddresses } = useReadContract({
    address: CONTRACTS.launchpad,
    abi: LAUNCHPAD_ABI,
    functionName: "getAllCollections",
  });

  useEffect(() => {
    if (!allAddresses || !client) return;

    const fetchAll = async () => {
      setIsLoading(true);
      const results: CollectionMeta[] = [];

      // Drop collections delisted from the launchpad (off-chain moderation).
      // The contract still exists on-chain; it just disappears from the UI.
      let hidden = new Set<string>();
      try {
        const r = await fetch(`${API}/api/moderation`);
        if (r.ok) { const d = await r.json(); hidden = new Set((d.hidden || []).map((a: string) => String(a).toLowerCase())); }
      } catch {}

      // Fetch last 20 visible collections
      const recent = [...allAddresses]
        .filter((a) => !hidden.has(String(a).toLowerCase()))
        .reverse()
        .slice(0, limit);

      await Promise.allSettled(
        recent.map(async (addr) => {
          try {
            const [info, mintStatus] = await Promise.all([
              client.readContract({
                address: addr,
                abi: NFT_ABI,
                functionName: "getCollectionInfo",
              }),
              client.readContract({
                address: addr,
                abi: NFT_ABI,
                functionName: "getMintStatus",
              }),
            ]);

            const [isOpen, , startTime, , minted, remaining, bonded] = mintStatus as any;
            let hasActive = false;
            try { hasActive = await client.readContract({ address: addr, abi: NFT_ABI, functionName: "hasActivePhase" }) as boolean; } catch {}

            // Resolve the cover against reveal timing so cards never leak the
            // art for 24h/7d collections before their reveal window passes.
            const realCover = (info as any).photoURIs?.[0] || "";
            const { cover: coverPhoto, revealed } = await resolveReveal(addr, bonded as boolean, realCover);

            results.push({
              address: addr,
              name: (info as any).name,
              ticker: (info as any).ticker,
              bio: (info as any).bio,
              coverPhoto,
              minted: Number(minted),
              supply: Number(minted) + Number(remaining),
              bonded: bonded as boolean,
              mintOpen: hasActive || (isOpen as boolean),
              startTime: Number(startTime),
              mintPrice: formatEther((info as any).mintPrice),
              tokenAddress: ((info as any).tokenAddress && (info as any).tokenAddress !== "0x0000000000000000000000000000000000000000") ? (info as any).tokenAddress : null,
              creator: (info as any).creator,
              revealed,
            });
          } catch {
            // skip failed reads
          }
        })
      );

      setCollections(results);
      setIsLoading(false);
    };

    fetchAll();
  }, [allAddresses, client, limit]);

  return { collections, isLoading };
}

export function useCreatorCollections(address: `0x${string}` | undefined) {
  const { data: creatorAddresses } = useReadContract({
    address: CONTRACTS.launchpad,
    abi: LAUNCHPAD_ABI,
    functionName: "getCreatorCollections",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  return { addresses: creatorAddresses || [] };
}
