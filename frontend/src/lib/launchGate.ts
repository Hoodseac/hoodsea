// Public testnet launch gate.
// Until LAUNCH_TS the entire site shows only the countdown portal. The team can
// bypass it with a preview key (?preview=<key>), persisted in localStorage.
// Both values can be overridden via env; sensible defaults below.

// 2026-06-17 00:00:00 UTC
export const LAUNCH_TS = Number(process.env.NEXT_PUBLIC_LAUNCH_TS) || Date.UTC(2026, 5, 17, 0, 0, 0);

// Secret that unlocks a preview. Kept in .env.local (gitignored) so it is not in
// the public repo. Note: NEXT_PUBLIC vars are still readable in the shipped JS
// bundle, so this gates casual visitors, not a determined snooper.
export const PREVIEW_KEY = process.env.NEXT_PUBLIC_PREVIEW_KEY || "";

export const PREVIEW_FLAG = "og_preview";
