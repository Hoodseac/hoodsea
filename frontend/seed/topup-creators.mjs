// Top up the 50 seed creator wallets to a target so launch gas never fails.
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";

const cenv = Object.fromEntries(readFileSync("/root/recomendasi/recomendasi/contracts/.env", "utf8").split("\n").filter(l => l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
let dpk = cenv.PRIVATE_KEY; dpk = dpk.startsWith("0x") ? dpk : "0x" + dpk;
const dep = privateKeyToAccount(dpk);
const wallets = JSON.parse(readFileSync("/root/recomendasi/recomendasi/contracts/test-wallets.json", "utf8"));
const RPC = http("https://base-sepolia-rpc.publicnode.com");
const pub = createPublicClient({ chain: baseSepolia, transport: RPC });
const wal = createWalletClient({ account: dep, chain: baseSepolia, transport: RPC });

const TARGET = parseEther("0.004");
let sent = 0n, n = 0;
for (const w of wallets) {
  const b = await pub.getBalance({ address: w.address });
  if (b >= TARGET) continue;
  const top = TARGET - b;
  const h = await wal.sendTransaction({ to: w.address, value: top });
  await pub.waitForTransactionReceipt({ hash: h });
  sent += top; n++;
  if (n % 10 === 0) console.log(`  topped ${n}...`);
}
console.log(`DONE: topped ${n} wallets, sent ${formatEther(sent)} ETH. deployer left: ${formatEther(await pub.getBalance({ address: dep.address }))} ETH`);
