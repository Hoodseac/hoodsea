// Mystery placeholder for unrevealed NFTs (OpenSea-style reveal).
// Origin-themed: floating stone island in the lavender sky, matching the landing.

export const MYSTERY_URI = "/landing/mystery.webp";

export function MysteryArt({ className = "" }: { className?: string }) {
  return <img src={MYSTERY_URI} alt="Unrevealed NFT" loading="lazy" decoding="async" className={className} />;
}
