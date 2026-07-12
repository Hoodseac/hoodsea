// Volume bot (single token): a test wallet buys TOKEN via the Hoodsea swap router
// (generates swap fee), then the oracle wallet calls splitter.distribute() so the
// airdrop ETH portion lands in the vault. Leaves the vault funded for the oracle
// snapshot.
//
// Env (.env in this dir): ROBINHOOD_RPC_URL, ORACLE_PRIVATE_KEY, SWAP_ROUTER,
//   FEE_HOOK, TOKEN, SPLITTER, VAULT_ADDRESS,
//   WALLETS_FILE (default ../contracts/test-wallets.json), WALLET_INDEX (default 45),
//   BUY_ETH (default 0.003).
import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseEther, formatEther, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood, RPC_URL } from "./chain.mjs";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`set ${k} in .env`); process.exit(1); } return v; };

const OPK0 = need("ORACLE_PRIVATE_KEY");
const OPK = OPK0.startsWith("0x") ? OPK0 : "0x" + OPK0;
const VAULT = need("VAULT_ADDRESS");
const ROUTER = need("SWAP_ROUTER");
const HOOK = need("FEE_HOOK");
const TOKEN = need("TOKEN");
const SPLITTER = need("SPLITTER");
const ZERO = "0x0000000000000000000000000000000000000000";
const KEY = [ZERO, TOKEN, 0, 60, HOOK];
const WALLETS_FILE = process.env.WALLETS_FILE || join(HERE, "../contracts/test-wallets.json");
const WALLET_INDEX = Number(process.env.WALLET_INDEX || 45);
const BUY = parseEther(process.env.BUY_ETH || "0.003");

const wallets = JSON.parse(readFileSync(WALLETS_FILE, "utf8")).map((w) => ({ ...w, pk: w.pk.startsWith("0x") ? w.pk : "0x" + w.pk }));

const tr = http(RPC_URL);
const pub = createPublicClient({ chain: robinhood, transport: tr });
const oracle = privateKeyToAccount(OPK);
const oWal = createWalletClient({ account: oracle, chain: robinhood, transport: tr });

const ROUTER_ABI = [{ name: "swapExactIn", type: "function", stateMutability: "payable", inputs: [
  { name: "key", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] },
  { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint256" }, { name: "minOut", type: "uint256" }, { name: "recipient", type: "address" }], outputs: [{ type: "uint256" }] }];
const SPLITTER_ABI = parseAbi(["function distribute() external"]);
const wait = (h) => pub.waitForTransactionReceipt({ hash: h });

async function main() {
  const B = privateKeyToAccount(wallets[WALLET_INDEX].pk);
  const bWal = createWalletClient({ account: B, chain: robinhood, transport: tr });

  let bal = await pub.getBalance({ address: B.address });
  console.log(`buyer ${B.address.slice(0, 10)} bal ${formatEther(bal)} ETH`);
  if (bal < BUY + parseEther("0.001")) {
    const top = BUY + parseEther("0.002") - bal;
    console.log(`  topup ${formatEther(top)} ETH from oracle`);
    await wait(await oWal.sendTransaction({ to: B.address, value: top }));
  }

  console.log(`[1] buyer buys ${formatEther(BUY)} ETH of token (swap fee taken by hook)...`);
  await wait(await bWal.writeContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "swapExactIn", args: [KEY, true, BUY, 0n, B.address], value: BUY, gas: 900000n }));

  console.log("[2] splitter.distribute() -> airdrop ETH portion to vault...");
  const before = await pub.getBalance({ address: VAULT });
  await wait(await oWal.writeContract({ address: SPLITTER, abi: SPLITTER_ABI, functionName: "distribute", args: [], gas: 400000n }));
  const after = await pub.getBalance({ address: VAULT });
  console.log(`  vault ${formatEther(before)} -> ${formatEther(after)} ETH  (fee in: ${formatEther(after - before)})`);
  console.log(`\nvault ready for oracle snapshot: ${formatEther(after)} ETH`);
}
main().catch((e) => { console.error(e.shortMessage || e.message || e); process.exit(1); });
