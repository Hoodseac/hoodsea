"use client";

import { useState } from "react";
import { motion } from "framer-motion";

// Shown right after a wallet connects, before the user can use the app or set a
// profile. Acceptance is stored in localStorage so it's asked once per browser.
export function TermsModal({ onAccept, onDecline }: { onAccept: () => void; onDecline: () => void }) {
  const [agree, setAgree] = useState(false);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink/25 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6"
      >
        <h2 className="text-xl font-bold text-text-primary mb-1" style={{ fontFamily: "var(--font-display)" }}>
          Terms of Service
        </h2>
        <p className="text-sm text-text-secondary mb-4">
          Please read and accept before using Hoodsea.
        </p>

        <div className="h-56 overflow-y-auto border border-border rounded-xl p-4 text-xs text-text-secondary leading-relaxed space-y-2.5">
          <p>By using Hoodsea you confirm that you understand and agree to the following:</p>
          <p><b className="text-text-primary">1. No financial advice.</b> Nothing on this platform is financial, investment, legal or tax advice. You are solely responsible for your decisions.</p>
          <p><b className="text-text-primary">2. Risk.</b> Crypto assets are volatile and can lose all value. NFTs and tokens launched here may have no value. Only interact with funds you can afford to lose.</p>
          <p><b className="text-text-primary">3. Testnet.</b> While running on a testnet, all assets are valueless test tokens with no monetary worth.</p>
          <p><b className="text-text-primary">4. Smart contracts.</b> The platform's guarantees (locked liquidity, vault schedule, fees) are enforced by on-chain contracts provided "as is", without warranty. Code may contain bugs.</p>
          <p><b className="text-text-primary">5. Your responsibility.</b> You are responsible for the security of your wallet and for complying with the laws of your jurisdiction. Hoodsea does not custody your funds.</p>
          <p><b className="text-text-primary">6. No unlawful use.</b> You will not use Hoodsea for fraud, market manipulation, money laundering or any illegal activity.</p>
          <p><b className="text-text-primary">7. Content.</b> Creators are responsible for the collections they launch. Hoodsea may delist content at its discretion.</p>
          <p>By continuing you accept these Terms of Service and the Privacy Policy.</p>
        </div>

        <label className="flex items-start gap-2 mt-4 cursor-pointer">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
          <span className="text-xs text-text-secondary">I have read and agree to the Terms of Service and Privacy Policy.</span>
        </label>

        <button onClick={onAccept} disabled={!agree} className="btn-primary btn-block mt-4">
          Agree and continue
        </button>
        <button onClick={onDecline} className="w-full text-sm text-text-secondary hover:text-text-primary transition-colors py-2 mt-1">
          Decline and disconnect
        </button>
      </motion.div>
    </div>
  );
}
