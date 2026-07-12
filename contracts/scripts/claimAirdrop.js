// Claim the airdrop for a single-recipient root (proof = []).
// The recipient itself must sign (the contract checks msg.sender), so this needs the
// recipient's private key (env RECIPIENT_PK) and a little ETH gas on that wallet.
//
// Usage (run from contracts dir):
//   AIRDROP_DISTRIBUTOR=0x... RECIPIENT_PK=0x... \
//     node scripts/claimAirdrop.js <token> <cumulativeWholeTokens>

const { ethers } = require("ethers");
require("dotenv").config();

const DIST = process.env.AIRDROP_DISTRIBUTOR || "";
const RPC = process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [, , token, whole] = process.argv;
  const pk = process.env.RECIPIENT_PK;
  if (!token || !whole || !pk) {
    console.error("usage: RECIPIENT_PK=0x... node scripts/claimAirdrop.js <token> <cumulativeWholeTokens>");
    process.exit(1);
  }
  if (!DIST) throw new Error("set AIRDROP_DISTRIBUTOR in the environment");
  const amount = ethers.parseUnits(String(whole), 18);
  const p = new ethers.JsonRpcProvider(RPC);
  const w = new ethers.Wallet(pk, p);
  const tok = new ethers.Contract(token, ["function balanceOf(address) view returns(uint256)"], p);
  console.log("claimer:", w.address, "| gas:", ethers.formatEther(await p.getBalance(w.address)), "ETH");
  console.log("balance before:", ethers.formatUnits(await tok.balanceOf(w.address), 18));

  const dist = new ethers.Contract(DIST, ["function claim(address,uint256,bytes32[])"], w);
  const tx = await dist.claim(token, amount, []);
  console.log("claim tx:", tx.hash);
  const rc = await tx.wait();
  console.log("MINED status:", rc.status, rc.status === 1 ? "(SUCCESS)" : "(REVERTED)", "block:", rc.blockNumber);
  await sleep(3000);
  console.log("balance after:", ethers.formatUnits(await tok.balanceOf(w.address), 18));
}

main().catch((e) => { console.error("ERR:", e.shortMessage || e.message); process.exit(1); });
