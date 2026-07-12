"use client";

import { useAccount, useWriteContract, useConfig, useReadContract, usePublicClient } from "wagmi";
import { waitForTransactionReceipt } from "@wagmi/core";
import { formatEther, parseEther } from "viem";
import { useState, useEffect } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import { NFT_ABI } from "@/lib/contracts";
import { useNFTsInCollection } from "@/hooks/useNFTs";
import { useReveal, formatRevealCountdown } from "@/hooks/useReveal";
import { MYSTERY_URI } from "./MysteryArt";
import { IpfsImage } from "@/components/ui/IpfsImage";
import { friendlyTxError } from "@/lib/tx-errors";

const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
const RARITY_COLORS = ["#6b7280", "#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#ec4899"];

const EXPIRY_OPTIONS = [
  { label: "30 min", value: 1800 },
  { label: "1 hour", value: 3600 },
  { label: "6 hours", value: 21600 },
  { label: "24 hours", value: 86400 },
  { label: "7 days", value: 604800 },
  { label: "30 days", value: 2592000 },
  { label: "6 months", value: 15552000 },
];

interface Props {
  collectionAddress: `0x${string}`;
  bonded?: boolean;
}

export function NFTGrid({ collectionAddress, bonded = false }: Props) {
  const { address } = useAccount();
  const { nfts, isLoading } = useNFTsInCollection(collectionAddress);
  const reveal = useReveal(collectionAddress, bonded);
  // On-chain reveal gate: getRarity only returns real tiers once revealRarities
  // has run (a block after sellout). Until then keep cards as the mystery image
  // so a freshly bonded collection never flashes all-Common.
  const { data: onChainRevealed } = useReadContract({
    address: collectionAddress, abi: NFT_ABI, functionName: "revealed",
    query: { enabled: bonded, refetchInterval: 8000 },
  });
  // Collection-wide offer the connected wallet currently has in escrow (one per
  // address). The contract has no per-token offer, so a single offer applies to
  // any NFT in this collection.
  const { data: myOfferRaw, refetch: refetchOffer } = useReadContract({
    address: collectionAddress, abi: NFT_ABI, functionName: "collectionOffer",
    args: address ? [address] : undefined,
    query: { enabled: !!address && bonded },
  });
  const myOffer = (myOfferRaw as bigint) ?? BigInt(0);
  const { writeContractAsync } = useWriteContract();
  const config = useConfig();
  const client = usePublicClient();

  // Active collection offers (escrowed, one per address). We scan CollectionOfferMade
  // logs for everyone who has ever offered, then re-read collectionOffer(addr) so
  // cancelled/spent offers (now 0) drop out. Holders accept the best one for any NFT.
  const [offers, setOffers] = useState<{ offerer: string; amount: bigint }[]>([]);
  const [offersTick, setOffersTick] = useState(0);
  useEffect(() => {
    if (!client || !bonded) return;
    let on = true;
    (async () => {
      try {
        const latest = await client.getBlockNumber();
        const seen = new Set<string>();
        // drpc free serves filtered getLogs reliably up to ~5k blocks. Walk back a
        // bounded number of small windows (recent offers are what matter) so we
        // never hammer the RPC or scan to genesis.
        const step = BigInt(4500);
        let end = latest;
        for (let i = 0; i < 12; i++) {
          const from = end > step ? end - step : BigInt(0);
          const logs = await client.getLogs({
            address: collectionAddress,
            event: { type: "event", name: "CollectionOfferMade", inputs: [{ name: "offerer", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }] },
            fromBlock: from, toBlock: end,
          }).catch(() => []);
          for (const l of logs) { const o = (l as any).args.offerer as string; if (o) seen.add(o.toLowerCase()); }
          if (from === BigInt(0) || seen.size > 100) break;
          end = from - BigInt(1);
        }
        const live = await Promise.all(
          [...seen].map(async (offerer) => {
            const amt = await client.readContract({ address: collectionAddress, abi: NFT_ABI, functionName: "collectionOffer", args: [offerer as `0x${string}`] }).catch(() => BigInt(0));
            return { offerer, amount: amt as bigint };
          })
        );
        const active = live.filter((o) => o.amount > BigInt(0)).sort((a, b) => (a.amount > b.amount ? -1 : 1));
        if (on) setOffers(active);
      } catch { /* offers stay empty */ }
    })();
    return () => { on = false; };
  }, [client, bonded, collectionAddress, offersTick]);
  const topOffer = offers[0] || null;
  const [acceptingId, setAcceptingId] = useState<number | null>(null);

  // Bulk buy: select multiple listed NFTs, then buy them in sequence.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkBuying, setBulkBuying] = useState(false);
  const [listingId, setListingId] = useState<number | null>(null);
  const [listPrice, setListPrice] = useState("");
  const [listExpiry, setListExpiry] = useState(86400); // default 24h
  const [txPending, setTxPending] = useState(false);
  const [buyingId, setBuyingId] = useState<number | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [rarityFilter, setRarityFilter] = useState<number | "all">("all");
  const [sortBy, setSortBy] = useState<"none" | "price-asc" | "price-desc">("price-asc"); // cheapest (floor) first by default
  const [offerModalId, setOfferModalId] = useState<number | null>(null);
  const [offerAmount, setOfferAmount] = useState("");
  const [offerPending, setOfferPending] = useState(false);

  // Recovery path: display timer says revealed but on-chain reveal never ran
  // (the post-bonding auto-trigger can fail and nobody has traded yet).
  // revealRarities is permissionless, so let anyone unstick it.
  const needsReveal = bonded && reveal.revealed && onChainRevealed === false;
  const handleReveal = async () => {
    setRevealing(true);
    try {
      toast.loading("Revealing rarities...", { id: "reveal" });
      const hash = await writeContractAsync({ address: collectionAddress, abi: NFT_ABI, functionName: "revealRarities" });
      await waitForTransactionReceipt(config, { hash });
      toast.success("Rarities revealed!", { id: "reveal" });
    } catch (e: any) {
      toast.error(friendlyTxError(e, "Reveal failed"), { id: "reveal" });
    } finally {
      setRevealing(false);
    }
  };

  // Buy floor = cheapest listed NFT
  const listed = nfts.filter(n => n.listPrice > BigInt(0));
  const floor = listed.sort((a, b) => (a.listPrice < b.listPrice ? -1 : 1))[0];

  // Rarity filter only makes sense once rarities are revealed on-chain
  const revealedAll = reveal.revealed && onChainRevealed;
  let display = nfts.slice();
  if (revealedAll && rarityFilter !== "all") display = display.filter(n => n.rarity === rarityFilter);
  if (sortBy !== "none") {
    display.sort((a, b) => {
      const al = a.listPrice > BigInt(0), bl = b.listPrice > BigInt(0);
      if (al !== bl) return al ? -1 : 1;          // listed NFTs first
      if (!al) return a.tokenId - b.tokenId;       // both unlisted: stable by id
      return sortBy === "price-asc"
        ? (a.listPrice < b.listPrice ? -1 : 1)
        : (a.listPrice > b.listPrice ? -1 : 1);
    });
  }

  const handleBuy = async (tokenId: number, price: bigint) => {
    setBuyingId(tokenId);
    try {
      toast.loading("Confirm purchase...", { id: "buy" });
      const hash = await writeContractAsync({ address: collectionAddress, abi: NFT_ABI, functionName: "buyNFT", args: [BigInt(tokenId)], value: price });
      await waitForTransactionReceipt(config, { hash });
      toast.success("NFT purchased!", { id: "buy" });
    } catch (e: any) {
      toast.error(friendlyTxError(e, "Purchase failed"), { id: "buy" });
    } finally {
      setBuyingId(null);
    }
  };

  const handleList = async (tokenId: number) => {
    if (!listPrice || parseFloat(listPrice) <= 0) { toast.error("Enter a valid price"); return; }
    setTxPending(true);
    try {
      toast.loading("Listing NFT...", { id: "list" });
      const expiryTs = BigInt(Math.floor(Date.now() / 1000) + listExpiry); // absolute unix ts, on-chain enforced
      const hash = await writeContractAsync({ address: collectionAddress, abi: NFT_ABI, functionName: "listNFT", args: [BigInt(tokenId), parseEther(listPrice), expiryTs] });
      await waitForTransactionReceipt(config, { hash });
      toast.success("NFT listed!", { id: "list" });
      setListingId(null);
      setListPrice("");
    } catch (e: any) {
      toast.error(friendlyTxError(e, "List failed"), { id: "list" });
    } finally {
      setTxPending(false);
    }
  };

  const handleMakeOffer = async () => {
    if (!offerAmount || parseFloat(offerAmount) <= 0) { toast.error("Enter a valid offer"); return; }
    setOfferPending(true);
    try {
      toast.loading("Submitting offer...", { id: "offer" });
      const hash = await writeContractAsync({ address: collectionAddress, abi: NFT_ABI, functionName: "makeCollectionOffer", value: parseEther(offerAmount) });
      await waitForTransactionReceipt(config, { hash });
      toast.success("Offer submitted!", { id: "offer" });
      setOfferModalId(null);
      setOfferAmount("");
      refetchOffer();
      setOffersTick(t => t + 1);
    } catch (e: any) {
      toast.error(friendlyTxError(e, "Offer failed"), { id: "offer" });
    } finally {
      setOfferPending(false);
    }
  };

  const handleCancelOffer = async () => {
    setOfferPending(true);
    try {
      toast.loading("Cancelling offer...", { id: "offer" });
      const hash = await writeContractAsync({ address: collectionAddress, abi: NFT_ABI, functionName: "cancelCollectionOffer" });
      await waitForTransactionReceipt(config, { hash });
      toast.success("Offer cancelled, ETH returned", { id: "offer" });
      refetchOffer();
      setOffersTick(t => t + 1);
    } catch (e: any) {
      toast.error(friendlyTxError(e, "Cancel failed"), { id: "offer" });
    } finally {
      setOfferPending(false);
    }
  };

  // Holder accepts the best active collection offer for one of their NFTs.
  const handleAcceptOffer = async (tokenId: number, offerer: string, amount: bigint) => {
    setAcceptingId(tokenId);
    try {
      toast.loading(`Accepting ${formatEther(amount)} ETH offer...`, { id: "accept" });
      const hash = await writeContractAsync({ address: collectionAddress, abi: NFT_ABI, functionName: "acceptCollectionOffer", args: [BigInt(tokenId), offerer as `0x${string}`] });
      await waitForTransactionReceipt(config, { hash });
      toast.success(`Sold #${tokenId} for ${formatEther(amount)} ETH!`, { id: "accept" });
      setOffersTick(t => t + 1);
    } catch (e: any) {
      toast.error(friendlyTxError(e, "Accept failed"), { id: "accept" });
    } finally {
      setAcceptingId(null);
    }
  };

  // Bulk buy: fire buyNFT for each selected listed NFT in sequence (one wallet
  // confirmation each, there is no on-chain batch buy). Skips any that fail.
  const toggleSelect = (tokenId: number) => {
    setSelected(prev => { const n = new Set(prev); n.has(tokenId) ? n.delete(tokenId) : n.add(tokenId); return n; });
  };
  const handleBulkBuy = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkBuying(true);
    let done = 0;
    for (const tokenId of ids) {
      const nft = nfts.find(n => n.tokenId === tokenId);
      if (!nft || nft.listPrice <= BigInt(0)) continue;
      try {
        toast.loading(`Buying #${tokenId} (${done + 1}/${ids.length})...`, { id: "bulk" });
        const hash = await writeContractAsync({ address: collectionAddress, abi: NFT_ABI, functionName: "buyNFT", args: [BigInt(tokenId)], value: nft.listPrice });
        await waitForTransactionReceipt(config, { hash });
        done++;
        setSelected(prev => { const n = new Set(prev); n.delete(tokenId); return n; });
      } catch (e: any) {
        toast.error(`#${tokenId}: ${friendlyTxError(e, "failed")}`, { id: "bulk" });
      }
    }
    toast.success(`Bought ${done}/${ids.length} NFTs`, { id: "bulk" });
    setBulkBuying(false);
    setSelectMode(false);
    setSelected(new Set());
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="aspect-square bg-panel animate-pulse border border-border rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Buy floor bar */}
      {floor && (
        <div className="flex items-center justify-between px-4 py-3 mb-4 border border-amber/30 rounded-xl bg-amber/5">
          <div>
            <span className="text-xs font-semibold text-text-dim uppercase tracking-wide">FLOOR PRICE</span>
            <span className="ml-3 font-mono text-sm font-bold text-accent">{formatEther(floor.listPrice)} ETH</span>
            <span className="ml-2 text-xs text-text-dim">· {listed.length} listed</span>
          </div>
          {floor.owner?.toLowerCase() !== address?.toLowerCase() && (
            <button
              onClick={() => handleBuy(floor.tokenId, floor.listPrice)}
              disabled={buyingId === floor.tokenId}
              className="btn-primary btn-sm"
            >
              {buyingId === floor.tokenId ? "BUYING..." : "BUY FLOOR"}
            </button>
          )}
        </div>
      )}

      {/* Best collection offer, any holder can accept it for any of their NFTs */}
      {topOffer && (
        <div className="flex items-center justify-between px-4 py-3 mb-4 border border-brand/30 rounded-xl bg-mint">
          <div>
            <span className="text-xs font-semibold text-text-dim uppercase tracking-wide">TOP OFFER</span>
            <span className="ml-3 font-mono text-sm font-bold text-accent">{formatEther(topOffer.amount)} ETH</span>
            <span className="ml-2 text-xs text-text-dim">· {offers.length} active · any NFT</span>
          </div>
          {/* If the connected wallet holds an NFT here, accept the offer for the lowest-id one */}
          {(() => {
            const owned = nfts.find(n => n.owner?.toLowerCase() === address?.toLowerCase());
            if (!owned || topOffer.offerer.toLowerCase() === address?.toLowerCase()) return null;
            return (
              <button onClick={() => handleAcceptOffer(owned.tokenId, topOffer.offerer, topOffer.amount)}
                disabled={acceptingId !== null}
                className="btn-primary btn-sm">
                {acceptingId !== null ? "ACCEPTING..." : `ACCEPT (sell #${owned.tokenId})`}
              </button>
            );
          })()}
        </div>
      )}

      {/* Recovery: on-chain reveal pending while the display timer has elapsed */}
      {needsReveal && (
        <div className="flex items-center justify-between px-4 py-3 mb-4 border border-brand/30 rounded-xl bg-mint">
          <span className="text-xs font-semibold text-accent">Rarities are ready to reveal on-chain.</span>
          <button onClick={handleReveal} disabled={revealing} className="btn-primary btn-sm">
            {revealing ? "REVEALING..." : "REVEAL RARITIES"}
          </button>
        </div>
      )}

      {/* Reveal countdown banner (creator chose 24h/7d reveal) */}
      {bonded && !reveal.isLoading && !reveal.revealed && reveal.revealAt && (
        <div className="px-4 py-3 mb-4 border border-brand/30 rounded-xl bg-mint text-center">
          <span className="text-xs font-semibold text-accent uppercase tracking-wide">
            Rarity reveals in {formatRevealCountdown(reveal.revealAt)}
          </span>
        </div>
      )}

      {/* Filter + sort bar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="flex items-center gap-1 bg-surface border border-border rounded-full p-0.5">
          {([["none","Default"],["price-asc","Price ↑"],["price-desc","Price ↓"]] as const).map(([v,label]) => (
            <button key={v} onClick={() => setSortBy(v)}
              className={`px-3 py-1 text-[11px] font-semibold rounded-full transition-colors ${sortBy===v ? "bg-sea text-ink" : "text-text-secondary hover:text-accent"}`}>
              {label}
            </button>
          ))}
        </div>
        {revealedAll && (
          <div className="flex flex-wrap items-center gap-1">
            <button onClick={() => setRarityFilter("all")}
              className={`px-3 py-1 text-[11px] font-semibold rounded-full border transition-colors ${rarityFilter==="all" ? "border-amber text-accent" : "border-border text-text-secondary hover:text-accent"}`}>All</button>
            {RARITY_NAMES.map((name, i) => (
              <button key={i} onClick={() => setRarityFilter(i)}
                className={`px-3 py-1 text-[11px] font-semibold rounded-full border transition-colors ${rarityFilter===i ? "text-white" : "bg-transparent"}`}
                style={rarityFilter===i ? { backgroundColor: RARITY_COLORS[i], borderColor: RARITY_COLORS[i] } : { borderColor: RARITY_COLORS[i]+"66", color: RARITY_COLORS[i] }}>
                {name}
              </button>
            ))}
          </div>
        )}
        {/* Bulk buy toggle + collection-level offer */}
        {bonded && (
          <div className="ml-auto flex items-center gap-2">
            {listed.length > 0 && (
              <button
                onClick={() => { setSelectMode(m => !m); setSelected(new Set()); }}
                className={`btn-sm ${selectMode ? "btn-danger" : "btn-outline"}`}>
                {selectMode ? "CANCEL" : "BULK BUY"}
              </button>
            )}
            {myOffer > BigInt(0) ? (
              <button onClick={handleCancelOffer} disabled={offerPending} className="btn-danger btn-sm">
                {offerPending ? "..." : `CANCEL OFFER ${formatEther(myOffer)} ETH`}
              </button>
            ) : (
              <button onClick={() => { setOfferModalId(-1); setOfferAmount(""); }} className="btn-primary btn-sm">
                + Collection offer
              </button>
            )}
          </div>
        )}
      </div>

      {/* Grid */}
      {display.length === 0 ? (
        <p className="text-sm text-text-dim py-8 text-center">No NFTs match this filter.</p>
      ) : (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {display.map((nft) => {
          const hidden = !reveal.revealed || !onChainRevealed; // off-chain timer OR on-chain reveal pending
          const rarityColor = hidden ? "#9ca3af" : RARITY_COLORS[nft.rarity];
          const isOwner = nft.owner?.toLowerCase() === address?.toLowerCase();
          const isListed = nft.listPrice > BigInt(0);
          const isBuying = buyingId === nft.tokenId;

          const canSelect = selectMode && isListed && !isOwner;
          const isSelected = selected.has(nft.tokenId);

          return (
            <div key={nft.tokenId}
              className={`border bg-panel rounded-xl group relative overflow-hidden ${isSelected ? "ring-2 ring-amber" : ""}`}
              style={{ borderColor: rarityColor + "44" }}>
              {/* Bulk-select checkbox overlay */}
              {canSelect && (
                <button onClick={() => toggleSelect(nft.tokenId)}
                  className="absolute top-2 left-2 z-10 w-6 h-6 rounded-md border-2 flex items-center justify-center text-xs font-bold"
                  style={{ borderColor: "#f59e0b", background: isSelected ? "#f59e0b" : "rgba(0,0,0,0.4)", color: "#fff" }}>
                  {isSelected ? "•" : ""}
                </button>
              )}
              {/* Image, click selects (bulk mode) or opens the detail page */}
              {canSelect ? (
                <div className="aspect-square overflow-hidden bg-surface cursor-pointer" onClick={() => toggleSelect(nft.tokenId)}>
                  {hidden ? (
                    <IpfsImage uri={reveal.placeholderURI || MYSTERY_URI} alt={`NFT #${nft.tokenId} (unrevealed)`} className="w-full h-full object-cover" />
                  ) : nft.imageURI ? (
                    <IpfsImage uri={nft.imageURI} alt={`NFT #${nft.tokenId}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><span className="font-mono text-xs text-text-dim">#{nft.tokenId}</span></div>
                  )}
                </div>
              ) : (
                <Link href={`/nft/${collectionAddress}/${nft.tokenId}`}>
                  <div className="aspect-square overflow-hidden bg-surface cursor-pointer">
                    {hidden ? (
                      <IpfsImage uri={reveal.placeholderURI || MYSTERY_URI}
                        alt={`NFT #${nft.tokenId} (unrevealed)`} className="w-full h-full object-cover" />
                    ) : nft.imageURI ? (
                      <IpfsImage uri={nft.imageURI} alt={`NFT #${nft.tokenId}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="font-mono text-xs text-text-dim">#{nft.tokenId}</span>
                      </div>
                    )}
                  </div>
                </Link>
              )}

              {/* Info */}
              <div className="p-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold" style={{ color: rarityColor }}>
                    {hidden ? "UNREVEALED" : RARITY_NAMES[nft.rarity]?.toUpperCase()}
                  </span>
                  <span className="font-mono text-[10px] text-text-dim">#{nft.tokenId}</span>
                </div>

                {isListed && (
                  <p className="font-mono text-xs text-accent mb-2">{formatEther(nft.listPrice)} ETH</p>
                )}

                {/* Buy (single), hidden in bulk-select mode */}
                {isListed && !isOwner && !selectMode && (
                  <button onClick={() => handleBuy(nft.tokenId, nft.listPrice)} disabled={isBuying}
                    className="btn-primary btn-sm btn-block">
                    {isBuying ? "BUYING..." : "BUY"}
                  </button>
                )}

                {/* Owner: accept the top collection offer for this NFT */}
                {isOwner && topOffer && topOffer.offerer.toLowerCase() !== address?.toLowerCase() && (
                  <button onClick={() => handleAcceptOffer(nft.tokenId, topOffer.offerer, topOffer.amount)}
                    disabled={acceptingId !== null}
                    className="btn-primary btn-sm btn-block mb-1" style={{ backgroundColor: "#22c55e", borderColor: "#22c55e" }}>
                    {acceptingId === nft.tokenId ? "ACCEPTING..." : `ACCEPT ${formatEther(topOffer.amount)} ETH`}
                  </button>
                )}

                {/* Owner: list / relist */}
                {isOwner && listingId !== nft.tokenId && (
                  <button onClick={() => { setListingId(nft.tokenId); setListPrice(""); }}
                    className="btn-outline btn-sm btn-block">
                    {isListed ? "RELIST" : "LIST"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Bulk-buy sticky footer */}
      {selectMode && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface/95 backdrop-blur px-4 py-3">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
            <span className="text-xs text-text-secondary">
              <span className="font-semibold text-text-primary">{selected.size}</span> selected
              {selected.size > 0 && (
                <span className="ml-2 font-mono text-accent">
                  {formatEther([...selected].reduce((s, id) => { const n = nfts.find(x => x.tokenId === id); return s + (n?.listPrice ?? BigInt(0)); }, BigInt(0)))} ETH
                </span>
              )}
            </span>
            <button onClick={handleBulkBuy} disabled={bulkBuying || selected.size === 0} className="btn-primary btn-sm">
              {bulkBuying ? "BUYING..." : `BUY ${selected.size} NFT${selected.size === 1 ? "" : "S"}`}
            </button>
          </div>
        </div>
      )}

      {/* Listing modal */}
      {listingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm" onClick={() => setListingId(null)}>
          <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-sm p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-5">LIST NFT #{listingId}</p>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-text-dim uppercase tracking-wide block mb-1.5">PRICE (ETH)</label>
                <input
                  type="number" min="0" step="0.001" placeholder="0.05"
                  value={listPrice} onChange={e => setListPrice(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl font-mono text-sm text-gray-800 bg-white focus:outline-none focus:border-amber"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-text-dim uppercase tracking-wide block mb-1.5">EXPIRY</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {EXPIRY_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => setListExpiry(opt.value)}
                      className={`py-1.5 text-[10px] font-semibold border rounded-lg transition-colors ${
                        listExpiry === opt.value ? "border-ink bg-ink text-white" : "border-line text-text-secondary hover:border-ink/30"
                      }`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">* Listing auto-expires on-chain after this; relist anytime.</p>
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={() => handleList(listingId)} disabled={txPending}
                className="btn-primary flex-1">
                {txPending ? "LISTING..." : "CONFIRM"}
              </button>
              <button onClick={() => setListingId(null)} className="btn-ghost">
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Offer modal */}
      {offerModalId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4 backdrop-blur-sm" onClick={() => setOfferModalId(null)}>
          <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-sm p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-2">MAKE COLLECTION OFFER</p>
            <p className="text-[11px] text-gray-500 mb-5">
              A collection-wide offer held in escrow. Any holder in this collection can accept it for any of their NFTs. You can cancel anytime to get your ETH back.
            </p>

            <div>
              <label className="text-xs font-semibold text-text-dim uppercase tracking-wide block mb-1.5">OFFER (ETH)</label>
              <input
                type="number" min="0" step="0.001" placeholder="0.05"
                value={offerAmount} onChange={e => setOfferAmount(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl font-mono text-sm text-gray-800 bg-white focus:outline-none focus:border-amber"
                autoFocus
              />
            </div>

            <div className="flex gap-2 mt-5">
              <button onClick={handleMakeOffer} disabled={offerPending}
                className="btn-primary flex-1">
                {offerPending ? "SUBMITTING..." : "SUBMIT OFFER"}
              </button>
              <button onClick={() => setOfferModalId(null)} className="btn-ghost">
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
