"use client";

import { motion } from "framer-motion";
import { useRecentCollections } from "@/hooks/useCollections";

export function LiveTicker() {
  const { collections } = useRecentCollections();

  const events = collections.length > 0
    ? collections.flatMap((col) => {
        const items: string[] = [];
        if (col.bonded) {
          items.push(`$${col.ticker} sold out and bonded`);
          if (col.tokenAddress) items.push(`$${col.ticker} token deployed`);
        } else if (col.minted > 0) {
          items.push(`${col.minted} minted from ${col.name}`);
        } else {
          items.push(`${col.name} launched`);
        }
        return items;
      })
    : ["Hoodsea, NFT and token launchpad on Robinhood Chain"];

  const items = [...events, ...events, ...events];

  return (
    <div className="border-y border-border bg-muted py-2.5 overflow-hidden select-none">
      <motion.div
        animate={{ x: ["0%", "-33.33%"] }}
        transition={{ duration: Math.max(events.length * 5, 20), repeat: Infinity, ease: "linear" }}
        className="flex whitespace-nowrap"
      >
        {items.map((event, i) => (
          <span key={i} className="text-xs text-text-secondary mx-8">
            <span className="text-accent mr-2">◆</span>
            {event}
          </span>
        ))}
      </motion.div>
    </div>
  );
}
