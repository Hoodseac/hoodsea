// Human-readable transaction errors. Never dump raw viem/ethers errors at the
// user; map the common failure shapes to a short, plain sentence.

export function friendlyTxError(err: any, fallback = "Transaction failed"): string {
  const raw = String(
    err?.shortMessage || err?.details || err?.message || err || ""
  );
  const m = raw.toLowerCase();

  if (m.includes("user rejected") || m.includes("user denied") || m.includes("rejected the request"))
    return "You cancelled the transaction.";
  if (m.includes("insufficient funds") || m.includes("exceeds the balance"))
    return "Not enough ETH in your wallet to cover this transaction plus gas.";
  if (m.includes("minout") || m.includes("min out") || m.includes("slippage") || m.includes("too little received") || m.includes("insufficient output"))
    return "Price moved too much. Try a higher slippage or a smaller amount.";
  if (m.includes("no liquidity") || m.includes("liquidity") && m.includes("insufficient"))
    return "No liquidity for this trade right now.";
  if (m.includes("pool not initialized") || m.includes("pool_not_initialized"))
    return "This pool is not live yet.";
  if (m.includes("allowance") || m.includes("transfer amount exceeds allowance"))
    return "Approval too low. Approve the token again, then retry.";
  if (m.includes("transfer amount exceeds balance") || m.includes("insufficient balance"))
    return "You do not have enough of this token.";
  if (m.includes("nonce"))
    return "Wallet nonce issue. Wait a moment and try again.";
  if (m.includes("chain") && (m.includes("mismatch") || m.includes("wrong") || m.includes("does not match")))
    return "Wrong network. Switch to Robinhood Chain and retry.";
  if (m.includes("timeout") || m.includes("timed out"))
    return "The network timed out. Please try again.";
  if (m.includes("gas") && (m.includes("estimate") || m.includes("required exceeds")))
    return "The transaction would fail on-chain. Check your amount and try again.";
  if (m.includes("deadline") || m.includes("expired"))
    return "The quote expired. Try again.";

  // Keep whatever short message exists, trimmed; otherwise the fallback.
  const shortMsg = err?.shortMessage;
  if (shortMsg && String(shortMsg).length <= 90) return String(shortMsg);
  return fallback;
}
