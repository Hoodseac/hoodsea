// Share links point at the deployed origin (env-driven; no live domain in
// committed files). When a link is cast on Farcaster, the per-campaign
// fc:miniapp embed (see /airdrops/c/[id] metadata) can render a launch button
// once the Mini App is registered for Hoodsea.
export const APP_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

export function campaignUrl(id: number): string {
  const origin =
    APP_ORIGIN || (typeof window !== "undefined" ? window.location.origin : "");
  return `${origin}/airdrops/c/${id}`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older / insecure contexts
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

// Inside a Mini App, use the native composer (stays in-app and pre-fills the
// embed). In a normal browser, open the Warpcast web composer instead.
export async function shareToFarcaster(text: string, url: string): Promise<void> {
  try {
    // Lazy-load the SDK only when the user actually shares, so it never weighs
    // down the initial bundle of the campaign pages.
    const { sdk } = await import("@farcaster/miniapp-sdk");
    const inMini = await sdk.isInMiniApp().catch(() => false);
    if (inMini) {
      await sdk.actions.composeCast({ text, embeds: [url] });
      return;
    }
  } catch {
    /* fall through to web composer */
  }
  const intent = `https://warpcast.com/~/compose?text=${encodeURIComponent(text)}&embeds[]=${encodeURIComponent(url)}`;
  window.open(intent, "_blank", "noopener,noreferrer");
}
