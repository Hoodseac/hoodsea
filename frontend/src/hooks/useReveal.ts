// src/hooks/useReveal.ts
// Creator-chosen reveal timing (instant / 24h / 7d after sellout) lives in the
// profile API, not on-chain. This hook resolves whether photos+rarity may be
// shown yet, and timestamps bondedAt the first time anyone sees the
// collection bonded (idempotent server-side).
import { useState, useEffect } from "react";

const API = process.env.NEXT_PUBLIC_PROFILE_API || "";

const DELAY_MS: Record<string, number> = {
  instant: 0,
  "24h": 24 * 3600 * 1000,
  "7d": 7 * 24 * 3600 * 1000,
};

export interface RevealStatus {
  /** true when rarity + photos may be displayed */
  revealed: boolean;
  /** unix ms when reveal unlocks (null = unknown / already revealed) */
  revealAt: number | null;
  timing: string;
  /** creator-supplied mystery image (ipfs:// or https), "" = use default art */
  placeholderURI: string;
  isLoading: boolean;
}

export function useReveal(collectionAddress: string | undefined, bonded: boolean): RevealStatus {
  const [status, setStatus] = useState<RevealStatus>({ revealed: false, revealAt: null, timing: "instant", placeholderURI: "", isLoading: true });

  useEffect(() => {
    if (!collectionAddress) return;
    let cancelled = false;
    (async () => {
      let meta: any = null;
      try {
        const r = await fetch(`${API}/api/collection/meta/${collectionAddress}`);
        if (r.ok) meta = await r.json();
      } catch {}
      try {
        if (bonded && (!meta || !meta.bondedAt)) {
          const r2 = await fetch(`${API}/api/collection/bonded/${collectionAddress}`, { method: "POST" });
          if (r2.ok) meta = (await r2.json()).meta;
        }
      } catch {}
      if (cancelled) return;

      const timing = meta?.revealTiming && DELAY_MS[meta.revealTiming] !== undefined ? meta.revealTiming : "instant";
      const placeholderURI = typeof meta?.unrevealedURI === "string" ? meta.unrevealedURI : "";
      if (!bonded) {
        // Pre-sellout nothing is revealed regardless of timing
        setStatus({ revealed: false, revealAt: null, timing, placeholderURI, isLoading: false });
        return;
      }
      // No meta reachable -> fail open (instant) so a dead API can never hide NFTs forever
      const revealAt = meta?.bondedAt ? meta.bondedAt + DELAY_MS[timing] : 0;
      const update = () => {
        const revealed = Date.now() >= revealAt;
        setStatus({ revealed, revealAt: revealed ? null : revealAt, timing, placeholderURI, isLoading: false });
        return revealed;
      };
      if (!update()) {
        const iv = setInterval(() => { if (update()) clearInterval(iv); }, 30_000);
        return () => clearInterval(iv);
      }
    })();
    return () => { cancelled = true; };
  }, [collectionAddress, bonded]);

  return status;
}

export function formatRevealCountdown(revealAt: number): string {
  const ms = Math.max(0, revealAt - Date.now());
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
