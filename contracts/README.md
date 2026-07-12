# Hoodsea — Smart Contracts

NFT + Token launchpad on Robinhood Chain (chainId 4663).

## Architecture

```
HoodseaLaunchpad (entry point)
│
├── Creates → HoodseaNFT (per collection)
│             ├── Rarity: Common/Uncommon/Rare/Epic/Legendary/Mythic
│             ├── Max 100 supply (bonding curve)
│             ├── Pre-bonding sell: 50% penalty
│             └── Post-bonding: marketplace with 1.5% fee
│
└── HoodseaNFT calls → HoodseaTokenFactory (on 100th mint)
                      │
                      └── Deploys → HoodseaToken (ERC-20)
                                    ├── 1.5% buy/sell fee
                                    │   ├── 1.0% → creator
                                    │   ├── 0.2% → platform treasury
                                    │   ├── 0.1% → airdrop vault
                                    │   └── 0.2% → kas (maintenance)
                                    └── After 24h → lockVault()
                                                    │
                                                    └── HoodseaVault
                                                        ├── 50% locked
                                                        ├── Airdrop: 5% total
                                                        │   (1% × 5 epochs)
                                                        │   Days: 1, 7, 14, 28, 56
                                                        │   → 100 random traders
                                                        └── Burn: 45% total
                                                            (9% × 5 epochs)
                                                            Days: 1, 7, 14, 28, 56
```

## Contracts

| Contract | Purpose |
|---|---|
| `HoodseaNFT.sol` | NFT collection with bonding curve, rarity, scheduling |
| `HoodseaToken.sol` | ERC-20 with trading fees and vault integration |
| `HoodseaTokenFactory.sol` | Deploys tokens when bonding completes |
| `HoodseaVault.sol` | Manages 2-month airdrop + burn schedule |
| `HoodseaLaunchpad.sol` | User-facing factory (platform fee settable, currently 0) |

## Fee Structure

### NFT Mint
- **Platform fee**: none on mint (settable, currently 0)
- **Creator price**: User-defined (can be 0, often free)
- Mint price goes to bonding pool

### Pre-Bonding Sell (NFT)
- **50% penalty** (anti-rug measure)
- Returned ETH = (pool_balance / supply) × 50%

### Post-Bonding NFT Trading
- **1.5% buy fee** + **1.5% sell fee**
  - 1.0% → creator
  - 0.2% → platform treasury
  - 0.1% → airdrop vault (daily random-recipient airdrop)
  - 0.2% → kas (maintenance)

### Token Trading
- **1.5% buy + sell**
  - Same split as NFT trading above

## Rarity

| Tier | Supply Cap | Target % |
|---|---|---|
| Common | 70 | 40–70% |
| Uncommon | 30 | 15–30% |
| Rare | 15 | 5–15% |
| Epic | 5 | 1–5% |
| Legendary | 1 | ~1% |
| Mythic | 3 | Fixed 3 items |

Mythic slots = first 3 mints. Rarity for the rest is pseudo-random weighted.

## Mint Scheduling

- **Open immediately**: `openMintNow(ttlSeconds)`
- **Scheduled (UTC)**: `scheduleMint(unixTimestamp, ttlSeconds)`
- TTL range: 10 minutes → 14 days (0 = no expiry)

## Vault Schedule

After 24h, `lockVault()` locks 50% of token supply:

| Day | Airdrop (% of total) | Burn (% of total) |
|---|---|---|
| 1 | 1% | 9% |
| 7 | 1% | 9% |
| 14 | 1% | 9% |
| 28 | 1% | 9% |
| 56 | 1% | 9% |
| **Total** | **5%** | **45%** |

## Deploy

```bash
cd contracts
npm install

# Copy env
cp .env.example .env
# Fill in PRIVATE_KEY (and optionally ROBINHOOD_RPC_URL)

# Deploy to Robinhood Chain
npm run deploy
```

## .env.example

```
PRIVATE_KEY=your_private_key
ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
BLOCKSCOUT_API_KEY=blockscout
```

## Next.js Integration

After deploy, add to `frontend/.env.local`:

```
NEXT_PUBLIC_LAUNCHPAD_ADDRESS=0x...
NEXT_PUBLIC_VAULT_ADDRESS=0x...
NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS=0x...
NEXT_PUBLIC_CHAIN_ID=4663
NEXT_PUBLIC_RPC_URL=https://rpc.mainnet.chain.robinhood.com
```

## Dependencies

- OpenZeppelin v5 (ERC-1155, ERC-20, Ownable, ReentrancyGuard)
- Uniswap V4 (PoolManager, hooks) for the token pool
- Hardhat + TypeScript

## Next Steps

1. Write tests (`test/HoodseaNFT.test.ts`, etc.)
2. Set up Privy.io frontend auth
3. Build Next.js frontend
4. Set up backend oracle for airdrop recipient selection
5. Integrate DEX (Uniswap V4 on Robinhood Chain) for token trading
6. Audit before mainnet
