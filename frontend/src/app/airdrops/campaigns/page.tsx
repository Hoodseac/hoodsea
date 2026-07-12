"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, usePublicClient } from "wagmi";
import { fetchAllCampaigns, type Campaign } from "@/lib/originAirdrop";
import { CampaignCard } from "@/components/airdrop/CampaignCard";

export default function CampaignsPage() {
  const client = usePublicClient();
  const { address } = useAccount();
  const [items, setItems] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      setItems(await fetchAllCampaigns(client));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 pb-24">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-4">
          <img src="/airdrop/hero.webp" alt="" width={64} height={64} className="shrink-0 drop-shadow-[0_8px_24px_rgba(0,200,5,0.35)]" />
          <div>
            <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-1">Airdrops</p>
            <h1 className="text-2xl font-bold">Token campaigns</h1>
          </div>
        </div>
        <Link href="/airdrops/create" className="shrink-0 px-4 py-2 rounded-xl bg-sea text-ink text-sm font-bold">Create airdrop</Link>
      </div>
      <p className="text-sm text-text-secondary mb-6 max-w-2xl">
        Community-created token distributions on Robinhood Chain. Allowlist drops pay listed wallets; first-come drops hand out a fixed amount until the pool empties.
      </p>

      <div className="mb-6 text-xs">
        <Link href="/airdrops" className="font-semibold text-accent hover:underline">Community airdrop</Link>
        <span className="text-text-secondary"> · the automatic platform airdrop lives here</span>
      </div>

      {loading && <div className="text-sm text-text-secondary py-12 text-center">Loading campaigns…</div>}

      {!loading && items.length === 0 && (
        <div className="card rounded-2xl border border-border p-8 text-center">
          <img src="/airdrop/empty.webp" alt="" width={88} height={88} className="mx-auto mb-3 opacity-90" />
          <p className="text-sm font-semibold mb-1">No campaigns yet</p>
          <p className="text-xs text-text-secondary max-w-md mx-auto">Be the first to run one. Click Create airdrop to distribute any ERC-20 on Robinhood Chain.</p>
        </div>
      )}

      <div className="space-y-4">
        {items.map((c) => (
          <CampaignCard key={c.id} campaign={c} account={address} onChanged={load} />
        ))}
      </div>
    </div>
  );
}
