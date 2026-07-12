import type { Metadata } from "next";
import { CampaignDetail } from "@/components/airdrop/CampaignDetail";

// Env-driven origin; no live domain in committed files.
const APP_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");

// Per-campaign metadata. The Farcaster fc:miniapp / fc:frame embeds were
// OriginPad-specific; the plumbing stays below as a marked TODO until Hoodsea
// registers its own Mini App (domain + FID).
export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const id = params.id;
  const url = APP_ORIGIN ? `${APP_ORIGIN}/airdrops/c/${id}` : undefined;
  // TODO(farcaster): re-enable once the Hoodsea Mini App exists, e.g.:
  // const miniapp = {
  //   version: "1",
  //   imageUrl: `${APP_ORIGIN}/embed.png`,
  //   button: { title: "Claim airdrop", action: { type: "launch_miniapp", name: "Hoodsea", url } },
  // };
  return {
    title: `Airdrop #${id} on Hoodsea`,
    description: "Claim this token airdrop on Hoodsea.",
    openGraph: {
      title: `Airdrop #${id} on Hoodsea`,
      description: "Claim this token airdrop on Hoodsea.",
      ...(url ? { url } : {}),
    },
    // other: { "fc:miniapp": JSON.stringify(miniapp), "fc:frame": ... },
  };
}

export default function Page({ params }: { params: { id: string } }) {
  return <CampaignDetail id={Number(params.id)} />;
}
