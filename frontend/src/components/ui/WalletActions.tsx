"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useWalletClient, usePublicClient } from "wagmi";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { motion, AnimatePresence } from "framer-motion";
import toast from "react-hot-toast";
import { friendlyTxError } from "@/lib/tx-errors";
import {
  COMMON_TOKENS, NATIVE, WETH, sendToken, swapTokens, getSwapQuote, previewBuyAmount, fetchToken,
  type TokenInfo,
} from "@/lib/walletActions";

const isNative = (a: string) => a.toLowerCase() === NATIVE.toLowerCase();
const isWethPair = (a: TokenInfo, b: TokenInfo) =>
  (isNative(a.address) && b.address.toLowerCase() === WETH.toLowerCase()) ||
  (a.address.toLowerCase() === WETH.toLowerCase() && isNative(b.address));

// Read the connected wallet's balance of a token (native or ERC-20), formatted.
function useTokenBalance(token: TokenInfo) {
  const { address } = useAccount();
  const pc = usePublicClient();
  const [bal, setBal] = useState<string>("");
  useEffect(() => {
    let alive = true;
    setBal("");
    if (!address || !pc) return;
    (async () => {
      try {
        if (isNative(token.address)) {
          const v = await pc.getBalance({ address });
          if (alive) setBal(formatUnits(v, 18));
        } else {
          const v = await pc.readContract({ address: token.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [address] });
          if (alive) setBal(formatUnits(v as bigint, token.decimals));
        }
      } catch { if (alive) setBal(""); }
    })();
    return () => { alive = false; };
  }, [address, pc, token.address, token.decimals]);
  return bal;
}

function fmt(n: string, max = 6) {
  const v = parseFloat(n || "0");
  if (!v) return "0";
  return v.toLocaleString("en-US", { maximumFractionDigits: max });
}

// Inline token selector: the common tokens plus a paste-any-address option.
function TokenSelect({ value, onChange }: { value: TokenInfo; onChange: (t: TokenInfo) => void }) {
  const pc = usePublicClient();
  const [custom, setCustom] = useState(false);
  const [addr, setAddr] = useState("");
  const [loading, setLoading] = useState(false);
  const loadCustom = async () => {
    if (!pc) return;
    setLoading(true);
    try { onChange(await fetchToken(pc, addr.trim())); setCustom(false); setAddr(""); }
    catch (e: any) { toast.error(e?.message || "Invalid token"); }
    finally { setLoading(false); }
  };
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {COMMON_TOKENS.map((t) => (
        <button key={t.symbol} onClick={() => onChange(t)}
          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${value.address === t.address ? "bg-sea text-ink" : "bg-panel text-text-secondary hover:text-accent"}`}>
          {t.symbol}
        </button>
      ))}
      {!COMMON_TOKENS.some((t) => t.address === value.address) && (
        <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-sea text-ink">{value.symbol}</span>
      )}
      {custom ? (
        <span className="flex items-center gap-1">
          <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x token address"
            className="w-36 px-2 py-1 text-xs rounded-lg border border-border bg-surface font-mono focus:outline-none focus:border-amber" />
          <button onClick={loadCustom} disabled={loading} className="text-xs font-semibold text-accent disabled:opacity-50">{loading ? "..." : "Add"}</button>
        </span>
      ) : (
        <button onClick={() => setCustom(true)} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-panel text-text-dim hover:text-accent">+ Custom</button>
      )}
    </div>
  );
}

export function WalletActions({ open, onClose, initialTab = "send" }: { open: boolean; onClose: () => void; initialTab?: "send" | "swap" }) {
  const [tab, setTab] = useState<"send" | "swap">(initialTab);
  useEffect(() => { if (open) setTab(initialTab); }, [open, initialTab]);
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [busy, setBusy] = useState(false);

  // ── Send state ──
  const [sendTok, setSendTok] = useState<TokenInfo>(COMMON_TOKENS[0]);
  const [sendAmt, setSendAmt] = useState("");
  const [sendTo, setSendTo] = useState("");
  const sendBal = useTokenBalance(sendTok);

  // ── Swap state ──
  const [fromTok, setFromTok] = useState<TokenInfo>(COMMON_TOKENS[0]);
  const [toTok, setToTok] = useState<TokenInfo>(COMMON_TOKENS[1]);
  const [swapAmt, setSwapAmt] = useState("");
  const [quoteOut, setQuoteOut] = useState("");
  const [quoting, setQuoting] = useState(false);
  const fromBal = useTokenBalance(fromTok);
  const quoteSeq = useRef(0);

  useEffect(() => { if (!open) { setSendAmt(""); setSendTo(""); setSwapAmt(""); setQuoteOut(""); } }, [open]);

  // Live quote for swap (debounced). ETH<->WETH is 1:1.
  useEffect(() => {
    setQuoteOut("");
    const amt = parseFloat(swapAmt || "0");
    if (!amt || !walletClient?.account || fromTok.address === toTok.address) return;
    if (isWethPair(fromTok, toTok)) { setQuoteOut(swapAmt); return; }
    const seq = ++quoteSeq.current;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const q = await getSwapQuote({
          sellToken: isNative(fromTok.address) ? NATIVE : (fromTok.address as string),
          buyToken: isNative(toTok.address) ? NATIVE : (toTok.address as string),
          sellAmount: parseUnits(swapAmt, fromTok.decimals),
          taker: walletClient.account.address,
        });
        if (seq === quoteSeq.current) setQuoteOut(previewBuyAmount(q, toTok.decimals));
      } catch { if (seq === quoteSeq.current) setQuoteOut(""); }
      finally { if (seq === quoteSeq.current) setQuoting(false); }
    }, 450);
    return () => clearTimeout(t);
  }, [swapAmt, fromTok, toTok, walletClient]);

  const doSend = async () => {
    if (!walletClient || !publicClient) return;
    if (!sendTo || !sendAmt) { toast.error("Fill recipient and amount"); return; }
    setBusy(true);
    const id = toast.loading("Sending...");
    try {
      const hash = await sendToken(walletClient, publicClient, sendTok, sendTo, sendAmt);
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success(`Sent ${sendAmt} ${sendTok.symbol}`, { id });
      setSendAmt(""); setSendTo("");
    } catch (e: any) {
      toast.error(friendlyTxError(e, "Send failed"), { id });
    } finally { setBusy(false); }
  };

  const doSwap = async () => {
    if (!walletClient || !publicClient) return;
    if (!swapAmt) { toast.error("Enter an amount"); return; }
    if (fromTok.address === toTok.address) { toast.error("Pick two different tokens"); return; }
    setBusy(true);
    const id = toast.loading("Swapping...");
    try {
      const hash = await swapTokens(walletClient, publicClient, fromTok, toTok, swapAmt);
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success(`Swapped ${swapAmt} ${fromTok.symbol} for ${toTok.symbol}`, { id });
      setSwapAmt(""); setQuoteOut("");
    } catch (e: any) {
      toast.error(friendlyTxError(e, "Swap failed"), { id });
    } finally { setBusy(false); }
  };

  const flip = () => { setFromTok(toTok); setToTok(fromTok); setSwapAmt(""); setQuoteOut(""); };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-ink/25 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[111] w-[92%] max-w-md bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Tabs */}
            <div className="flex items-center border-b border-border">
              {(["send", "swap"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 py-3 text-sm font-bold uppercase tracking-wide transition-colors ${tab === t ? "text-accent border-b-2 border-amber" : "text-text-dim hover:text-text-secondary"}`}>
                  {t}
                </button>
              ))}
              <button onClick={onClose} className="px-4 text-text-dim hover:text-accent">×</button>
            </div>

            <div className="p-5">
              {tab === "send" ? (
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-semibold text-text-dim uppercase tracking-wide">Token</label>
                    <div className="mt-1.5"><TokenSelect value={sendTok} onChange={setSendTok} /></div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-semibold text-text-dim uppercase tracking-wide">Amount</label>
                      <button onClick={() => sendBal && setSendAmt(sendBal)} className="text-[10px] font-mono text-text-secondary hover:text-accent">
                        Balance: {fmt(sendBal)} {sendTok.symbol}
                      </button>
                    </div>
                    <input value={sendAmt} onChange={(e) => setSendAmt(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0.0"
                      className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-border bg-panel text-lg font-mono focus:outline-none focus:border-amber" />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-text-dim uppercase tracking-wide">Recipient</label>
                    <input value={sendTo} onChange={(e) => setSendTo(e.target.value.trim())} placeholder="0x..."
                      className="mt-1.5 w-full px-3 py-2.5 rounded-xl border border-border bg-panel text-sm font-mono focus:outline-none focus:border-amber" />
                  </div>
                  <button onClick={doSend} disabled={busy || !sendAmt || !sendTo}
                    className="w-full py-3 rounded-xl bg-sea text-ink text-sm font-bold hover:opacity-90 disabled:opacity-40 transition-opacity">
                    {busy ? "Sending..." : `Send ${sendTok.symbol}`}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border bg-panel p-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] font-semibold text-text-dim uppercase tracking-wide">From</label>
                      <button onClick={() => fromBal && setSwapAmt(fromBal)} className="text-[10px] font-mono text-text-secondary hover:text-accent">
                        Balance: {fmt(fromBal)} {fromTok.symbol}
                      </button>
                    </div>
                    <input value={swapAmt} onChange={(e) => setSwapAmt(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0.0"
                      className="w-full bg-transparent text-lg font-mono focus:outline-none mb-2" />
                    <TokenSelect value={fromTok} onChange={setFromTok} />
                  </div>

                  <div className="flex justify-center -my-1.5">
                    <button onClick={flip} className="p-1.5 rounded-lg bg-surface border border-border text-text-secondary hover:text-accent"
                      aria-label="Flip tokens">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10l5-5 5 5M7 14l5 5 5-5" /></svg>
                    </button>
                  </div>

                  <div className="rounded-xl border border-border bg-panel p-3">
                    <label className="text-[10px] font-semibold text-text-dim uppercase tracking-wide">To (estimated)</label>
                    <div className="text-lg font-mono mt-1 mb-2 text-text-primary">
                      {quoting ? <span className="text-text-dim">Fetching...</span> : (quoteOut ? fmt(quoteOut, 6) : "0.0")}
                    </div>
                    <TokenSelect value={toTok} onChange={setToTok} />
                  </div>

                  <button onClick={doSwap} disabled={busy || !swapAmt || fromTok.address === toTok.address}
                    className="w-full py-3 rounded-xl bg-sea text-ink text-sm font-bold hover:opacity-90 disabled:opacity-40 transition-opacity">
                    {busy ? "Swapping..." : "Swap"}
                  </button>
                  <p className="text-[10px] text-text-dim text-center">Routed via 0x. Slippage 1%. ETH and WETH convert directly.</p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
