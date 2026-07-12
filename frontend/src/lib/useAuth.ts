"use client";

import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@/components/ui/ConnectModal";

// Single entry point for the connect / disconnect UX across the app. The public
// shape is unchanged from the old Privy version so no consumer breaks:
//   login()        -> opens the in-app wallet picker (or connects directly)
//   logout()       -> disconnects the active wallet
//   ready          -> wagmi is always initialised client-side
//   authenticated  -> a wallet is currently connected
export function useAuth() {
  const { isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { open } = useConnectModal();
  return {
    ready: true,
    authenticated: isConnected,
    login: open,
    logout: () => {
      try { disconnect(); } catch {}
    },
  };
}
