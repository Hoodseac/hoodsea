"use client";

import { useEffect, useRef } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { ACTIVE_CHAIN } from "@/lib/contracts";

// Blocking banner shown when a connected wallet is on the wrong network.
// Hoodsea contracts only exist on Robinhood Chain. Sending funds or
// transactions from any other chain is a dead-end (the address has no contract
// there), so we surface a clear prompt and a one-click switch instead of
// letting writes fire on the wrong chain.
//
// On top of the banner, we auto-prompt the wallet to switch to Robinhood Chain
// as soon as a wrong-chain connection is detected. If the user rejects, the
// banner stays as a manual fallback; we only auto-prompt once per wrong chain
// so a rejection does not loop.
export function NetworkGuard() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending } = useSwitchChain();
  const autoTriedFor = useRef<number | null>(null);

  useEffect(() => {
    if (!isConnected || chainId === ACTIVE_CHAIN.id) {
      autoTriedFor.current = null; // reset so a future wrong chain re-prompts
      return;
    }
    if (autoTriedFor.current === chainId) return; // already prompted for this chain
    autoTriedFor.current = chainId;
    try {
      switchChain({ chainId: ACTIVE_CHAIN.id });
    } catch {
      /* user can still use the manual button below */
    }
  }, [isConnected, chainId, switchChain]);

  if (!isConnected || chainId === ACTIVE_CHAIN.id) return null;

  return (
    <div className="w-full border-b border-down/30 bg-down/10 text-[12px]">
      <div className="mx-auto max-w-page px-6 py-2 flex items-center justify-center gap-3 text-center flex-wrap">
        <span className="text-text-secondary">
          <span className="font-semibold text-down">Wrong network.</span>{" "}
          Hoodsea runs on <span className="font-semibold text-ink">{ACTIVE_CHAIN.name}</span>. Switch
          networks before sending any transaction, or your funds may be lost.
        </span>
        <button
          onClick={() => switchChain({ chainId: ACTIVE_CHAIN.id })}
          disabled={isPending}
          className="btn-danger-solid btn-sm flex-shrink-0"
        >
          {isPending ? "Switching..." : `Switch to ${ACTIVE_CHAIN.name}`}
        </button>
      </div>
    </div>
  );
}
