// Airdrop eligibility API (the random-participant selection published by the
// oracle: 100 random participants per epoch, picked off-chain, merkle claim
// unchanged). Schedule (epoch times, executed, allocation) is read on-chain
// separately; this module only covers the off-chain selection.

const API = process.env.NEXT_PUBLIC_PROFILE_API || "";

export interface AirdropRecipient {
  address: string;
  amount: string; // token wei
  loss: string; // eth wei
}

export interface AirdropStanding {
  token: string;
  totalLoss: string;
  recipientCount: number;
  recipients: AirdropRecipient[];
  updatedAt: number;
  epochs?: Record<string, { frozenAt: number; recipientCount: number; recipients: AirdropRecipient[] }>;
}

export interface AirdropSummary {
  token: string;
  recipientCount: number;
  totalLoss: string;
  updatedAt: number;
  frozenEpochs: string[];
}

export interface EligibilityResult {
  eligible: boolean;
  rank: number | null;
  amount: string; // token wei
  loss?: string;
  totalRecipients?: number;
  updatedAt?: number;
  reason?: string;
}

export async function fetchAirdropList(): Promise<AirdropSummary[]> {
  try {
    const r = await fetch(`${API}/api/airdrop/list`, { cache: "no-store" });
    if (!r.ok) return [];
    const data = await r.json();
    return data.airdrops || [];
  } catch {
    return [];
  }
}

export async function fetchAirdropStanding(token: string): Promise<AirdropStanding | null> {
  try {
    const r = await fetch(`${API}/api/airdrop/token/${token}`, { cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function checkEligibility(token: string, address: string): Promise<EligibilityResult> {
  try {
    const r = await fetch(`${API}/api/airdrop/check/${token}/${address}`, { cache: "no-store" });
    if (!r.ok) return { eligible: false, rank: null, amount: "0", reason: "Lookup failed" };
    return await r.json();
  } catch {
    return { eligible: false, rank: null, amount: "0", reason: "Network error" };
  }
}

// ─── Claim-based airdrop (cumulative merkle) ──────────────────────────────────
export interface MyClaim {
  token: string;
  root: string;
  amount: string;      // cumulative token wei this wallet is entitled to
  proof: `0x${string}`[];
  updatedAt: number;
}

// Every token this wallet has a cumulative allocation on. The on-chain claimed()
// is read separately to show the still-claimable delta.
export async function fetchMyClaims(address: string): Promise<MyClaim[]> {
  try {
    const r = await fetch(`${API}/api/airdrop/claim/${address}`, { cache: "no-store" });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.claims || []) as MyClaim[];
  } catch {
    return [];
  }
}

// Epoch schedule labels (days after lockVault)
export const EPOCH_DAYS = [1, 7, 14, 28, 56];

export function formatEpochDate(epochTimeSec: bigint | number): string {
  const ms = Number(epochTimeSec) * 1000;
  if (!ms) return "TBD";
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });
}

export function epochCountdown(epochTimeSec: bigint | number): string {
  const target = Number(epochTimeSec) * 1000;
  if (!target) return "TBD"; // epoch unset until vault lock; don't say "ready"
  const diff = target - Date.now();
  if (diff <= 0) return "ready";
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  if (d > 0) return `in ${d}d ${h}h`;
  const m = Math.floor((diff % 3600000) / 60000);
  return `in ${h}h ${m}m`;
}
