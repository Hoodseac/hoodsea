"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, usePublicClient } from "wagmi";
import { CONTRACTS, ORIGIN_AIRDROP_ABI } from "@/lib/contracts";
import { fetchCampaign, type Campaign } from "@/lib/originAirdrop";
import { CampaignCard } from "@/components/airdrop/CampaignCard";

export function CampaignDetail({ id }: { id: number }) {
  const client = usePublicClient();
  const { address } = useAccount();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const count = (await client.readContract({
        address: CONTRACTS.originAirdrop,
        abi: ORIGIN_AIRDROP_ABI,
        functionName: "campaignsCount",
      })) as bigint;
      if (id < 0 || id >= Number(count)) { setStatus("missing"); return; }
      setCampaign(await fetchCampaign(client, id));
      setStatus("ready");
    } catch {
      setStatus("missing");
    }
  }, [client, id]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-xl mx-auto px-4 py-8 pb-24">
      <Link href="/airdrops/campaigns" className="text-xs font-semibold text-accent hover:underline">All campaigns</Link>
      <div className="flex items-center gap-4 mt-2 mb-6">
        <img src="/airdrop/hero.webp" alt="" width={56} height={56} className="shrink-0 drop-shadow-[0_8px_24px_rgba(0,200,5,0.35)]" />
        <div>
          <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-1">Airdrop</p>
          <h1 className="text-2xl font-bold">Campaign #{id}</h1>
        </div>
      </div>

      {status === "loading" && <div className="text-sm text-text-secondary py-12 text-center">Loading…</div>}

      {status === "missing" && (
        <div className="card rounded-2xl border border-border p-8 text-center">
          <p className="text-sm font-semibold mb-1">Campaign not found</p>
          <p className="text-xs text-text-secondary">This airdrop does not exist or was filtered out.</p>
        </div>
      )}

      {status === "ready" && campaign && (
        <CampaignCard campaign={campaign} account={address} onChanged={load} />
      )}
    </div>
  );
}
