"use client";

import Link from "next/link";
import { IpfsImage } from "@/components/ui/IpfsImage";
import { CopyAddress } from "@/components/ui/CopyAddress";
import { shortAddr, type Identity } from "@/lib/profiles";
import type { CollectionMeta } from "@/hooks/useCollections";

// Featured collections, swipeable left/right (native scroll-snap = smooth on
// touch). Hoodsea look: rounded-2xl, sea accent, glass chips. Structure
// borrows from a marketplace hero (cover + name + "By creator" + quick stats)
// but the styling stays on-brand, not an OpenSea clone.
export function HeroCarousel({ items, identities }: { items: CollectionMeta[]; identities: Record<string, Identity> }) {
  if (!items.length) return null;
  return (
    <div className="mb-8 -mx-4 px-4">
      <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-2">
        {items.map((c) => {
          const id = identities[(c.creator || "").toLowerCase()];
          const creatorAddr = c.creator || "";
          return (
            <Link
              key={c.address}
              href={`/collection/${c.address}`}
              className="snap-center shrink-0 w-[88%] sm:w-[460px] relative rounded-2xl overflow-hidden border border-border group shadow-sm"
            >
              <div className="aspect-[16/9] w-full bg-border relative">
                {c.coverPhoto && (
                  <IpfsImage
                    uri={c.coverPhoto}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
              </div>
              <div className="absolute bottom-0 left-0 right-0 p-5 text-white">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-2xl font-bold drop-shadow-sm truncate">{c.name}</h3>
                  {c.bonded && (
                    <span className="text-[10px] font-bold bg-sea text-ink px-2 py-0.5 rounded-full flex-shrink-0">BONDED</span>
                  )}
                </div>
                <p className="text-sm text-white/85 mb-3 truncate flex items-center gap-1">
                  <span>By</span>
                  {id?.username ? (
                    <span className="truncate">{id.username}</span>
                  ) : creatorAddr ? (
                    <CopyAddress address={creatorAddr} display={shortAddr(creatorAddr)} title="Copy creator address" iconSize={11} className="text-white/85" />
                  ) : (
                    <span>—</span>
                  )}
                </p>
                <div className="flex items-center gap-2 text-xs">
                  <span className="bg-white/15 backdrop-blur-sm px-3 py-1 rounded-full font-medium">{c.minted} minted</span>
                  <span className="bg-white/15 backdrop-blur-sm px-3 py-1 rounded-full font-mono">{Number(c.mintPrice)} ETH</span>
                  {c.mintOpen && !c.bonded && (
                    <span className="flex items-center gap-1 bg-white/15 backdrop-blur-sm px-3 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse" /> live
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
