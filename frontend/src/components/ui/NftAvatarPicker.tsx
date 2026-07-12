"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { useRecentCollections } from "@/hooks/useCollections";
import { NFT_ABI } from "@/lib/contracts";
import { IpfsImage } from "./IpfsImage";

// Scrollable grid of the collections the connected wallet holds, so a user can
// pick one of their NFTs' art as their profile picture. Uses the reveal-aware
// cover from useRecentCollections (mystery art stays hidden until reveal).
export function NftAvatarPicker({ owner, onPick }: { owner: string; onPick: (img: string) => void }) {
  const { collections } = useRecentCollections();
  const client = usePublicClient();
  const [held, setHeld] = useState<{ address: string; name: string; cover: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!client || !owner || !collections.length) { setLoading(false); return; }
    let on = true;
    (async () => {
      setLoading(true);
      const out: { address: string; name: string; cover: string }[] = [];
      await Promise.allSettled(
        collections.map(async (c: any) => {
          try {
            const bal = await client.readContract({
              address: c.address as `0x${string}`, abi: NFT_ABI, functionName: "balanceOf", args: [owner as `0x${string}`],
            });
            if (Number(bal) > 0 && c.coverPhoto) out.push({ address: c.address, name: c.name, cover: c.coverPhoto });
          } catch {}
        })
      );
      if (on) { setHeld(out); setLoading(false); }
    })();
    return () => { on = false; };
  }, [client, owner, collections]);

  if (loading) {
    return <p className="text-xs text-text-dim text-center py-6">Loading your NFTs…</p>;
  }
  if (held.length === 0) {
    return <p className="text-xs text-text-dim text-center py-6">You don't hold any NFTs yet.</p>;
  }

  return (
    <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto pr-1">
      {held.map((h) => (
        <button
          key={h.address}
          onClick={() => onPick(h.cover)}
          className="aspect-square rounded-lg overflow-hidden border border-border hover:border-amber transition-colors"
          title={h.name}
        >
          <IpfsImage uri={h.cover} alt={h.name} className="w-full h-full object-cover" />
        </button>
      ))}
    </div>
  );
}
