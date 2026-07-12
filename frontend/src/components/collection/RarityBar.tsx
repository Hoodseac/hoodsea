// ─── RarityBar.tsx ────────────────────────────────────────────────────────────
// Rarity is assigned all at once at sellout (anti-snipe shuffle), so there is
// no live "minted per rarity" counter. Pre-reveal we show the fixed odds;
// post-reveal the exact final distribution (always 46/30/15/5/1/3 of 100).
"use client";
import { motion } from "framer-motion";

const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
const RARITY_COLORS = ["#6b7280", "#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#ec4899"];
const RARITY_DISTRIBUTION = [46, 30, 15, 5, 1, 3]; // must match contract rarityDistribution

interface RarityBarProps {
  revealed: boolean;
}

export function RarityBar({ revealed }: RarityBarProps) {
  return (
    <div className="card">
      <div className="space-y-3">
        {RARITY_NAMES.map((name, i) => {
          const n = RARITY_DISTRIBUTION[i];
          return (
            <div key={name}>
              <div className="flex justify-between gap-2 text-xs mb-1">
                <span className="font-semibold truncate" style={{ color: RARITY_COLORS[i] }}>{name.toUpperCase()}</span>
                <span className="font-mono text-text-dim flex-shrink-0">{revealed ? `${n}/100` : `${n}%`}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${n}%` }}
                  transition={{ duration: 0.8, delay: i * 0.05 }}
                  style={{ background: RARITY_COLORS[i] }}
                  className="h-full"
                />
              </div>
            </div>
          );
        })}
      </div>
      {!revealed && (
        <p className="mt-3 text-[11px] text-text-dim">
          Rarities are shuffled and revealed when the collection sells out.
        </p>
      )}
    </div>
  );
}
