"use client";

import { useState, useEffect } from "react";
import { useAccount, useWriteContract, useBalance } from "wagmi";
import { formatEther } from "viem";
import toast from "react-hot-toast";
import { NFT_ABI } from "@/lib/contracts";
import { friendlyTxError } from "@/lib/tx-errors";

const API = process.env.NEXT_PUBLIC_PROFILE_API || "";

interface Props { collectionAddress: `0x${string}`; creator: string; mintPrice: bigint; minted: number; bonded: boolean; }

export function CreatorPanel({ collectionAddress, creator, mintPrice, minted, bonded }: Props) {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [claiming, setClaiming] = useState(false);
  const { data: contractBalance, refetch: refetchBalance } = useBalance({ address: collectionAddress, query: { enabled: bonded } });
  // Idempotently timestamp bondedAt server-side once the collection bonds.
  useEffect(() => {
    if (!collectionAddress || !bonded) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API}/api/collection/meta/${collectionAddress}`);
        const d = r.ok ? await r.json() : null;
        if (!cancelled && (!d || !d.bondedAt)) {
          await fetch(`${API}/api/collection/bonded/${collectionAddress}`, { method: "POST" });
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [collectionAddress, bonded]);
  if (!address || address.toLowerCase() !== creator.toLowerCase()) return null;
  const earnings = contractBalance?.value ?? BigInt(0);
  const handleClaim = async () => { setClaiming(true); try { toast.loading("Claiming...",{id:"claim"}); await writeContractAsync({address:collectionAddress,abi:NFT_ABI,functionName:"withdrawEmergency"}); toast.success("Claimed!",{id:"claim"}); setTimeout(()=>refetchBalance(),3000); } catch(e:any){ toast.error(friendlyTxError(e, "Claim failed"),{id:"claim"}); } finally{ setClaiming(false); } };
  return(<div className="card mt-8 border-l-4 border-l-amber"><p className="text-xs font-semibold text-accent uppercase tracking-wide mb-5">CREATOR PANEL</p><div className="flex items-center justify-between"><div><p className="font-semibold text-text-primary">Mint Revenue</p><p className="text-sm text-text-secondary">Contract balance</p></div><div className="text-right"><p className="text-2xl font-bold text-accent">{formatEther(earnings)} ETH</p>{bonded?(earnings===BigInt(0)?<p className="text-xs text-text-dim mt-1">No revenue to claim</p>:<button onClick={handleClaim} disabled={claiming} className="btn-primary btn-sm mt-2">{claiming?"Claiming...":"Claim Revenue"}</button>):<p className="text-xs text-text-dim mt-1">Available after bonding</p>}</div></div></div>);
}
