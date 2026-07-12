import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { ErrorCatch } from "./error-catch";
import { Navbar } from "@/components/layout/Navbar";
import { TestnetBanner } from "@/components/layout/TestnetBanner";
import { NetworkGuard } from "@/components/layout/NetworkGuard";
import { LaunchGate } from "@/components/launch/LaunchGate";
import { Toaster } from "react-hot-toast";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

// No live domain in committed files: the deploy sets NEXT_PUBLIC_SITE_URL.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
// Marketing-landing host (optional). When set, requests on this host render the
// landing chrome instead of the app shell. Unset = everything is the app.

export const metadata: Metadata = {
  // Resolves all relative OG/Twitter image URLs against the deployed domain,
  // so shared links on X/Telegram/Discord render the preview.
  metadataBase: new URL(SITE_URL),
  title: "Hoodsea",
  description:
    "Free-mint a collection on Robinhood Chain. It sells out, bonds, and surfaces as a token with liquidity locked for good. On-chain the whole way down.",
  // Favicon is auto-wired from src/app/icon.png (Next file-convention).
  // OG/Twitter images come from src/app/opengraph-image.tsx (generated,
  // branded card); Next wires the meta tags automatically.
  openGraph: {
    type: "website",
    title: "Hoodsea",
    description: "Free-mint collections that bond into tokens on Robinhood Chain. Liquidity locked for good.",
    siteName: "Hoodsea",
  },
  twitter: {
    card: "summary_large_image",
    title: "Hoodsea",
    description: "Free-mint collections that bond into tokens on Robinhood Chain. Liquidity locked for good.",
  },
  // TODO(farcaster): the fc:miniapp / fc:frame embeds were OriginPad-specific.
  // Re-enable once Hoodsea has its own Mini App domain + FID, e.g.:
  // other: {
  //   "fc:miniapp": JSON.stringify({
  //     version: "1",
  //     imageUrl: `${SITE_URL}/embed.png`,
  //     button: {
  //       title: "Open Hoodsea",
  //       action: { type: "launch_miniapp", name: "Hoodsea", url: SITE_URL },
  //     },
  //   }),
  // },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The landing has its own chrome, so skip the app's Navbar there. The
  // middleware rewrites the marketing paths (/, /docs, /news) to /landing and
  // flags them with x-hoodsea-landing, so the browser URL stays clean.
  const isLandingDomain = headers().get("x-hoodsea-landing") === "1";

  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body><ErrorCatch />
        <Providers>
          <LaunchGate>
            <div className={isLandingDomain ? "min-h-screen" : "relative min-h-screen"}>
              {!isLandingDomain && <TestnetBanner />}
              {!isLandingDomain && <NetworkGuard />}
              {!isLandingDomain && <Navbar />}
              <main className={isLandingDomain ? "" : ""}>{children}</main>
            </div>
          </LaunchGate>
          <Toaster
            position="top-center"
            toastOptions={{
              style: {
                background: "#ffffff",
                border: "1px solid rgba(5,6,0,0.08)",
                color: "#050600",
                borderRadius: "9999px",
                boxShadow: "0 2px 4px rgba(5,6,0,0.04), 0 24px 44px -22px rgba(5,6,0,0.16)",
                fontSize: "13px",
              },
              success: {
                iconTheme: { primary: "#00C805", secondary: "#ffffff" },
              },
              error: {
                icon: null,
                style: {
                  background: "#ffffff",
                  border: "1px solid rgba(255,73,74,0.3)",
                  color: "#FF494A",
                  borderRadius: "12px",
                  fontSize: "13px",
                },
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
