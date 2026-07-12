"use client";

// The whole app's connect UX lives here. `ConnectProvider` renders one shared
// modal and exposes `open()` through context; `useAuth().login` calls it. The
// picker lists the real external wallets we wired in wagmi (browser-injected,
// Coinbase, and WalletConnect when enabled). If only one option makes sense we
// connect straight away with no picker; on mobile with no injected wallet we
// jump to WalletConnect when it is available.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import type { Connector } from "wagmi";
import { motion, AnimatePresence } from "framer-motion";

interface ConnectCtx {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const Ctx = createContext<ConnectCtx>({ open: () => {}, close: () => {}, isOpen: false });

export function useConnectModal() {
  return useContext(Ctx);
}

// External wallet connectors we present in the picker, in display order. The
// Farcaster Mini App connector is intentionally excluded, it auto-connects
// inside a Farcaster host and is inert in a normal browser.
type Kind = "injected" | "coinbaseWallet" | "walletConnect";
const KIND_META: Record<Kind, { label: string; sub: string }> = {
  injected: { label: "Browser wallet", sub: "MetaMask, Rabby, Brave and other extensions" },
  coinbaseWallet: { label: "Coinbase Wallet", sub: "Coinbase's self-custody wallet" },
  walletConnect: { label: "WalletConnect", sub: "Scan with a mobile wallet" },
};

const hasInjectedWallet = () =>
  typeof window !== "undefined" && !!(window as any).ethereum;
const isMobile = () =>
  typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Presentable options from the configured connectors, in a stable order.
function presentable(connectors: readonly Connector[]) {
  const pick = (t: Kind) => connectors.find((c) => c.type === t);
  const out: { kind: Kind; connector: Connector }[] = [];
  const inj = pick("injected");
  // Only surface the injected option when a wallet is actually present, an empty
  // "Browser wallet" tile that fails on click is worse than hiding it.
  if (inj && hasInjectedWallet()) out.push({ kind: "injected", connector: inj });
  const cb = pick("coinbaseWallet");
  if (cb) out.push({ kind: "coinbaseWallet", connector: cb });
  const wc = pick("walletConnect");
  if (wc) out.push({ kind: "walletConnect", connector: wc });
  return out;
}

function WalletIcon({ kind }: { kind: Kind }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "coinbaseWallet") {
    return <svg {...common}><circle cx="12" cy="12" r="9" /><rect x="9" y="9" width="6" height="6" rx="1.2" /></svg>;
  }
  if (kind === "walletConnect") {
    return <svg {...common}><path d="M6 9c3.3-3.2 8.7-3.2 12 0" /><path d="M9 12c1.7-1.6 4.3-1.6 6 0" /><line x1="12" y1="15" x2="12" y2="15.01" /></svg>;
  }
  // injected / browser
  return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /><circle cx="6" cy="6.5" r="0.5" fill="currentColor" /></svg>;
}

export function ConnectProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const { isConnected } = useAccount();
  const { connect, connectors, isPending, variables, error, reset } = useConnect();

  const options = useMemo(() => presentable(connectors), [connectors]);

  const close = useCallback(() => { setIsOpen(false); reset(); }, [reset]);

  const open = useCallback(() => {
    reset();
    const wc = connectors.find((c) => c.type === "walletConnect");
    // Mobile with no injected wallet: WalletConnect is the only thing that works,
    // skip the picker and go straight to the QR / deep-link flow.
    if (isMobile() && !hasInjectedWallet() && wc) { connect({ connector: wc }); return; }
    const opts = presentable(connectors);
    // Exactly one real option: connect without making the user choose.
    if (opts.length === 1) { connect({ connector: opts[0].connector }); return; }
    // No presentable option (e.g. desktop, no extension, WC disabled): fall back
    // to the injected connector, which will prompt the user to install a wallet.
    if (opts.length === 0) {
      const inj = connectors.find((c) => c.type === "injected");
      if (inj) { connect({ connector: inj }); return; }
    }
    setIsOpen(true);
  }, [connect, connectors, reset]);

  // Close automatically once a wallet connects.
  useEffect(() => { if (isConnected) setIsOpen(false); }, [isConnected]);

  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-ink/25 backdrop-blur-sm"
              onClick={close}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 10 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="card relative w-full max-w-sm !p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={close}
                className="absolute right-4 top-4 text-text-dim hover:text-text-primary text-lg leading-none"
                aria-label="Close"
              >
                ×
              </button>

              <h2 className="text-lg font-bold text-text-primary mb-1">Connect a wallet</h2>
              <p className="text-sm text-text-secondary mb-5">
                Choose how you want to connect to Hoodsea.
              </p>

              <div className="space-y-2">
                {options.map(({ kind, connector }) => {
                  const meta = KIND_META[kind];
                  const busy = isPending && variables?.connector === connector;
                  return (
                    <button
                      key={connector.uid}
                      onClick={() => connect({ connector })}
                      disabled={isPending}
                      className="w-full flex items-center gap-3 rounded-full border border-border bg-surface px-4 py-3 text-left hover:border-ink/30 transition-colors disabled:opacity-50"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-panel text-ink">
                        <WalletIcon kind={kind} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-text-primary">{meta.label}</span>
                        <span className="block text-[11px] text-text-secondary truncate">{meta.sub}</span>
                      </span>
                      {busy && <span className="text-[11px] font-medium text-text-dim">Connecting…</span>}
                    </button>
                  );
                })}
              </div>

              {error && (
                <p className="mt-3 text-xs text-down">
                  {/reject|denied|cancel/i.test(error.message)
                    ? "Connection cancelled."
                    : "Could not connect. Try another wallet."}
                </p>
              )}

              <p className="mt-4 text-center text-[11px] text-text-dim">
                Non-custodial. Hoodsea never holds your keys.
              </p>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}
