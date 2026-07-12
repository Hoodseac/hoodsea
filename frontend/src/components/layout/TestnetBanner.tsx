"use client";

import { useEffect, useState } from "react";
import { IS_TESTNET } from "@/lib/contracts";

// Slim, dismissible banner shown only when the app runs against a testnet so
// public testers know there are no real funds involved. Hoodsea on Robinhood
// Chain is mainnet, so this renders nothing there; the plumbing stays for any
// future test deployment.
export function TestnetBanner() {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (!IS_TESTNET) return;
    setHidden(localStorage.getItem("hs_testnet_banner_dismissed") === "1");
  }, []);

  if (!IS_TESTNET || hidden) return null;

  const dismiss = () => {
    localStorage.setItem("hs_testnet_banner_dismissed", "1");
    setHidden(true);
  };

  return (
    <div className="w-full border-b border-line bg-mint text-[11px] sm:text-xs">
      <div className="mx-auto max-w-page px-6 py-1.5 flex items-center justify-center gap-3 text-center">
        <span className="text-text-secondary">
          <span className="font-semibold text-ink">Testnet.</span> No real funds.{" "}
          <a href="/feedback" className="font-semibold text-ink underline underline-offset-2 hover:opacity-80">
            Send feedback
          </a>
        </span>
        <button
          onClick={dismiss}
          aria-label="Dismiss testnet notice"
          className="text-text-dim hover:text-ink flex-shrink-0"
        >
          x
        </button>
      </div>
    </div>
  );
}
