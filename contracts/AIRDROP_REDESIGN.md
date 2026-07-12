# Airdrop redesign — technical design (for the audited mainnet build)

Status: DESIGN ONLY. Not implemented on-chain yet. The testnet runs the current
push-based five-epoch token airdrop. This spec is the blueprint for the
claim-based + fee-buyback system that ships with the mainnet redeploy, after a
formal audit. Decisions below were locked with the project owner.

## Goals

1. Make loser rewards **claim-based (pull)** so the protocol never pays gas to
   push to up to 100 addresses per token per day.
2. Route the **0.1% trade fee** (NFT + token swap) to losers, continuously,
   forever, instead of pooling as owner-withdrawable ETH.
3. For collections with a token, convert that ETH into a **daily buyback** so
   losers receive tokens and the buy adds price support.

## Locked decisions

- **Distribution:** equal split among eligible losers (a reward, not loss
  coverage). Off-chain the oracle computes equal amounts.
- **Minimum loss threshold:** 0.001 ETH net loss to qualify (anti dust-sybil).
- **Auto-buyback scope:** only the top 100 tokens by volume each day. The long
  tail is buyback-on-demand, triggered by the claimer.
- **Fee + gas coverage:** the swap fee comes out of the buyback ETH itself (it
  returns to the ecosystem, which is fine). The buyback gas is paid by whoever
  sends the tx (the keeper for the auto set, the user for on-demand). No
  "send 0.00005 ETH first" relay.
- **Claim window:** 24h batches; unclaimed rolls into the next day's pot.
- **Empty day (0 losers):** ETH rolls forward.

## On-chain: AirdropDistributor (new) or extended RecomVault

### State
```
address oracle;               // submits roots, runs auto-buyback
address swapRouter;           // Uniswap V4 router for buyback
mapping(address => uint256) ethPot;     // accrued 0.1% ETH per token
mapping(address => uint256) tokenPot;   // claimable token per token (buyback + epoch)
mapping(address => bool)    hasToken;   // collection has an ERC-20 (token vs ETH claim)
mapping(address => mapping(uint256 => bytes32)) root;     // token => period => merkle root
mapping(address => mapping(uint256 => bool))    claimedBitmap; // double-claim guard (by leaf index)
```

### Fee intake (per-token attribution)
The current splitter/marketplace send ETH to a single vault address with no token
tag. To attribute per token they must call:
```
function notifyFee(address token) external payable;   // ethPot[token] += msg.value
```
Wiring changes: `OriginFeeSplitter` (airdrop slice) and `RecomNFT.buyNFT`
(airdrop fee) call `notifyFee{value: fee}(token)` instead of a blind send.

### Oracle / keeper
```
function setRoot(address token, uint256 period, bytes32 merkleRoot) external onlyOracle;
function buyback(address token, uint256 minOut, uint256 deadline) external onlyOracle; // auto set
```
- `setRoot` freezes the period's claim list (computed off-chain: losers >= 0.001
  ETH, equal split, top 100).
- `buyback` swaps `ethPot[token]` to the token via the router with a slippage
  floor (`minOut`), moving the result into `tokenPot[token]`.

### Claim (pull)
```
function claim(address token, uint256 period, uint256 index, uint256 amount, bytes32[] proof) external nonReentrant;
```
- leaf = `keccak256(abi.encode(index, msg.sender, amount))`.
- verify against `root[token][period]`, check `!claimedBitmap`, set claimed.
- pay from `tokenPot` (token collections) or `ethPot` (NFT-only). Checks-effects-
  interactions; `nonReentrant`.

### On-demand buyback (long tail)
```
function claimWithBuyback(address token, ..., uint256 minOut) external nonReentrant;
```
Swaps a pro-rata slice of `ethPot[token]` to token, then pays the claim. Gas paid
by the caller. Used when the token was not in the daily top-100 auto set.

## Off-chain (oracle)
- At 23:30 UTC: index trades, compute losers (>= 0.001 ETH, equal split), build a
  merkle tree, publish proofs to the profile API, submit the root on-chain, and
  run `buyback` for the top-100-by-volume tokens.
- Continuous for the fee stream; the five-epoch token stream stays as is.

## Frontend
- Airdrops page becomes pull-claim: fetch the connected wallet's `{period, index,
  amount, proof}` from the profile API and show a Claim button calling `claim`.

## Security model (must be re-audited)
- **Merkle claim:** double-claim guarded by `claimedBitmap`; only `oracle` sets
  roots; leaves bind index+address+amount.
- **Buyback MEV (the main risk):** a predictable 23:30 buyback can be sandwiched,
  giving losers fewer tokens. Mitigation shipped: (a) mandatory `minOut` slippage
  floor set from a recent TWAP so a manipulated price reverts the buyback; (b) the
  keeper may split the daily buyback into a few randomized-time chunks; (c)
  consider a private mempool (Flashbots-style) on mainnet.
- **ETH reentrancy:** `nonReentrant` + checks-effects-interactions on all payouts.
- **Per-token accounting:** `ethPot`/`tokenPot` are per token; one token can never
  draw another's funds.
- **Threshold/rounding:** 0.001 ETH minimum off-chain; integer-division dust stays
  in the pot and rolls forward.

## Build order
1. Write `AirdropDistributor.sol` + wire `OriginFeeSplitter` / `RecomNFT.notifyFee`.
2. Hardhat tests: fee intake, setRoot, claim (token + ETH), double-claim revert,
   buyback slippage, on-demand path, time-travel for periods.
3. Oracle: merkle build + root submit + auto-buyback scheduler at 23:30.
4. Frontend: pull-claim Airdrops page.
5. Re-audit (manual + Slither, then formal) before mainnet deploy.
