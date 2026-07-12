"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import type { CollectionMeta } from "@/hooks/useCollections";
import { IpfsImage } from "@/components/ui/IpfsImage";

function timeAgo(unix: number): string {
  if (!unix || unix <= 0) return "";
  const secs = Math.floor(Date.now() / 1000) - unix;
  if (secs < 0) return "";
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return `${Math.floor(secs / 604800)}w ago`;
}

// Compact live countdown ("2d 4h", "5h 12m", "12m 30s") until a unix time.
function CompactCountdown({ target }: { target: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const iv = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);
  const d = Math.max(0, target - now);
  const days = Math.floor(d / 86400);
  const hrs = Math.floor((d % 86400) / 3600);
  const mins = Math.floor((d % 3600) / 60);
  const secs = d % 60;
  const text = days > 0 ? `${days}d ${hrs}h` : hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m ${secs}s`;
  return <>{text}</>;
}

interface Props {
  collection: CollectionMeta;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold tabular-nums tracking-tight text-ink">{value}</p>
    </div>
  );
}

export function CollectionCard({ collection }: Props) {
  const router = useRouter();
  const total = collection.supply && collection.supply > 0 ? collection.supply : collection.minted;
  const bondingPct = total > 0 ? Math.round((collection.minted / total) * 100) : 0;
  const isBonded = collection.bonded;
  const isUpcoming = !isBonded && !collection.mintOpen && collection.startTime > 1000000 && collection.startTime * 1000 > Date.now();

  return (
    <Link href={`/collection/${collection.address}`}>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="card card-hover group h-full cursor-pointer p-0 overflow-hidden"
      >
        {/* Cover photo */}
        <div className="relative aspect-[4/3] overflow-hidden bg-paper">
          {collection.coverPhoto ? (
            <IpfsImage
              uri={collection.coverPhoto}
              alt={collection.name}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-ink/90">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hoodsea-logo.png" alt={collection.name} className="h-12 w-12 opacity-90" />
            </div>
          )}

          {/* Status chip */}
          {isBonded ? (
            <span className="absolute right-3 top-3 rounded-full bg-ink px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm">
              Bonded
            </span>
          ) : collection.mintOpen ? (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 shadow-sm backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
              <span className="text-[10px] font-semibold text-accent">Minting</span>
            </span>
          ) : isUpcoming ? (
            <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 shadow-sm backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
              <span className="text-[10px] font-semibold tabular-nums text-sky-600">
                In <CompactCountdown target={collection.startTime} />
              </span>
            </span>
          ) : null}
        </div>

        {/* Info */}
        <div className="p-5">
          <div className="mb-1.5 flex items-start justify-between gap-2">
            <h3 className="truncate text-base font-bold leading-tight tracking-tight text-ink">
              {collection.name}
            </h3>
            <span className="shrink-0 text-xs font-semibold text-text-secondary">${collection.ticker}</span>
          </div>

          <p className="mb-4 line-clamp-2 text-xs leading-relaxed text-text-secondary">
            {collection.bio}
          </p>

          {/* 3-col stat grid */}
          <div className="grid grid-cols-3 gap-3 border-t border-line pt-3">
            <Stat
              label="Mint"
              value={collection.mintPrice === "0" ? "Free" : `${collection.mintPrice} ETH`}
            />
            <Stat label="Holders" value={String(collection.minted)} />
            <Stat
              label="Age"
              value={collection.startTime > 0 && timeAgo(collection.startTime) ? timeAgo(collection.startTime).replace(" ago", "") : "-"}
            />
          </div>

          {/* Bonding progress */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] font-medium text-text-secondary">
              <span>Bonding</span>
              <span className="font-bold tabular-nums text-ink">{collection.minted}/{total}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink/5">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${bondingPct}%` }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                className="grad h-full rounded-full"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="mt-4 flex items-center justify-between">
            {collection.mintOpen && !isBonded ? (
              <button
                onClick={(e) => { e.preventDefault(); router.push(`/collection/${collection.address}`); }}
                className="btn-primary btn-sm"
              >
                Mint
              </button>
            ) : collection.tokenAddress ? (
              <span className="rounded-full bg-mint px-2.5 py-1 text-[10px] font-semibold text-accent">
                Token live
              </span>
            ) : (
              <span />
            )}
            <span className="text-sm font-bold text-ink transition-transform group-hover:translate-x-0.5">
              View
            </span>
          </div>
        </div>
      </motion.div>
    </Link>
  );
}
