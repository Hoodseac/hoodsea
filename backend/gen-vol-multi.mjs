// Volume bot (multi wallet x multi token): several test wallets each buy every
// token in TOKENS via the Hoodsea swap router to generate trade volume + swap fees.
//
// Env (.env in this dir): ROBINHOOD_RPC_URL, ORACLE_PRIVATE_KEY, SWAP_ROUTER,
//   FEE_HOOK, TOKENS (comma list), WALLETS_FILE (default ../contracts/test-wallets.json),
//   BUYERS (comma list of wallet indexes, default 10,11,12,13,14),
//   PER_ETH (default 0.03), SWAPS (default 2).
import "dotenv/config";
import { createPublicClient, createWalletClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { robinhood, RPC_URL } from "./chain.mjs";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`set ${k} in .env`); process.exit(1); } return v; };

const OPK0 = need("ORACLE_PRIVATE_KEY");
const OPK = OPK0.startsWith("0x") ? OPK0 : "0x" + OPK0;
const ROUTER = need("SWAP_ROUTER");
const HOOK = need("FEE_HOOK");
const TOKENS = need("TOKENS").split(",").map((t) => t.trim()).filter(Boolean);
const ZERO = "0x0000000000000000000000000000000000000000";
const WALLETS_FILE = process.env.WALLETS_FILE || join(HERE, "../contracts/test-wallets.json");
const W = JSON.parse(readFileSync(WALLETS_FILE, "utf8")).map((w) => ({ ...w, pk: w.pk.startsWith("0x") ? w.pk : "0x" + w.pk }));

const tr = http(RPC_URL);
const pub = createPublicClient({ chain: robinhood, transport: tr });
const oracle = privateKeyToAccount(OPK);
const oWal = createWalletClient({ account: oracle, chain: robinhood, transport: tr });

const RABI = [{ name: "swapExactIn", type: "function", stateMutability: "payable", inputs: [{ name: "key", type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] }, { name: "zeroForOne", type: "bool" }, { name: "amountIn", type: "uint256" }, { name: "minOut", type: "uint256" }, { name: "recipient", type: "address" }], outputs: [{ type: "uint256" }] }];
const wait = (h) => pub.waitForTransactionReceipt({ hash: h });

const BUYERS = (process.env.BUYERS || "10,11,12,13,14").split(",").map(Number);
const PER = parseEther(process.env.PER_ETH || "0.03");
const SWAPS = Number(process.env.SWAPS || 2);
let vol = 0n;
for (const bi of BUYERS) {
  const B = privateKeyToAccount(W[bi].pk);
  const bw = createWalletClient({ account: B, chain: robinhood, transport: tr });
  const bal = await pub.getBalance({ address: B.address });
  const need_ = PER * BigInt(SWAPS * TOKENS.length) + parseEther("0.01");
  if (bal < need_) { await wait(await oWal.sendTransaction({ to: B.address, value: need_ - bal })); }
  for (const t of TOKENS) {
    for (let s = 0; s < SWAPS; s++) {
      try { await wait(await bw.writeContract({ address: ROUTER, abi: RABI, functionName: "swapExactIn", args: [[ZERO, t, 0, 60, HOOK], true, PER, 0n, B.address], value: PER, gas: 900000n })); vol += PER; }
      catch (e) { console.log("swap fail w" + bi, t.slice(0, 8), (e.shortMessage || e.message).slice(0, 40)); }
    }
  }
  console.log(`buyer[${bi}] ${B.address.slice(0, 10)} done (${SWAPS}x${TOKENS.length} swaps)`);
}
console.log("TOTAL VOLUME generated:", formatEther(vol), "ETH (fee 1.5% =", formatEther(vol * 15n / 1000n), "ETH, airdrop 0.1% =", formatEther(vol / 1000n), "ETH)");
