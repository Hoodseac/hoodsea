// Wallet actions for the connected external wallet: send any token and
// swap via the 0x aggregator. Ported from the Telegram bot's 0x v2 permit2 flow
// to viem/wagmi. No platform fee. ETH<->WETH is a direct wrap/unwrap (no 0x).
import type { WalletClient, PublicClient } from "viem";
import { parseUnits, formatUnits, erc20Abi, concat, numberToHex, size, maxUint256, isAddress, getAddress } from "viem";

const API = process.env.NEXT_PUBLIC_PROFILE_API || "";

// 0x uses this sentinel for native ETH.
export const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;
// Wrapped ETH on Robinhood Chain.
export const WETH = (process.env.NEXT_PUBLIC_WETH ||
  "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73") as `0x${string}`;
// Optional: a USDC deployment on Robinhood Chain (leave unset to hide it).
const USDC = process.env.NEXT_PUBLIC_USDC as `0x${string}` | undefined;

export interface TokenInfo { address: `0x${string}` | typeof NATIVE; symbol: string; decimals: number }

// Common tokens offered in the picker; users can also paste any contract address.
export const COMMON_TOKENS: TokenInfo[] = [
  { address: NATIVE, symbol: "ETH", decimals: 18 },
  { address: WETH, symbol: "WETH", decimals: 18 },
  ...(USDC ? [{ address: USDC, symbol: "USDC", decimals: 6 } as TokenInfo] : []),
];

const WETH_ABI = [
  { name: "deposit", type: "function", stateMutability: "payable", inputs: [], outputs: [] },
  { name: "withdraw", type: "function", stateMutability: "nonpayable", inputs: [{ name: "wad", type: "uint256" }], outputs: [] },
] as const;

const isNative = (a: string) => a.toLowerCase() === NATIVE.toLowerCase();

/** Read decimals + symbol for an arbitrary ERC-20 (for the custom-token path). */
export async function fetchToken(publicClient: PublicClient, address: string): Promise<TokenInfo> {
  if (!isAddress(address)) throw new Error("Invalid address");
  const addr = getAddress(address);
  const [decimals, symbol] = await Promise.all([
    publicClient.readContract({ address: addr, abi: erc20Abi, functionName: "decimals" }),
    publicClient.readContract({ address: addr, abi: erc20Abi, functionName: "symbol" }),
  ]);
  return { address: addr, symbol: symbol as string, decimals: Number(decimals) };
}

/** Send ETH or an ERC-20 to a recipient. Returns the tx hash. */
export async function sendToken(
  wc: WalletClient, pc: PublicClient, token: TokenInfo, to: string, amountHuman: string,
): Promise<`0x${string}`> {
  if (!isAddress(to)) throw new Error("Invalid recipient address");
  const account = wc.account!;
  const amount = parseUnits(amountHuman, token.decimals);
  if (isNative(token.address)) {
    return wc.sendTransaction({ account, chain: wc.chain, to: getAddress(to), value: amount });
  }
  return wc.writeContract({
    account, chain: wc.chain, address: token.address as `0x${string}`, abi: erc20Abi,
    functionName: "transfer", args: [getAddress(to), amount],
  });
}

/** Fetch a 0x quote (through the profileapi proxy). */
export async function getSwapQuote(params: {
  sellToken: string; buyToken: string; sellAmount: bigint; taker: string; slippageBps?: number;
}): Promise<any> {
  const q = new URLSearchParams({
    chainId: String(process.env.NEXT_PUBLIC_CHAIN_ID || 4663),
    sellToken: params.sellToken, buyToken: params.buyToken,
    sellAmount: params.sellAmount.toString(), taker: params.taker,
    slippageBps: String(params.slippageBps ?? 100),
  });
  const r = await fetch(`${API}/api/swap/quote?${q}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Quote failed");
  if (d.liquidityAvailable === false) throw new Error("No liquidity for this pair");
  return d;
}

/**
 * Swap `sell` -> `buy` for `amountHuman` of the sell token.
 * ETH<->WETH is a direct wrap/unwrap (no aggregator, no fee). Everything else
 * goes through the 0x quote: approve if needed, sign permit2 if present, send.
 * Returns the tx hash.
 */
export async function swapTokens(
  wc: WalletClient, pc: PublicClient, sell: TokenInfo, buy: TokenInfo, amountHuman: string, slippageBps = 100,
): Promise<`0x${string}`> {
  const account = wc.account!;
  const sellAmount = parseUnits(amountHuman, sell.decimals);

  // Direct wrap / unwrap (fee-free, no 0x).
  if (isNative(sell.address) && buy.address.toLowerCase() === WETH.toLowerCase()) {
    return wc.writeContract({ account, chain: wc.chain, address: WETH, abi: WETH_ABI, functionName: "deposit", value: sellAmount });
  }
  if (sell.address.toLowerCase() === WETH.toLowerCase() && isNative(buy.address)) {
    return wc.writeContract({ account, chain: wc.chain, address: WETH, abi: WETH_ABI, functionName: "withdraw", args: [sellAmount] });
  }

  const quote = await getSwapQuote({
    sellToken: isNative(sell.address) ? NATIVE : (sell.address as string),
    buyToken: isNative(buy.address) ? NATIVE : (buy.address as string),
    sellAmount, taker: account.address, slippageBps,
  });
  const tx = quote.transaction;
  if (!tx?.data || tx.data === "0x") throw new Error("Empty swap calldata");

  // ERC-20 sells need an allowance to the permit2/AllowanceHolder spender.
  if (!isNative(sell.address)) {
    const spender = (quote.permit2?.eip712?.domain?.verifyingContract || tx.to) as `0x${string}`;
    const allowance = await pc.readContract({
      address: sell.address as `0x${string}`, abi: erc20Abi, functionName: "allowance", args: [account.address, spender],
    });
    if ((allowance as bigint) < sellAmount) {
      const ah = await wc.writeContract({
        account, chain: wc.chain, address: sell.address as `0x${string}`, abi: erc20Abi,
        functionName: "approve", args: [spender, maxUint256],
      });
      await pc.waitForTransactionReceipt({ hash: ah });
    }
  }

  // 0x v2 permit2: sign the typed data and append [32-byte length][signature].
  let data = tx.data as `0x${string}`;
  if (quote.permit2?.eip712) {
    const { domain, types, message, primaryType } = quote.permit2.eip712;
    const t = { ...types }; delete (t as any).EIP712Domain;
    const sig = await wc.signTypedData({ account, domain, types: t, primaryType, message });
    data = concat([data, numberToHex(size(sig), { size: 32 }), sig]);
  }

  const value = isNative(sell.address) ? BigInt(tx.value || sellAmount.toString()) : 0n;
  return wc.sendTransaction({ account, chain: wc.chain, to: tx.to as `0x${string}`, data, value });
}

/** Human-readable estimate of how much `buy` you get (for the quote preview). */
export function previewBuyAmount(quote: any, buyDecimals: number): string {
  if (!quote?.buyAmount) return "";
  return formatUnits(BigInt(quote.buyAmount), buyDecimals);
}
