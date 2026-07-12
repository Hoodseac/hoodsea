import { createPublicClient, http, formatEther } from "viem";
import { baseSepolia } from "viem/chains";
const pub = createPublicClient({ chain: baseSepolia, transport: http("https://base-sepolia-rpc.publicnode.com") });
const OLD_VAULT = "0x856B283164Bd530Ae8E58DA50501df93E944D667";
const NEW_VAULT = "0xaD412EC891079975Ba7d6E487Cb2248bea8DAaB4";
const DIST = "0xC6DBd00B300CC6467D4C9D0A39EF86a08b34baac";
const FACTORY = "0x8293632E607d1142682f7509e6878D8B95cb348e";
const TOKENS = ["0x7004395a113B085108c8926699733f240FD365F5","0x1D859ccEc9D34fcE92AEA9A78d934Bf49816197F","0x0b895b433c33C070AFf392b5D0e56e64A0cb6aBD"];

const fmt = (x) => formatEther(x);
console.log("=== ETH balances ===");
console.log("old vault 0x856B:", fmt(await pub.getBalance({address:OLD_VAULT})));
console.log("new vault 0xaD41:", fmt(await pub.getBalance({address:NEW_VAULT})));
console.log("distributor 0xC6DB:", fmt(await pub.getBalance({address:DIST})));

console.log("\n=== redeploy state ===");
const facABI=[{name:"airdropVault",type:"function",stateMutability:"view",inputs:[],outputs:[{type:"address"}]}];
try{const av=await pub.readContract({address:FACTORY,abi:facABI,functionName:"airdropVault"});console.log("factory.airdropVault ->",av, av.toLowerCase()===NEW_VAULT.toLowerCase()?"(NEW ✓)":av.toLowerCase()===OLD_VAULT.toLowerCase()?"(still OLD)":"(other)");}catch(e){console.log("factory.airdropVault read fail:",e.shortMessage);}
const vABI=[{name:"airdropDistributor",type:"function",stateMutability:"view",inputs:[],outputs:[{type:"address"}]}];
try{const d=await pub.readContract({address:NEW_VAULT,abi:vABI,functionName:"airdropDistributor"});console.log("newVault.airdropDistributor ->",d, d.toLowerCase()===DIST.toLowerCase()?"(wired ✓)":"(mismatch)");}catch(e){console.log("newVault.airdropDistributor read fail (versi lama?):",e.shortMessage);}

console.log("\n=== splitter fees (swap) per bonded token ===");
const f2s=[{name:"tokenToSplitter",type:"function",stateMutability:"view",inputs:[{type:"address"}],outputs:[{type:"address"}]}];
let totalSplit=0n;
for(const t of TOKENS){
  try{const s=await pub.readContract({address:FACTORY,abi:f2s,functionName:"tokenToSplitter",args:[t]});
    const b=await pub.getBalance({address:s}); totalSplit+=b;
    console.log(`${t.slice(0,10)} splitter ${s.slice(0,10)} bal=${fmt(b)} ETH`);
  }catch(e){console.log(t.slice(0,10),"splitter fail",e.shortMessage);}
}
console.log("total in splitters:", fmt(totalSplit), "ETH (distribute() bagi ~26% balik ke deployer/platform+kas)");
