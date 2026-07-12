"use client";

import { useState } from "react";
import { formatEther } from "viem";
import { useReadContract, useBalance, useWriteContract, useConfig } from "wagmi";
import { waitForTransactionReceipt } from "@wagmi/core";
import toast from "react-hot-toast";
import { CONTRACTS, FEE_HOOK_ABI, SPLITTER_ABI, poolIdFor } from "@/lib/contracts";
import { friendlyTxError } from "@/lib/tx-errors";

// Public, visible to everyone: how much swap fee has piled up in this token's
// splitter and is waiting to be distributed. distribute() is permissionless, so
// anyone can release it (creator gets the 66.7% share).
export function ClaimFees({ token }: { token: `0x${string}` }) {
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const [claiming, setClaiming] = useState(false);

  const { data: splitter } = useReadContract({
    address: CONTRACTS.feeHook,
    abi: FEE_HOOK_ABI,
    functionName: "feeRecipient",
    args: [poolIdFor(token)],
  });

  const splitterAddr = splitter as `0x${string}` | undefined;
  const isSet = !!splitterAddr && splitterAddr !== "0x0000000000000000000000000000000000000000";

  const { data: bal, refetch } = useBalance({
    address: splitterAddr,
    query: { enabled: isSet, refetchInterval: 20000 },
  });

  if (!isSet) return null;

  const pending = bal?.value ?? BigInt(0);
  const pendingEth = Number(formatEther(pending));
  const creatorShare = pendingEth * 0.667;

  const handleClaim = async () => {
    if (pending === BigInt(0)) return;
    setClaiming(true);
    try {
      toast.loading("Distributing fees...", { id: "claimfee" });
      const hash = await writeContractAsync({
        address: splitterAddr!,
        abi: SPLITTER_ABI,
        functionName: "distribute",
      });
      await waitForTransactionReceipt(config, { hash });
      toast.success("Fees distributed!", { id: "claimfee" });
      setTimeout(() => refetch(), 2500);
    } catch (e: any) {
      toast.error(friendlyTxError(e, "Distribute failed"), { id: "claimfee" });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber/30 bg-amber/5 px-4 py-2.5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-dim">Unclaimed swap fees</p>
        <p className="font-mono text-sm font-bold text-accent">
          {pendingEth.toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH
        </p>
        {pendingEth > 0 && (
          <p className="text-[10px] text-text-dim">creator gets ~{creatorShare.toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH</p>
        )}
      </div>
      <button
        onClick={handleClaim}
        disabled={claiming || pending === BigInt(0)}
        className="btn-primary btn-sm"
      >
        {claiming ? "CLAIMING..." : "CLAIM"}
      </button>
    </div>
  );
}
