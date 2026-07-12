// Quick balance audit for the testnet seeding bot.
import { createPublicClient, http, fallback, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";

const ROOT = "/root/recomendasi/recomendasi/contracts";
const env = readFileSync(`${ROOT}/.env`, "utf8");
const PK = (() => { const m = env.match(/PRIVATE_KEY=(.+)/)[1].trim(); return m.startsWith("0x") ? m : "0x" + m; })();
const wallets = JSON.parse(readFileSync(`${ROOT}/test-wallets.json`, "utf8"));

const pub = createPublicClient({ chain: baseSepolia, transport: fallback([
  http("https://base-sepolia-rpc.publicnode.com"), http("https://sepolia.base.org")]) });

const deployer = privateKeyToAccount(PK);
const dBal = await pub.getBalance({ address: deployer.address });
console.log("deployer", deployer.address, formatEther(dBal), "ETH");

let total = 0n, funded = 0;
for (const w of wallets) {
  const b = await pub.getBalance({ address: w.address });
  total += b;
  if (b > 0n) funded++;
}
console.log(`creators: ${wallets.length} wallets, ${funded} funded, total ${formatEther(total)} ETH`);
console.log("grand total available:", formatEther(dBal + total), "ETH");
