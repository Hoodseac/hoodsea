// Set the AirdropDistributor merkle root so a SINGLE address can claim.
// Single-recipient => the merkle tree has one leaf, so root == that leaf and proof == [].
//
// Usage (run from contracts dir):
//   AIRDROP_DISTRIBUTOR=0x... ORACLE_PRIVATE_KEY=0x... \
//     node scripts/setAirdropRoot.js <token> <recipient> <cumulativeWholeTokens>
//
// IMPORTANT: the amount is CUMULATIVE (total claimable since day 1), NOT per-epoch.
//   (the distributor pays cumulative - alreadyClaimed)
// setRoot is oracle-only -> needs ORACLE_PRIVATE_KEY in the environment (never in a
// file inside the repo).

const { ethers } = require("ethers");
require("dotenv").config();

// AirdropDistributor on Robinhood Chain (chainId 4663)
const DIST = process.env.AIRDROP_DISTRIBUTOR || "";
const RPC = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// leaf must match the contract: keccak256(bytes.concat(keccak256(abi.encode(account, amount))))
function leafFor(account, amount) {
  const inner = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [account, amount])
  );
  return ethers.keccak256(inner);
}

async function main() {
  const [, , token, recipient, whole] = process.argv;
  if (!token || !recipient || !whole) {
    console.error("usage: node scripts/setAirdropRoot.js <token> <recipient> <cumulativeWholeTokens>");
    process.exit(1);
  }
  if (!DIST) throw new Error("set AIRDROP_DISTRIBUTOR in the environment");
  if (!process.env.ORACLE_PRIVATE_KEY) throw new Error("set ORACLE_PRIVATE_KEY in the environment");
  if (!ethers.isAddress(token) || !ethers.isAddress(recipient)) throw new Error("bad token/recipient address");

  const amount = ethers.parseUnits(String(whole), 18); // cumulative, 18 decimals
  const root = leafFor(recipient, amount); // single leaf => root = leaf, proof = []
  console.log("token     :", token);
  console.log("recipient :", recipient);
  console.log("cumulative:", whole, "tokens =", amount.toString(), "wei");
  console.log("root      :", root);

  const p = new ethers.JsonRpcProvider(RPC);
  const w = new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY, p);
  console.log("oracle    :", w.address, "gas:", ethers.formatEther(await p.getBalance(w.address)), "ETH");

  const dist = new ethers.Contract(DIST, [
    "function setRoot(address,bytes32)",
    "function merkleRoot(address) view returns (bytes32)",
    "function claimable(address,address,uint256,bytes32[]) view returns (uint256)",
  ], w);
  const tx = await dist.setRoot(token, root);
  console.log("setRoot tx:", tx.hash);
  const rc = await tx.wait();
  console.log("MINED status:", rc.status, rc.status === 1 ? "(SUCCESS)" : "(REVERTED)", "block:", rc.blockNumber);

  // verify
  await sleep(3000);
  console.log("on-chain root:", await dist.merkleRoot(token));
  const c = await dist.claimable(token, recipient, amount, []).catch(() => null);
  console.log("claimable by recipient:", c === null ? "(read failed, retry)" : ethers.formatUnits(c, 18), "tokens");
  console.log("\nNow the recipient claims (from THEIR wallet):");
  console.log(`  claim(token=${token}, cumulativeAmount=${amount.toString()}, proof=[])  on ${DIST}`);
}

main().catch((e) => { console.error("ERR:", e.shortMessage || e.message); process.exit(1); });
