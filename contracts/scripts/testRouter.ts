import { ethers } from "hardhat";
import * as fs from "fs";
async function poll(fn,ok,t=30){let v;for(let i=0;i<t;i++){try{v=await fn();if(ok(v))return v;}catch(_){}await new Promise(r=>setTimeout(r,2000));}return v;}
async function main(){
  const [d]=await ethers.getSigners();
  const dep=JSON.parse(fs.readFileSync(process.env.DEPLOYMENT_FILE || "deployment-robinhood.json","utf8"));
  const factory=await ethers.getContractAt("HoodseaTokenFactory",dep.tokenFactory);
  const router=await ethers.getContractAt("HoodseaSwapRouter",dep.swapRouter);
  const col=ethers.Wallet.createRandom().address;
  console.log("deployToken on production factory...");
  await (await factory.deployToken(col,d.address,"RtrTest","RTR","ipfs://x","b","","","",150,{value:ethers.parseEther("0.004")})).wait();
  const token=await poll(()=>factory.collectionToToken(col),v=>v!==ethers.ZeroAddress);
  const splitter=await factory.tokenToSplitter(token);
  console.log("token",token,"splitter",splitter);
  const key=[ethers.ZeroAddress,token,0,60,dep.feeHook];
  const erc=await ethers.getContractAt("HoodseaToken",token);
  const sb=await ethers.provider.getBalance(splitter);
  // BUY via router
  const buyIn=ethers.parseEther("0.0008");
  console.log("[BUY] via router...");
  await (await router.swapExactIn(key,true,buyIn,0,d.address,{value:buyIn})).wait();
  const tb=await poll(()=>erc.balanceOf(d.address),v=>v>0n);
  console.log("  token received:",ethers.formatEther(tb));
  // SELL via router
  const sell=tb/2n;
  await (await erc.approve(dep.swapRouter,sell)).wait();
  console.log("[SELL] via router...");
  const ethBefore=await ethers.provider.getBalance(d.address);
  await (await router.swapExactIn(key,false,sell,0,d.address)).wait();
  const sa=await poll(()=>ethers.provider.getBalance(splitter),v=>v>sb);
  console.log("  splitter ETH total:",ethers.formatEther(sa),"(fee from buy+sell)");
  console.log("DONE router buy+sell OK");
}
main().catch(e=>{console.error(e);process.exit(1);});
