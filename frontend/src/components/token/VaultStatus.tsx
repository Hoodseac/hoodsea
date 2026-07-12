"use client";

import { useReadContract, useWriteContract, useAccount } from "wagmi";
import { formatUnits } from "viem";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { CONTRACTS, VAULT_ABI } from "@/lib/contracts";
import { friendlyTxError } from "@/lib/tx-errors";

const EPOCH_LABELS = ["Day 1", "Day 7", "Day 14", "Day 28", "Day 56"];

interface Props {
  tokenAddress: `0x${string}`;
  creator?: string;
}

export function VaultStatus({ tokenAddress, creator }: Props) {
  const { address } = useAccount();
  const isCreator = !creator || !address || address.toLowerCase() === creator.toLowerCase();
  const { data: vaultStatus } = useReadContract({
    address: CONTRACTS.vault,
    abi: VAULT_ABI,
    functionName: "getVaultStatus",
    args: [tokenAddress],
    query: { refetchInterval: 30000 },
  });

  const { writeContractAsync, isPending } = useWriteContract();

  const handleExecuteEpoch = async (epochIndex: number) => {
    try {
      toast.loading(`Executing epoch ${epochIndex + 1}...`, { id: "epoch" });
      await writeContractAsync({
        address: CONTRACTS.vault,
        abi: VAULT_ABI,
        functionName: "executeEpoch",
        args: [tokenAddress, BigInt(epochIndex)],
      });
      toast.success("Epoch executed!", { id: "epoch" });
    } catch (err: any) {
      toast.error(friendlyTxError(err, "Epoch execution failed"), { id: "epoch" });
    }
  };

  if (!vaultStatus) return null;

  const [balance, executed, epochTimes, ready] = vaultStatus;
  const vaultLocked = balance > BigInt(0);
  const balanceFormatted = formatUnits(balance, 18);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary">Vault status</p>
        <span className="badge border-line bg-white/70 tabular-nums text-text-secondary">
          {parseFloat(balanceFormatted).toLocaleString(undefined, { maximumFractionDigits: 0 })} tokens locked
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-1">Airdrop schedule</p>
          <p className="text-sm text-text-secondary">1% per epoch, 5 epochs, to 100 random participants</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-secondary mb-1">Burn schedule</p>
          <p className="text-sm text-text-secondary">9% per epoch, 5 epochs, burned at each epoch</p>
        </div>
      </div>

      {/* Epoch timeline */}
      <div className="relative">
        {/* Track line */}
        <div className="absolute left-4 top-4 bottom-4 w-px bg-line" />

        <div className="space-y-3">
          {EPOCH_LABELS.map((label, i) => {
            const isDone = executed[i] === BigInt(1);
            const isReady = ready[i] && vaultLocked;
            // Epoch times are 0 until the vault is locked (24h after bonding),
            // so guard against rendering the Unix epoch (1970) as a real date.
            const epochSec = Number(epochTimes[i]);
            const epochSet = epochSec > 0;
            const epochTime = new Date(epochSec * 1000);

            return (
              <div key={label} className="flex items-center gap-4 pl-10 relative">
                {/* Dot */}
                <div
                  className={`absolute left-[11px] w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                    isDone
                      ? "border-sea bg-sea"
                      : isReady
                      ? "border-sea bg-sea/20 animate-pulse"
                      : "border-line bg-white"
                  }`}
                >
                  {isDone && (
                    <span className="text-ink text-[10px] font-bold">+</span>
                  )}
                </div>

                <div className="flex-1 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-text-primary">{label}</span>
                      <span className="text-[10px] text-text-dim">
                        Airdrop 1% + Burn 9%
                      </span>
                    </div>
                    <p className="font-mono text-[10px] text-text-dim">
                      {epochSet
                        ? `${epochTime.toLocaleDateString()} ${epochTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} UTC`
                        : "Scheduled after vault lock"}
                    </p>
                  </div>

                  {isCreator && isReady && !isDone && (
                    <button
                      onClick={() => handleExecuteEpoch(i)}
                      disabled={isPending}
                      className="btn-outline btn-sm"
                    >
                      Execute
                    </button>
                  )}

                  {isCreator && !isReady && !isDone && (
                    <div className="text-right">
                      <button disabled className="btn-outline btn-sm">
                        Execute
                      </button>
                      <p className="font-mono text-[9px] text-text-dim mt-0.5">
                        {(() => {
                          if (!epochSet) return "after vault lock";
                          const diff = epochSec * 1000 - Date.now();
                          if (diff <= 0) return "soon";
                          const h = Math.floor(diff / 3600000);
                          const m = Math.floor((diff % 3600000) / 60000);
                          return h > 48 ? `${Math.floor(h/24)}D ${h%24}H` : `${h}H ${m}M`;
                        })()}
                      </p>
                    </div>
                  )}

                  {isDone && (
                    <span className="text-[10px] font-semibold text-accent">Done</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
