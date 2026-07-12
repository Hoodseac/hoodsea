// src/lib/reveal.ts
// Single source of truth for reveal-aware cover images. Reveal timing lives
// off-chain in the profile API; for 24h/7d reveals the art stays hidden behind
// the mystery photo until the window passes, so no surface (cards, marketplace,
// portfolio, profile panel) can leak rarities before reveal.
import { useEffect, useState } from "react";

const PROFILE_API = process.env.NEXT_PUBLIC_PROFILE_API || "";
const REVEAL_DELAY_MS: Record<string, number> = { instant: 0, "24h": 86400000, "7d": 604800000 };
const MYSTERY = "/landing/mystery.webp";

export async function resolveReveal(
  address: string,
  bonded: boolean,
  realCover: string,
): Promise<{ cover: string; revealed: boolean }> {
  let timing = "instant";
  let bondedAt: number | null = null;
  let unrevealed = "";
  try {
    const meta = await fetch(`${PROFILE_API}/api/collection/meta/${address}`).then((r) => (r.ok ? r.json() : null));
    if (meta) {
      if (meta.revealTiming && REVEAL_DELAY_MS[meta.revealTiming] !== undefined) timing = meta.revealTiming;
      bondedAt = typeof meta.bondedAt === "number" ? meta.bondedAt : null;
      if (typeof meta.unrevealedURI === "string") unrevealed = meta.unrevealedURI;
    }
  } catch {}
  const revealed = timing === "instant" ? true : !!(bonded && bondedAt && Date.now() >= bondedAt + REVEAL_DELAY_MS[timing]);
  return { cover: revealed ? realCover : unrevealed || MYSTERY, revealed };
}

// Hook for single-card components. Starts on the mystery photo so the real art
// never flashes before we know the reveal state.
export function useRevealedCover(address: string | undefined, bonded: boolean, realCover: string): string {
  const [cover, setCover] = useState(MYSTERY);
  useEffect(() => {
    if (!address) return;
    let on = true;
    resolveReveal(address, bonded, realCover)
      .then((r) => { if (on) setCover(r.cover); })
      .catch(() => {});
    return () => { on = false; };
  }, [address, bonded, realCover]);
  return cover;
}
