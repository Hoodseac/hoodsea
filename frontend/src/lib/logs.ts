// Chunked eth_getLogs.
//
// Public Base RPCs cap eth_getLogs at a small block range (drpc serves ~5k blocks
// reliably; Alchemy's free tier only 10). A single wide call (e.g. 45k blocks)
// silently fails and returns nothing, which made volume read as 0 and differ
// between pages (marketplace vs leaderboard vs profile). Scanning in safe windows
// and concatenating gives every page the same complete data, so totals match.
export async function scanLogs(
  client: any,
  base: Record<string, any>,
  lookbackBlocks: bigint = 45000n,
  step: bigint = 4500n,
): Promise<any[]> {
  if (!client) return [];
  const latest: bigint = await client.getBlockNumber();
  const start0 = latest > lookbackBlocks ? latest - lookbackBlocks : 0n;
  const out: any[] = [];
  let end = latest;
  for (let i = 0; i < 20; i++) {
    const from = end - step + 1n > start0 ? end - step + 1n : start0;
    const logs = await client.getLogs({ ...base, fromBlock: from, toBlock: end }).catch(() => []);
    out.push(...logs);
    if (from === start0) break;
    end = from - 1n;
  }
  return out;
}
