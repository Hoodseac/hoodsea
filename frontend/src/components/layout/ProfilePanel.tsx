"use client";

import { useState, useEffect } from "react";
import { useAccount, useBalance, usePublicClient, useReadContract } from "wagmi";
import { useAuth } from "@/lib/useAuth";
import { formatEther } from "viem";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { CONTRACTS, LAUNCHPAD_ABI, NFT_ABI } from "@/lib/contracts";
import { IpfsImage } from "@/components/ui/IpfsImage";
import { CopyAddress } from "@/components/ui/CopyAddress";
import { resolveReveal } from "@/lib/reveal";
import { WalletActions } from "@/components/ui/WalletActions";

interface Props {
  open: boolean;
  onClose: () => void;
  onEdit?: () => void;
}

interface CollectionStat {
  address: string;
  name: string;
  ticker: string;
  coverPhoto: string;
  minted: number;
  revenue: string;
}

interface NFTHolding {
  address: string;
  name: string;
  coverPhoto: string;
  balance: number;
}

export function ProfilePanel({ open, onClose, onEdit }: Props) {
  const { address } = useAccount();
  const { logout } = useAuth();
  const { data: ethBalance } = useBalance({ address });
  const [ethPrice, setEthPrice] = useState<number>(0);

  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd")
      .then(r => r.json())
      .then(d => { if (d?.ethereum?.usd) setEthPrice(d.ethereum.usd); })
      .catch(() => {});
  }, []);
  const client = usePublicClient();
  const [tab, setTab] = useState<"creations" | "holdings">("creations");
  const [creations, setCreations] = useState<CollectionStat[]>([]);
  const [holdings, setHoldings] = useState<NFTHolding[]>([]);
  const [loading, setLoading] = useState(false);

  const { data: creatorAddresses } = useReadContract({
    address: CONTRACTS.launchpad,
    abi: LAUNCHPAD_ABI,
    functionName: "getCreatorCollections",
    args: address ? [address] : undefined,
    query: { enabled: !!address && open },
  });

  const { data: allAddresses } = useReadContract({
    address: CONTRACTS.launchpad,
    abi: LAUNCHPAD_ABI,
    functionName: "getAllCollections",
    query: { enabled: !!address && open && tab === "holdings" },
  });

  useEffect(() => {
    if (!creatorAddresses || !client || !open || tab !== "creations") return;
    const fetch = async () => {
      setLoading(true);
      const results: CollectionStat[] = [];
      await Promise.allSettled(
        (creatorAddresses as string[]).map(async (addr) => {
          try {
            const [info, mintStatus] = await Promise.all([
              client.readContract({ address: addr as `0x${string}`, abi: NFT_ABI, functionName: "getCollectionInfo" }),
              client.readContract({ address: addr as `0x${string}`, abi: NFT_ABI, functionName: "getMintStatus" }),
            ]);
            const [, , , , minted] = mintStatus as any;
            const mintedNum = Number(minted);
            const mintPrice = (info as any).mintPrice as bigint;
            const revenueWei = BigInt(mintedNum) * mintPrice;
            const { cover } = await resolveReveal(addr, Boolean((info as any).bondingComplete), (info as any).photoURIs?.[0] || "");
            results.push({
              address: addr,
              name: (info as any).name,
              ticker: (info as any).ticker,
              coverPhoto: cover,
              minted: mintedNum,
              revenue: formatEther(revenueWei),
            });
          } catch {}
        })
      );
      setCreations(results);
      setLoading(false);
    };
    fetch();
  }, [creatorAddresses, client, open, tab]);

  useEffect(() => {
    if (!allAddresses || !client || !address || tab !== "holdings" || !open) return;
    const fetch = async () => {
      setLoading(true);
      const results: NFTHolding[] = [];
      const recent = [...(allAddresses as string[])].reverse().slice(0, 20);
      await Promise.allSettled(
        recent.map(async (addr) => {
          try {
            const [bal, info] = await Promise.all([
              client.readContract({ address: addr as `0x${string}`, abi: NFT_ABI, functionName: "balanceOf", args: [address] }),
              client.readContract({ address: addr as `0x${string}`, abi: NFT_ABI, functionName: "getCollectionInfo" }),
            ]);
            if (Number(bal) > 0) {
              const { cover } = await resolveReveal(addr, Boolean((info as any).bondingComplete), (info as any).photoURIs?.[0] || "");
              results.push({
                address: addr,
                name: (info as any).name,
                coverPhoto: cover,
                balance: Number(bal),
              });
            }
          } catch {}
        })
      );
      setHoldings(results);
      setLoading(false);
    };
    fetch();
  }, [allAddresses, client, address, tab, open]);

  const totalRevenue = creations.reduce((sum, c) => sum + parseFloat(c.revenue || "0"), 0);
  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsTab, setActionsTab] = useState<"send" | "swap">("send");
  useEffect(() => { if (!open) { setMenuOpen(false); setActionsOpen(false); } }, [open]);
  // Copy the full wallet address so others can send funds to it.
  const copyAddr = async () => {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-ink/25 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed left-0 top-0 bottom-0 z-[95] w-4/5 max-w-sm bg-surface border-r border-border flex flex-col"
          >
            {/* Header */}
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-accent uppercase tracking-wide">PROFILE</span>
                <button onClick={onClose} className="text-xs text-text-dim hover:text-accent">×</button>
              </div>
              {address && (
                <CopyAddress
                  address={address}
                  display={shortAddr}
                  iconSize={13}
                  title="Copy wallet address"
                  className="text-sm text-text-primary"
                />
              )}
              {creations.length > 0 && (
                <p className="text-xs text-accent font-mono mt-0.5">
                  {totalRevenue.toFixed(4)} ETH earned
                </p>
              )}
              <div className="flex items-center justify-between mt-1">
                <p className="font-mono text-xs text-text-secondary">
                  {ethBalance ? (
                    <>
                      {parseFloat(formatEther(ethBalance.value)).toFixed(4)} ETH
                      {ethPrice > 0 && (
                        <span className="text-text-dim ml-1">
                          (${(parseFloat(formatEther(ethBalance.value)) * ethPrice).toFixed(2)})
                        </span>
                      )}
                    </>
                  ) : "..."}
                </p>
                {/* Settings gear */}
                <div className="relative">
                  <button
                    onClick={() => setMenuOpen((v) => !v)}
                    aria-label="Settings"
                    className={`p-1.5 rounded-lg transition-colors ${menuOpen ? "text-accent bg-amber/10" : "text-text-dim hover:text-accent hover:bg-panel"}`}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </button>
                  {menuOpen && (
                    <>
                      <div className="fixed inset-0 z-[96]" onClick={() => setMenuOpen(false)} />
                      <div className="absolute right-0 mt-1 w-52 z-[97] bg-surface border border-border rounded-xl shadow-xl overflow-hidden">
                        {/* Info */}
                        <div className="px-3 py-2.5 border-b border-border">
                          <p className="text-[9px] font-semibold text-text-dim uppercase tracking-wide mb-1">Wallet</p>
                          {address && (
                            <CopyAddress
                              address={address}
                              display={shortAddr}
                              iconSize={11}
                              title="Copy wallet address"
                              className="text-[11px] text-text-primary"
                            />
                          )}
                          <p className="font-mono text-[10px] text-text-secondary mt-0.5">
                            {ethBalance ? `${parseFloat(formatEther(ethBalance.value)).toFixed(4)} ETH` : "..."}
                            {ethPrice > 0 && ethBalance && (
                              <span className="text-text-dim ml-1">(${(parseFloat(formatEther(ethBalance.value)) * ethPrice).toFixed(2)})</span>
                            )}
                          </p>
                        </div>
                        {/* Actions */}
                        <button
                          onClick={copyAddr}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-text-primary hover:bg-panel transition-colors"
                        >
                          {copied ? (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent"><polyline points="20 6 9 17 4 12" /></svg>
                          ) : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                          )}
                          {copied ? "Copied!" : "Copy address"}
                        </button>
                        {onEdit && (
                          <button
                            onClick={() => { setMenuOpen(false); onEdit(); }}
                            className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-text-primary hover:bg-panel transition-colors"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                            Edit Profile
                          </button>
                        )}
                        <Link
                          href="/support"
                          onClick={() => { setMenuOpen(false); onClose(); }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs font-medium text-text-primary hover:bg-panel transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                            <line x1="12" y1="17" x2="12.01" y2="17" />
                          </svg>
                          Support
                        </Link>
                        {/* Disconnect, bottom, red */}
                        <button
                          onClick={() => { setMenuOpen(false); logout(); onClose(); }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-down border-t border-border hover:bg-down/100/10 transition-colors"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                          </svg>
                          Disconnect
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {/* Send / Swap quick actions for the in-app wallet */}
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => { setActionsTab("send"); setActionsOpen(true); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-sea text-ink text-xs font-bold hover:opacity-90 transition-opacity"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                  Send
                </button>
                <button
                  onClick={() => { setActionsTab("swap"); setActionsOpen(true); }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-amber text-accent text-xs font-bold hover:bg-amber/10 transition-colors"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
                  Swap
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-border">
              {(["creations", "holdings"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                    tab === t
                      ? "text-accent border-b-2 border-amber"
                      : "text-text-secondary hover:text-accent"
                  }`}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-14 bg-panel rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : tab === "creations" ? (
                <div className="space-y-2">
                  {creations.length === 0 ? (
                    <p className="text-xs text-text-dim text-center py-8">No collections launched yet</p>
                  ) : (
                    <>
                      <div className="flex justify-between text-[10px] text-text-dim pb-3 mb-1 border-b border-border">
                        <span className="font-medium">TOTAL MINT REVENUE</span>
                        <span className="font-mono text-accent">{totalRevenue.toFixed(4)} ETH</span>
                      </div>
                      {creations.map((c) => (
                        <Link key={c.address} href={`/collection/${c.address}`} onClick={onClose}>
                          <div className="flex items-center gap-3 py-2.5 hover:bg-panel/50 -mx-2 px-2 rounded transition-colors">
                            <div className="w-10 h-10 bg-surface border border-border rounded-lg overflow-hidden flex-shrink-0">
                              <IpfsImage uri={c.coverPhoto || "/landing/mystery.webp"} alt={c.name} className="w-full h-full object-cover" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-text-primary truncate">
                                {c.name} <span className="font-mono text-text-dim">${c.ticker}</span>
                              </p>
                              <p className="font-mono text-[10px] text-text-secondary">{c.minted} minted</p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="font-mono text-[10px] text-accent">{parseFloat(c.revenue).toFixed(4)} ETH</p>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {holdings.length === 0 ? (
                    <p className="text-xs text-text-dim text-center py-8">No NFTs held</p>
                  ) : (
                    holdings.map((h) => (
                      <Link key={h.address} href={`/collection/${h.address}`} onClick={onClose}>
                        <div className="flex items-center gap-3 py-2.5 hover:bg-panel/50 -mx-2 px-2 rounded transition-colors">
                          <div className="w-10 h-10 bg-surface border border-border rounded-lg overflow-hidden flex-shrink-0">
                            <IpfsImage uri={h.coverPhoto || "/landing/mystery.webp"} alt={h.name} className="w-full h-full object-cover" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-text-primary truncate">{h.name}</p>
                            <p className="font-mono text-[10px] text-text-secondary">
                              {h.balance} NFT{h.balance > 1 ? "s" : ""}
                            </p>
                          </div>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-border">
              <Link
                href="/launch"
                onClick={onClose}
                className="block w-full py-2.5 text-center text-xs font-semibold border border-amber text-accent rounded-xl hover:bg-amber/10 transition-colors"
              >
                + LAUNCH COLLECTION
              </Link>
            </div>
          </motion.div>
          <WalletActions open={actionsOpen} onClose={() => setActionsOpen(false)} initialTab={actionsTab} />
        </>
      )}
    </AnimatePresence>
  );
}
