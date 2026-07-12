"use client";

import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { useReadContract, useBalance } from "wagmi";
import { CONTRACTS } from "@/lib/contracts";

// Public, live "unclaimed fee" indicator. It reads the token's fee splitter
// balance straight from chain and refetches, so it always matches reality:
// when the fee is distributed/claimed the splitter empties and this drops to
// $0; as new trades accrue fees it rises again. No backend, no caching.
//
// Reusable: the same display will back the direct-fee escrow once that ships
// (swap the data source from the splitter to the escrow's pending balance).

const FACTORY_SPLITTER_ABI = [
  { name: "tokenToSplitter", type: "function", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "address" }] },
] as const;

const ZERO = "0x0000000000000000000000000000000000000000";
// Creator receives CREATOR_BPS/TOTAL_BPS of every fee (100 of 150).
const CREATOR_NUM = 100n;
const FEE_DEN = 150n;

export function UnclaimedFee({ token }: { token: `0x${string}` }) {
  const [ethUsd, setEthUsd] = useState(0);
  useEffect(() => {
    fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd")
      .then((r) => r.json())
      .then((d) => setEthUsd(d?.ethereum?.usd || 0))
      .catch(() => {});
  }, []);

  const { data: splitter } = useReadContract({
    address: CONTRACTS.tokenFactory,
    abi: FACTORY_SPLITTER_ABI,
    functionName: "tokenToSplitter",
    args: [token],
    query: { enabled: !!token },
  });

  const splitterAddr = splitter as `0x${string}` | undefined;
  const hasSplitter = !!splitterAddr && splitterAddr !== ZERO;

  const { data: bal } = useBalance({
    address: splitterAddr,
    query: { enabled: hasSplitter, refetchInterval: 15000 },
  });

  if (!hasSplitter) return null;

  const accrued = bal?.value ?? 0n;
  const creatorShare = (accrued * CREATOR_NUM) / FEE_DEN;
  const eth = Number(formatEther(creatorShare));
  const usd = eth * ethUsd;

  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-secondary">Unclaimed fee</span>
      <span className="font-mono font-semibold text-text-primary" title={`${eth.toFixed(6)} ETH`}>
        {ethUsd > 0
          ? `$${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
          : `${eth.toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH`}
      </span>
    </div>
  );
}
