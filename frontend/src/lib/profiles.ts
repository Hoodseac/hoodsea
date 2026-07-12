// Batch-resolve wallet addresses to profile identities (username + X handle)
// via the profile API. Used by the leaderboard and anywhere we list addresses.

export interface Identity {
  username: string | null;
  twitter: string | null;
  twitterVerified?: boolean;
  avatar: string | null;
  website?: string | null;
  bio?: string | null;
}

const API = process.env.NEXT_PUBLIC_PROFILE_API || "";

export async function fetchProfiles(addresses: string[]): Promise<Record<string, Identity>> {
  const uniq = Array.from(new Set(addresses.map((a) => a.toLowerCase()))).filter(Boolean);
  if (uniq.length === 0) return {};
  try {
    const res = await fetch(`${API}/api/profile/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addresses: uniq }),
    });
    if (!res.ok) return {};
    return (await res.json()) as Record<string, Identity>;
  } catch {
    return {};
  }
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// Normalize a stored twitter value (handle or URL) to a clean @handle + URL.
export function twitterLink(twitter: string | null | undefined): { handle: string; url: string } | null {
  if (!twitter) return null;
  let h = twitter.trim();
  h = h.replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, "").replace(/^@/, "").replace(/\/+$/, "");
  if (!h) return null;
  return { handle: h, url: `https://x.com/${h}` };
}
