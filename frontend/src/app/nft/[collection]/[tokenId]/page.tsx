"use client";

import { useParams } from "next/navigation";
import { useState, useEffect } from "react";
import { usePublicClient, useAccount, useWriteContract, useConfig } from "wagmi";
import { waitForTransactionReceipt } from "@wagmi/core";
import { formatEther, parseEther } from "viem";
import Link from "next/link";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { NFT_ABI, RARITY } from "@/lib/contracts";
import { IpfsImage } from "@/components/ui/IpfsImage";
import { CopyAddress } from "@/components/ui/CopyAddress";
import { useReveal, formatRevealCountdown } from "@/hooks/useReveal";
import { MYSTERY_URI } from "@/components/collection/MysteryArt";
import { friendlyTxError } from "@/lib/tx-errors";

const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
const RARITY_COLORS = ["#6b7280", "#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#ec4899"];

const EXPIRY_OPTIONS = [
  { label: "30 minutes", seconds: 1800 },
  { label: "1 hour", seconds: 3600 },
  { label: "6 hours", seconds: 21600 },
  { label: "24 hours", seconds: 86400 },
  { label: "7 days", seconds: 604800 },
  { label: "30 days", seconds: 2592000 },
  { label: "6 months", seconds: 15552000 },
  { label: "No expiry", seconds: 0 },
];

export default function NFTDetailPage() {
  const { collection, tokenId } = useParams<{ collection: string; tokenId: string }>();
  const { address } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const config = useConfig();

  const [nft, setNft] = useState<{
    rarity: number; owner: string; listPrice: bigint; listExpiry: bigint;
    lastSalePrice: bigint; imageURI: string;
  } | null>(null);
  const [colInfo, setColInfo] = useState<any>(null);
  const [onChainRevealed, setOnChainRevealed] = useState(false);
  const [myOffer, setMyOffer] = useState<bigint>(BigInt(0));
  const [history, setHistory] = useState<{ type: "minted" | "listed" | "sold"; price: bigint; from: string; to?: string; block: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [listMode, setListMode] = useState(false);
  const [offerMode, setOfferMode] = useState(false);
  const [listPrice, setListPrice] = useState("");
  const [listExpiry, setListExpiry] = useState(86400); // default 24h
  const [offerAmount, setOfferAmount] = useState("");
  const [txPending, setTxPending] = useState(false);
  const [sellConfirm, setSellConfirm] = useState(false);
  const [preReturn, setPreReturn] = useState<bigint>(BigInt(0)); // est ETH back on pre-bonding sell
  const reveal = useReveal(collection, Boolean(colInfo?.bondingComplete));

  const load = async () => {
    if (!client || !collection || !tokenId) return;
    const addr = collection as `0x${string}`;
    const tid = BigInt(tokenId);

    setLoading(true);
    try {
      const [rarity, owner, listPrice_, listExpiry_, lastSale, imageURI, info, revealedFlag] = await Promise.all([
        client.readContract({ address: addr, abi: NFT_ABI, functionName: "getRarity", args: [tid] }).catch(() => 0),
        client.readContract({ address: addr, abi: NFT_ABI, functionName: "tokenOwner", args: [tid] }).catch(() => "0x0"),
        client.readContract({ address: addr, abi: NFT_ABI, functionName: "tokenListPrice", args: [tid] }).catch(() => BigInt(0)),
        client.readContract({ address: addr, abi: NFT_ABI, functionName: "tokenListExpiry", args: [tid] }).catch(() => BigInt(0)),
        client.readContract({ address: addr, abi: NFT_ABI, functionName: "tokenLastSalePrice", args: [tid] }).catch(() => BigInt(0)),
        client.readContract({ address: addr, abi: NFT_ABI, functionName: "uri", args: [tid] }).catch(() => ""),
        client.readContract({ address: addr, abi: NFT_ABI, functionName: "getCollectionInfo" }).catch(() => null),
        client.readContract({ address: addr, abi: NFT_ABI, functionName: "revealed" }).catch(() => false),
      ]);
      setOnChainRevealed(Boolean(revealedFlag));

      if (address) {
        const offer = await client.readContract({ address: addr, abi: NFT_ABI, functionName: "collectionOffer", args: [address as `0x${string}`] }).catch(() => BigInt(0));
        setMyOffer(offer as bigint);
      }

      setNft({
        rarity: Number(rarity),
        owner: owner as string,
        listPrice: listPrice_ as bigint,
        listExpiry: listExpiry_ as bigint,
        lastSalePrice: lastSale as bigint,
        imageURI: imageURI as string,
      });
      setColInfo(info);

      // Pre-bonding sell-back estimate: half of each token's pool share
      if (info && !(info as any).bondingComplete) {
        const [poolBal, minted] = await Promise.all([
          client.readContract({ address: addr, abi: NFT_ABI, functionName: "poolBalance" }).catch(() => BigInt(0)),
          client.readContract({ address: addr, abi: NFT_ABI, functionName: "totalMinted" }).catch(() => BigInt(0)),
        ]);
        const m = minted as bigint;
        setPreReturn(m > BigInt(0) ? ((poolBal as bigint) / m) / BigInt(2) : BigInt(0));
      }

      const fromBlock = BigInt(Math.max(0, Number(await client.getBlockNumber()) - 45000));
      const [mintLogs, listLogs, soldLogs] = await Promise.all([
        client.getLogs({ address: addr, event: { type: "event", name: "NFTMinted", inputs: [{ name: "minter", type: "address", indexed: true }, { name: "tokenId", type: "uint256", indexed: false }, { name: "rarity", type: "uint8", indexed: false }, { name: "price", type: "uint256", indexed: false }] }, fromBlock }).catch(() => []),
        client.getLogs({ address: addr, event: { type: "event", name: "NFTListed", inputs: [{ name: "tokenId", type: "uint256", indexed: true }, { name: "price", type: "uint256", indexed: false }, { name: "expiry", type: "uint256", indexed: false }, { name: "seller", type: "address", indexed: false }] }, args: { tokenId: tid }, fromBlock }).catch(() => []),
        client.getLogs({ address: addr, event: { type: "event", name: "NFTSold", inputs: [{ name: "tokenId", type: "uint256", indexed: true }, { name: "price", type: "uint256", indexed: false }, { name: "from", type: "address", indexed: false }, { name: "to", type: "address", indexed: false }] }, args: { tokenId: tid }, fromBlock }).catch(() => []),
      ]);

      const h: typeof history = [];
      for (const log of mintLogs) {
        if (Number((log as any).args?.tokenId) === Number(tokenId)) {
          h.push({ type: "minted", price: (log as any).args?.price ?? BigInt(0), from: (log as any).args?.minter ?? "0x0", block: Number(log.blockNumber) });
        }
      }
      for (const log of listLogs) {
        h.push({ type: "listed", price: (log as any).args?.price ?? BigInt(0), from: (log as any).args?.seller ?? "0x0", block: Number(log.blockNumber) });
      }
      for (const log of soldLogs) {
        h.push({ type: "sold", price: (log as any).args?.price ?? BigInt(0), from: (log as any).args?.from ?? "0x0", to: (log as any).args?.to ?? "0x0", block: Number(log.blockNumber) });
      }
      setHistory(h.sort((a, b) => b.block - a.block));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [client, collection, tokenId, address]);

  const handleBuy = async () => {
    if (!nft) return;
    setTxPending(true);
    try {
      toast.loading("Confirm purchase...", { id: "nft-buy" });
      const hash = await writeContractAsync({ address: collection as `0x${string}`, abi: NFT_ABI, functionName: "buyNFT", args: [BigInt(tokenId)], value: nft.listPrice });
      await waitForTransactionReceipt(config, { hash });
      toast.success("NFT purchased!", { id: "nft-buy" });
      await load();
    } catch (e: any) {
      toast.error(friendlyTxError(e, "Purchase failed"), { id: "nft-buy" });
    } finally {
      setTxPending(false);
    }
  };

  const handleList = async () => {
    if (!listPrice || parseFloat(listPrice) <= 0) { toast.error("Enter valid price"); return; }
    setTxPending(true);
    try {
      toast.loading("Listing NFT...", { id: "nft-list" });
      const expiryTs = listExpiry > 0 ? BigInt(Math.floor(Date.now() / 1000) + listExpiry) : BigInt(0);
      const hash = await writeContractAsync({ address: collection as `0x${string}`, abi: NFT_ABI, functionName: "listNFT", args: [BigInt(tokenId), parseEther(listPrice), expiryTs] });
      await waitForTransactionReceipt(config, { hash });
      toast.success("NFT listed!", { id: "nft-list" });
      setListMode(false);
      await load();
    } catch (e: any) {
      toast.error(friendlyTxError(e, "List failed"), { id: "nft-list" });
    } finally {
      setTxPending(false);
    }
  };

  const handleCancelListing = async () => {
    setTxPending(true);
    try {
      toast.loading("Cancelling listing...", { id: "cancel" });
      const hash = await writeContractAsync({ address: collection as `0x${string}`, abi: NFT_ABI, functionName: "cancelListing", args: [BigInt(tokenId)] });
      await waitForTransactionReceipt(config, { hash });
      toast.success("Listing cancelled", { id: "cancel" });
      await load();
    } catch (e: any) {
      toast.error(friendlyTxError(e, "Cancel failed"), { id: "cancel" });
    } finally {
      setTxPending(false);
    }
  };

  const handleMakeOffer = async () => {
    if (!offerAmount || parseFloat(offerAmount) <= 0) { toast.error("Enter valid offer amount"); return; }
    setTxPending(true);
    try {
      toast.loading("Submitting offer...", { id: "offer" });
      const hash = await writeContractAsync({ address: collection as `0x${string}`, abi: NFT_ABI, functionName: "makeCollectionOffer", value: parseEther(offerAmount) });
      await waitForTransactionReceipt(config, { hash });
      toast.success("Offer submitted!", { id: "offer" });
      setOfferMode(false);
      await load();
    } catch (e: any) {
      toast.error(friendlyTxError(e, "Offer failed"), { id: "offer" });
    } finally {
      setTxPending(false);
    }
  };

  const handleCancelOffer = async () => {
    setTxPending(true);
    try {
      toast.loading("Cancelling offer...", { id: "cancel-offer" });
      const hash = await writeContractAsync({ address: collection as `0x${string}`, abi: NFT_ABI, functionName: "cancelCollectionOffer" });
      await waitForTransactionReceipt(config, { hash });
      toast.success("Offer cancelled, ETH returned", { id: "cancel-offer" });
      await load();
    } catch (e: any) {
      toast.error(friendlyTxError(e, "Cancel failed"), { id: "cancel-offer" });
    } finally {
      setTxPending(false);
    }
  };

  const handleSellPreBonding = async () => {
    setTxPending(true);
    try {
      toast.loading("Selling back to pool...", { id: "presell" });
      const hash = await writeContractAsync({ address: collection as `0x${string}`, abi: NFT_ABI, functionName: "sellPreBonding", args: [BigInt(tokenId)] });
      await waitForTransactionReceipt(config, { hash });
      toast.success("Sold back to pool", { id: "presell" });
      setSellConfirm(false);
      await load();
    } catch (e: any) {
      toast.error(friendlyTxError(e, "Sell failed"), { id: "presell" });
    } finally {
      setTxPending(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-pulse">
          <div className="aspect-square bg-panel rounded-lg" />
          <div className="space-y-4">{[1,2,3,4].map(i => <div key={i} className="h-10 bg-panel rounded" />)}</div>
        </div>
      </div>
    );
  }

  if (!nft) return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <p className="text-text-dim">NFT not found</p>
    </div>
  );

  const isOwner = nft.owner.toLowerCase() === address?.toLowerCase();
  const bonded = Boolean(colInfo?.bondingComplete);
  const isListed = nft.listPrice > BigInt(0);
  const isExpired = nft.listExpiry > BigInt(0) && nft.listExpiry < BigInt(Math.floor(Date.now() / 1000));
  const hidden = !reveal.revealed || !onChainRevealed; // off-chain timer OR on-chain reveal pending
  const rarityColor = hidden ? "#9ca3af" : RARITY_COLORS[nft.rarity];
  const photo = hidden ? (reveal.placeholderURI || MYSTERY_URI)
    : nft.imageURI ? nft.imageURI
    : (colInfo?.photoURIs?.[nft.rarity] || null);

  const expiryLabel = nft.listExpiry > BigInt(0)
    ? isExpired
      ? "Listing expired"
      : `Expires ${new Date(Number(nft.listExpiry) * 1000).toLocaleString()}`
    : "No expiry";

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 pb-24">
      <Link href={`/collection/${collection}`} className="text-xs font-medium text-text-dim hover:text-accent mb-6 inline-block">
        ← {colInfo?.name || "Collection"}
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        {/* Photo */}
        <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="relative">
          <div className="aspect-square border-2 overflow-hidden rounded-2xl" style={{ borderColor: rarityColor + "55" }}>
            {photo ? (
              <IpfsImage uri={photo} alt={`NFT #${tokenId}`} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-surface">
                <span className="font-mono text-4xl text-text-dim">#{tokenId}</span>
              </div>
            )}
          </div>
          <div className="absolute top-3 left-3">
            <span className="px-2.5 py-1 text-xs font-bold text-white rounded-full" style={{ background: rarityColor }}>
              {hidden
                ? reveal.revealAt ? `REVEALS IN ${formatRevealCountdown(reveal.revealAt)}` : "UNREVEALED"
                : RARITY_NAMES[nft.rarity]?.toUpperCase()}
            </span>
          </div>
          {isListed && !isExpired && (
            <div className="absolute top-3 right-3 bg-sea text-ink text-xs px-2.5 py-0.5 font-bold rounded-full">
              FOR SALE
            </div>
          )}
        </motion.div>

        {/* Info */}
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold text-text-dim uppercase tracking-wide mb-1">NFT</p>
            <h1 className="text-3xl font-bold text-text-primary" style={{ fontFamily: "var(--font-display)" }}>
              {colInfo?.name || "-"} #{tokenId}
            </h1>
            <div className="flex items-center gap-1.5 font-mono text-xs text-text-dim mt-1">
              <span>Owner:</span>
              {isOwner ? <span>You</span> : <CopyAddress address={nft.owner} title="Copy owner address" className="text-xs text-text-dim" />}
            </div>
          </div>

          {/* Price card */}
          <div className="border border-border rounded-xl p-4 bg-surface">
            {isListed && !isExpired ? (
              <>
                <p className="text-xs font-semibold text-text-dim uppercase tracking-wide mb-1">LISTED PRICE</p>
                <p className="text-3xl font-bold text-accent" style={{ fontFamily: "var(--font-display)" }}>
                  {formatEther(nft.listPrice)} ETH
                </p>
                <p className="text-[10px] text-text-dim mt-1">{expiryLabel}</p>
              </>
            ) : isExpired ? (
              <p className="text-sm text-down">Listing expired</p>
            ) : (
              <>
                <p className="text-sm text-text-dim">Not listed for sale</p>
                {nft.lastSalePrice > BigInt(0) && (
                  <p className="text-xs text-text-dim mt-1">Last sale: <span className="font-mono">{formatEther(nft.lastSalePrice)} ETH</span></p>
                )}
              </>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-2">
            {/* Pre-bonding owner: sell back to the pool with a 50% penalty */}
            {isOwner && !bonded && (
              sellConfirm ? (
                <div className="space-y-2 border border-down/30 rounded-xl p-3 bg-down/10">
                  <p className="text-xs text-gray-700">
                    Selling back before bonding burns the NFT and returns half of its pool share.
                    The other 50% goes to the platform. This cannot be undone.
                  </p>
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-gray-500">You receive</span>
                    <span className="text-gray-800">{formatEther(preReturn)} ETH</span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleSellPreBonding} disabled={txPending}
                      className="btn-danger-solid flex-1">
                      {txPending ? "SELLING..." : "CONFIRM SELL"}
                    </button>
                    <button onClick={() => setSellConfirm(false)} className="btn-ghost">
                      CANCEL
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setSellConfirm(true)} className="btn-danger btn-block">
                  SELL BACK TO POOL (−50%)
                </button>
              )
            )}

            {/* Buyer actions */}
            {!isOwner && bonded && isListed && !isExpired && (
              <button onClick={handleBuy} disabled={txPending} className="btn-primary btn-block">
                {txPending ? "BUYING..." : `BUY FOR ${formatEther(nft.listPrice)} ETH`}
              </button>
            )}

            {!isOwner && bonded && (
              myOffer > BigInt(0) ? (
                <div className="flex gap-2">
                  <div className="flex-1 py-2.5 border border-amber/40 rounded-xl text-center font-mono text-xs text-accent">
                    Offer: {formatEther(myOffer)} ETH
                  </div>
                  <button onClick={handleCancelOffer} disabled={txPending} className="btn-danger">
                    CANCEL
                  </button>
                </div>
              ) : (
                offerMode ? (
                  <div className="space-y-2">
                    <input
                      type="number" min="0" step="0.001" placeholder="Offer amount in ETH"
                      value={offerAmount} onChange={e => setOfferAmount(e.target.value)}
                      className="w-full px-3 py-2.5 border border-border rounded-xl font-mono text-sm bg-surface focus:outline-none focus:border-amber"
                    />
                    <div className="flex gap-2">
                      <button onClick={handleMakeOffer} disabled={txPending} className="btn-outline flex-1">
                        {txPending ? "SUBMITTING..." : "SUBMIT OFFER"}
                      </button>
                      <button onClick={() => setOfferMode(false)} className="btn-ghost">
                        CANCEL
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setOfferMode(true)} className="btn-outline btn-block">
                    MAKE COLLECTION OFFER
                  </button>
                )
              )
            )}

            {/* Owner actions (post-bonding marketplace) */}
            {isOwner && bonded && !listMode && (
              <div className="flex gap-2">
                <button onClick={() => setListMode(true)} className="btn-outline flex-1">
                  {isListed && !isExpired ? "UPDATE LISTING" : "LIST FOR SALE"}
                </button>
                {isListed && (
                  <button onClick={handleCancelListing} disabled={txPending} className="btn-danger">
                    DELIST
                  </button>
                )}
              </div>
            )}

            {isOwner && bonded && listMode && (
              <div className="space-y-2">
                <input
                  type="number" min="0" step="0.001" placeholder="Price in ETH"
                  value={listPrice} onChange={e => setListPrice(e.target.value)}
                  className="w-full px-3 py-2.5 border border-border rounded-xl font-mono text-sm bg-surface focus:outline-none focus:border-amber"
                />
                <select
                  value={listExpiry}
                  onChange={e => setListExpiry(Number(e.target.value))}
                  className="w-full px-3 py-2.5 border border-border rounded-xl font-mono text-sm bg-surface focus:outline-none focus:border-amber text-text-primary"
                >
                  {EXPIRY_OPTIONS.map(opt => (
                    <option key={opt.seconds} value={opt.seconds}>{opt.label}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button onClick={handleList} disabled={txPending} className="btn-primary flex-1">
                    {txPending ? "LISTING..." : "CONFIRM LIST"}
                  </button>
                  <button onClick={() => setListMode(false)} className="btn-ghost">
                    CANCEL
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Details */}
          <div className="border border-border rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-3">DETAILS</p>
            {[
              { label: "Token ID", value: `#${tokenId}` },
              { label: "Rarity", value: hidden ? "Unrevealed" : RARITY_NAMES[nft.rarity], color: rarityColor },
              { label: "Collection", value: `${(collection as string).slice(0,6)}…${(collection as string).slice(-4)}`, addr: collection as string },
              { label: "Standard", value: "ERC-1155" },
              ...(nft.lastSalePrice > BigInt(0) ? [{ label: "Last Sale", value: `${formatEther(nft.lastSalePrice)} ETH` }] : []),
            ].map(d => (
              <div key={d.label} className="flex justify-between text-xs">
                <span className="text-text-dim">{d.label}</span>
                {(d as any).addr ? (
                  <CopyAddress address={(d as any).addr} display={d.value} title="Copy collection address" className="text-xs text-text-primary" />
                ) : (
                  <span style={(d as any).color ? { color: (d as any).color } : {}} className={(d as any).color ? "font-mono" : "font-mono text-text-primary"}>{d.value}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Price history */}
      {history.length > 0 && (
        <div className="mt-10 border border-border rounded-2xl p-6">
          <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-4">PRICE HISTORY</p>
          <div className="space-y-2">
            {history.map((h, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0 font-mono text-xs">
                <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${
                  h.type === "minted" ? "bg-blue-50 text-blue-600" :
                  h.type === "listed" ? "bg-amber/10 text-accent" :
                  "bg-mint text-accent"
                }`}>
                  {h.type.toUpperCase()}
                </span>
                <span className="text-text-primary">{h.price > 0 ? `${formatEther(h.price)} ETH` : "-"}</span>
                <CopyAddress address={h.from} title="Copy address" className="text-xs text-text-dim" />
                <span className="text-text-dim">#{h.block.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
