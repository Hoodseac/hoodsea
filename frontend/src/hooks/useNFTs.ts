// src/hooks/useNFTs.ts
import { usePublicClient } from "wagmi";
import { useState, useEffect } from "react";
import { NFT_ABI } from "@/lib/contracts";

export interface NFTItem {
  tokenId: number;
  owner: string;
  rarity: number;
  listPrice: bigint;
  imageURI: string;
}

const ZERO = "0x0000000000000000000000000000000000000000";

const TOKEN_OWNER_ABI = [
  { name: "tokenOwner", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ type: "address" }] },
] as const;
const TOKEN_LIST_PRICE_ABI = [
  { name: "tokenListPrice", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

export function useNFTsInCollection(collectionAddress: `0x${string}`) {
  const [nfts, setNFTs] = useState<NFTItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const client = usePublicClient();

  useEffect(() => {
    if (!client || !collectionAddress) return;

    const fetchNFTs = async () => {
      setIsLoading(true);
      try {
        // Enumerate tokenId 1..minted directly (supply is capped at 100). The old
        // approach scanned NFTMinted events over a 45k-block window (~25h on Base),
        // so any collection that bonded/minted earlier than that showed an EMPTY
        // grid (rarity + listed/unlisted all gone). Reading state by id works at any
        // collection age and is the same call volume as before.
        let mintedCount = 0;
        try {
          const status = await client.readContract({
            address: collectionAddress,
            abi: NFT_ABI,
            functionName: "getMintStatus",
          });
          mintedCount = Number((status as any)[4] ?? 0); // [isOpen,,startTime,,minted,,bonded]
        } catch {}
        const count = Math.min(Math.max(mintedCount, 0), 100);
        const tokenIds = Array.from({ length: count }, (_, i) => i + 1);

        const itemsRaw = await Promise.all(
          tokenIds.map(async (tokenId): Promise<NFTItem | null> => {
            // The NFTMinted event always carries a Common placeholder, real
            // rarity only exists post-sellout via getRarity().
            const [owner, listPrice, imageURI, rarityRaw] = await Promise.all([
              client.readContract({
                address: collectionAddress,
                abi: TOKEN_OWNER_ABI,
                functionName: "tokenOwner",
                args: [BigInt(tokenId)],
              }).catch(() => ZERO as string),

              client.readContract({
                address: collectionAddress,
                abi: TOKEN_LIST_PRICE_ABI,
                functionName: "tokenListPrice",
                args: [BigInt(tokenId)],
              }).catch(() => BigInt(0)),

              client.readContract({
                address: collectionAddress,
                abi: NFT_ABI,
                functionName: "uri",
                args: [BigInt(tokenId)],
              }).catch(() => ""),

              client.readContract({
                address: collectionAddress,
                abi: NFT_ABI,
                functionName: "getRarity",
                args: [BigInt(tokenId)],
              }).catch(() => 0),
            ]);

            // Skip ids that were never minted (no owner).
            const ownerStr = String(owner);
            if (!ownerStr || /^0x0+$/i.test(ownerStr)) return null;

            return {
              tokenId,
              owner: ownerStr,
              rarity: Number(rarityRaw),
              listPrice: listPrice as bigint,
              imageURI: imageURI as string,
            };
          })
        );

        setNFTs(itemsRaw.filter((x): x is NFTItem => x !== null));
      } catch (err) {
        console.error("Failed to fetch NFTs:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchNFTs();
  }, [client, collectionAddress]);

  return { nfts, isLoading };
}
