import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Hoodsea, the NFT and token launchpad on Robinhood Chain";

// Branded social-preview card, generated at build/edge time. Ivory paper, an
// ink tile with the green breaking-wave mark, near-black wordmark, lime glow:
// the same visual language as the site.
export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "#F4F7EC",
          backgroundImage:
            "radial-gradient(60% 60% at 78% 12%, rgba(206,246,6,0.55), transparent 70%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <svg width="96" height="96" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="14" fill="#050600" />
            <path
              d="M10 27 C18 19 28 19 34 25 C40 31 50 31 56 24 L56 34 C48 41 38 41 32 35 C26 29 17 29 10 36 Z"
              fill="#00C805"
            />
            <path
              d="M10 43 C18 36 28 36 34 41 C40 46 48 46 54 41"
              fill="none"
              stroke="#00C805"
              strokeWidth="4.2"
              strokeLinecap="round"
            />
          </svg>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "#050600",
              color: "#ffffff",
              padding: "10px 20px",
              borderRadius: 999,
              fontSize: 26,
              fontWeight: 700,
            }}
          >
            <div style={{ width: 14, height: 14, borderRadius: 999, background: "#00C805" }} />
            Live on Robinhood Chain
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ display: "flex", fontSize: 108, fontWeight: 800, color: "#050600", letterSpacing: -3 }}>
            Hoodsea
          </div>
          <div style={{ display: "flex", fontSize: 42, fontWeight: 600, color: "#4b5563", maxWidth: 900 }}>
            Launch into the deep. Surface with a token.
          </div>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          {["Free to mint", "Liquidity locked for good", "Airdrops every epoch"].map((t) => (
            <div
              key={t}
              style={{
                display: "flex",
                background: "#ffffff",
                border: "1px solid rgba(5,6,0,0.1)",
                color: "#050600",
                padding: "10px 22px",
                borderRadius: 999,
                fontSize: 26,
                fontWeight: 600,
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    ),
    size
  );
}
