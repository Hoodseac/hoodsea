"use client";

const TIERS = [
  { name: "Common", pct: "40-70%", color: "#6b7280", cap: 70 },
  { name: "Uncommon", pct: "15-30%", color: "#22c55e", cap: 30 },
  { name: "Rare", pct: "5-15%", color: "#3b82f6", cap: 15 },
  { name: "Epic", pct: "1-5%", color: "#a855f7", cap: 5 },
  { name: "Legendary", pct: "~1%", color: "#f59e0b", cap: 1 },
  { name: "Mythic", pct: "3 fixed", color: "#ec4899", cap: 3 },
];

interface Props {
  photoCount: number;
}

export function RarityPreview({ photoCount }: Props) {
  return (
    <div className="card">
      <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-4">RARITY DISTRIBUTION</p>
      <div className="space-y-2">
        {TIERS.map((tier, i) => {
          const active = i < photoCount;
          return (
            <div
              key={tier.name}
              className={`flex items-center justify-between gap-2 py-2 border-b border-border last:border-0 transition-opacity ${
                active ? "opacity-100" : "opacity-30"
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: tier.color, boxShadow: `0 0 6px ${tier.color}` }}
                />
                <span className="text-xs font-semibold truncate" style={{ color: tier.color }}>
                  {tier.name.toUpperCase()}
                </span>
                {i === photoCount - 1 && photoCount >= 3 && (
                  <span className="text-[10px] font-semibold text-mythic flex-shrink-0">TOKEN PHOTO</span>
                )}
              </div>
              <div className="flex items-center gap-2 sm:gap-4 font-mono text-xs text-text-dim flex-shrink-0">
                <span>max {tier.cap}</span>
                <span>{tier.pct}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-text-dim mt-3">
        Each photo you add unlocks a rarity tier. Tiers without photos are excluded.
      </p>
    </div>
  );
}
