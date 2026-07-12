# Hoodsea

A launchpad on **Robinhood Chain** (chain id 4663). Free-mint NFT collections that bond into tradeable ERC-20 tokens, with liquidity locked for good and community airdrops.

- Website: https://hoodsea.com
- X: https://x.com/hoodsea_
- GitHub: https://github.com/Hoodseac/hoodsea

## How it works

1. **Launch** a collection — 10 to 10,000 NFTs, creator-set price and phases.
2. **Mint** through Team / GTD / FCFS / Public phases, enforced on-chain with merkle allowlists.
3. **Bond** at sellout — rarities reveal from an unpredictable seed, an ERC-20 token deploys, and its liquidity seeds a single-sided **Uniswap V3 (1%)** plus **V4** pool, locked permanently.
4. **Trade** on the pools; the vault runs a burn schedule and airdrops to 100 random participants each epoch.

NFTs are ERC-1155 with a `contractURI` and EIP-2981 royalties, so collections list on OpenSea (which supports Robinhood Chain). Royalties split creator / platform / kas / airdrop, the same as trading fees.

## Structure

- `contracts/` — Solidity 0.8.26 (Hardhat), Uniswap V3 + V4, OpenZeppelin
- `frontend/` — Next.js 14, wagmi + viem
- `backend/` — oracle + epoch bots
- `profileapi/` — RPC proxy, indexer, Irys metadata uploads

## Deployed contracts (Robinhood Chain, verified on Blockscout)

| Contract | Address |
|---|---|
| Launchpad | `0xa1e9DAB10a4DED224c090c73B09b6658Cc69331b` |
| Token Factory | `0x6c0d5D2324a12CA5150f99d0afCCF018a4551322` |
| NFT Deployer | `0xA3B4850FA72863d2c3FbB31aD7ebcFa329288389` |
| Fee Hook | `0x16a8435E0236Ab716FeCA9BCf732929a17C9C0cC` |
| Vault | `0x715311f008A1546Ad32E3Eb84942855c8a709e4e` |
| Airdrop Distributor | `0x47Bb7C36FFF1170C8BcC238E3089282377552feF` |
| Swap Router | `0x2736840beB3295dAB14BaCD78f71FC934108eB4B` |

## Development

Each package has its own `.env.example` — copy it to `.env` and fill in your own values. Secrets (keys, `.env`, `.iryskey`, etc.) are never committed.

```bash
cd frontend && npm install && npm run dev
```
