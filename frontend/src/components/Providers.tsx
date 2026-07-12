"use client";
import { useEffect } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "framer-motion";
import { wagmiConfig } from "@/lib/wagmi";
import { ConnectProvider } from "@/components/ui/ConnectModal";
import { sdk } from "@farcaster/miniapp-sdk";

const queryClient = new QueryClient();

// Saat app dibuka sebagai Farcaster Mini App, host (Warpcast/Base App) nampilin
// splash sampai kita panggil ready(). Panggil LANGSUNG tanpa guard isInMiniApp:
// deteksi isInMiniApp bisa gagal/beda antar klien (mis. Base App) -> kalau di-guard,
// ready() gak ke-panggil -> user mentok loading. Di browser biasa ready() no-op/
// reject yang ketangkep catch, jadi aman. Retry sekali buat handle race host-init.
function MiniAppReady() {
  useEffect(() => {
    let done = false;
    const fire = async () => { try { await sdk.actions.ready(); done = true; } catch {} };
    fire();
    const t = setTimeout(() => { if (!done) fire(); }, 1200);
    return () => clearTimeout(t);
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // Plain wagmi provider (external wallets only, no Privy). WagmiProvider owns
    // the connectors defined in lib/wagmi.ts and feeds every existing wagmi hook.
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {/* ConnectProvider renders the shared wallet picker that useAuth().login
            opens; it must sit inside Wagmi + Query so it can use those hooks. */}
        <ConnectProvider>
          {/* reducedMotion="user": when the device/OS asks for reduced motion (incl.
              battery-saver modes common on low-end phones), framer-motion renders
              animations statically, no infinite loops eating CPU/GPU. */}
          <MotionConfig reducedMotion="user">
            <MiniAppReady />
            {children}
          </MotionConfig>
        </ConnectProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
