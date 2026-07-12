// Content for the Hoodsea marketing landing (security feed + docs).
// Add new feed entries at the TOP of NEWS_ITEMS, newest first.

export interface NewsItem {
  slug: string;
  date: string; // YYYY-MM-DD (publication date on this feed)
  tag: "RUG PULL" | "EXPLOIT" | "SNIPING" | "SCAM" | "DUMP";
  title: string;
  /** what happened out there */
  caseSummary: string;
  /** how Hoodsea's design prevents the same failure */
  prevention: string;
}

export const NEWS_ITEMS: NewsItem[] = [
  {
    slug: "lp-rug-pulls",
    date: "2026-06-12",
    tag: "RUG PULL",
    title: "The pulled pool",
    caseSummary:
      "From Squid Game Token in 2021 to countless memecoins since, the move never changes: the team holds the liquidity, waits for the buys to stack up, then yanks the pool and leaves holders with a token that will not sell.",
    prevention:
      "On Hoodsea the Uniswap V3 (1%) and V4 pools are opened by the contract the moment a collection mints out, and the liquidity is locked with no exit. The contract that owns it has no function to remove it, so no creator and no platform can ever pull the current. Read it on-chain.",
  },
  {
    slug: "team-token-dumps",
    date: "2026-06-12",
    tag: "DUMP",
    title: "The insider bag",
    caseSummary:
      "Plenty of launches quietly reserve 20 to 50% of supply for the team with no lockup. Evolved Apes in 2021 and others like it watched insiders unload everything within days and kill the chart on the way out.",
    prevention:
      "A Hoodsea token has a fixed split: 50% into the locked pool, 50% into the vault on a hard-coded schedule (days 1, 7, 14, 28, 56). Each epoch burns 9% of supply and routes 1% to 100 randomly drawn holders. There is no discretionary bag for anyone to dump.",
  },
  {
    slug: "rarity-sniping",
    date: "2026-06-12",
    tag: "SNIPING",
    title: "The rares, gone before you",
    caseSummary:
      "When rarity is set per mint, or the metadata is uploaded before reveal, bots read the chain or the IPFS folder and grab exactly the rare token IDs. Everyone else is left holding commons.",
    prevention:
      "Hoodsea sets no rarity while minting. The full 46/30/15/5/1/3 spread shuffles in a single transaction at sellout, seeded by block data that does not exist until that moment. There is nothing to snipe. Every mint has the same odds.",
  },
  {
    slug: "presale-bypass",
    date: "2026-06-12",
    tag: "EXPLOIT",
    title: "The gate that never held",
    caseSummary:
      "Sloppy presales get walked around: calling the contract directly, replaying a signature, or flooding the public phase with bot wallets that drain the supply in seconds.",
    prevention:
      "Phases on Hoodsea are enforced on-chain with a merkle proof per wallet (TEAM, GTD, FCFS, PUBLIC), time windows and per-wallet caps. A wallet that is not on the list cannot mint that phase, no matter how it calls the contract. We ran 50 wallets at every phase to be sure.",
  },
  {
    slug: "fake-marketplaces",
    date: "2026-06-12",
    tag: "SCAM",
    title: "The approval that emptied the wallet",
    caseSummary:
      "The classic NFT drain: a user signs a marketplace approval (setApprovalForAll) on a fake or compromised site, and the attacker walks every NFT out of the wallet.",
    prevention:
      "The Hoodsea marketplace lives inside the NFT contract itself. Listing, buying and offers all happen in the collection, with no external operator to approve, so the drain-by-approval has nothing to hook into.",
  },
  {
    slug: "mint-treasury-theft",
    date: "2026-06-12",
    tag: "RUG PULL",
    title: "The mint that walked mid-sale",
    caseSummary:
      "Frosties in 2022 and many smaller mints ended the same way: the deployer wallet drained the mint proceeds mid-sale and vanished. The quiet soft rug.",
    prevention:
      "Mint ETH on Hoodsea lands in the collection's bonding pool, not the creator's wallet. At sellout the contract seeds the locked liquidity itself. Pre-bonding exits carry a 50% penalty, so a half-finished mint can't be quietly walked.",
  },
];

// ─── Docs ─────────────────────────────────────────────────────────────────────

export interface DocSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export const DOC_SECTIONS: DocSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    paragraphs: [
      "Hoodsea is where a collection goes down as free-mint NFTs and comes up as a token, on Robinhood Chain. Every collection has a creator-chosen size, from 10 to 10,000 NFTs. The creator decides at launch whether a token is attached: with a token enabled, an ERC-20 deploys automatically with locked liquidity when the last NFT mints; with it disabled, the collection stays NFT-only and the pooled mint ETH stays claimable by the creator. No team allocation, no manual steps.",
      "You need a wallet with ETH on Robinhood Chain (the deployment runs on Robinhood Chain). Open the app, connect, and you can mint, trade or launch immediately. Creators and holders can also connect with X to verify their real handle, so nobody can impersonate a known account.",
    ],
  },
  {
    id: "launching",
    title: "Launching a collection",
    paragraphs: [
      "Launching takes four steps: identity (name, ticker, bio, socials), media (3-6 photos, one per rarity tier, the last photo is the Mythic), economics (your mint price, free or paid), and schedule.",
    ],
    bullets: [
      "Optional token: toggle a token on or off for the launch. On means an ERC-20 deploys with a Uniswap V4 pool at sellout; off means an NFT-only collection with no token and no pool.",
      "Swap fee: when a token is enabled, you pick its swap fee from 1.5% (base) up to 3.5%. It is enforced on-chain by a Uniswap V4 hook.",
      "Reveal timing: instant reveals rarities at sellout; 24h / 7d keeps every NFT hidden behind your own mystery photo until the timer ends (uploading the mystery photo is required).",
      "Phases: optionally enable TEAM, GTD and FCFS allowlists with their own time windows and per-wallet caps before the PUBLIC phase. Address lists are merkle-proofed on-chain.",
      "Verified identity: connect with X so your collection shows your real, verified handle.",
      "Launching costs only gas. Your collection appears in Explore immediately.",
    ],
  },
  {
    id: "minting",
    title: "Minting & phases",
    paragraphs: [
      "A collection mints through up to four phases: TEAM → GTD → FCFS → PUBLIC. Your eligibility and remaining allowance are shown on the mint page; proofs are generated automatically in your browser.",
      "All mint ETH accumulates in the collection's bonding pool. Selling back to the pool before bonding completes carries a 50% penalty, so strong hands are rewarded.",
    ],
  },
  {
    id: "rarity",
    title: "Rarity & reveal",
    paragraphs: [
      "Each collection has a fixed rarity split: 46% Common, 30% Uncommon, 15% Rare, 5% Epic, 1% Legendary, 3% Mythic.",
      "No token has a rarity until the collection sells out. At the final mint (sellout) the contract shuffles the whole distribution with a seed that cannot be predicted in advance, so sniping rares is impossible. If the creator chose delayed reveal, photos stay hidden for 24 hours or 7 days after sellout.",
    ],
  },
  {
    id: "bonding",
    title: "Bonding & the token",
    paragraphs: [
      "If the creator enabled a token, the final mint (sellout) triggers bonding: an ERC-20 token (1B supply) deploys, Uniswap V3 (1% fee tier) and V4 pools are created with the pool's share of the supply, and the liquidity is locked forever (the owning contract has no removal path). If the creator launched without a token, no pool is created and the pooled mint ETH stays claimable by the creator.",
      "Every swap carries the creator-set fee of 1.5% to 3.5%, charged by the Uniswap V4 hook and paid out in ETH, then split between the collection creator, the platform, maintenance and the airdrop vault (see Fees for the exact proportions). The token itself has no transfer tax, so it always sells.",
    ],
  },
  {
    id: "vault",
    title: "Vault & epochs",
    paragraphs: [
      "The other 50% of supply locks in the vault on a fixed schedule: on days 1, 7, 14, 28 and 56 after lock, each epoch burns 9% of total supply and routes 1% into the airdrop claim pool. The 9% burn is permanent. The 1% is never burned.",
      "The schedule is hard-coded. Nobody can skip a burn or redirect the airdrop pool.",
      "The first epoch fires roughly two days after sellout: about 24 hours for lockVault to become callable after the token deploys, then the day-1 epoch matures about 24 hours after lock. The remaining epochs follow on days 7, 14, 28 and 56 from lock.",
    ],
  },
  {
    id: "airdrops",
    title: "Airdrop and claiming",
    paragraphs: [
      "Each epoch adds 1% of supply to that token's claim pool. The pool is shared out to 100 random participants per epoch, selected off-chain by the oracle. A participant is any wallet that traded the token that day, across both venues: the NFT marketplace and the token pool (the Uniswap V4 pool). The selection is random, not ranked.",
      "The airdrop is paid in the token itself, not ETH. The pool is split among the 100 selected wallets for that epoch.",
      "Allocations are cumulative and never expire. Once the pool is shared out to you it stays yours to claim whenever you want. There is no deadline and nothing is clawed back or burned. Anything not yet allocated rolls over to the next day's draw, so the full 1% always reaches traders eventually.",
      "The oracle runs the draw daily at 23:30 UTC and publishes a new allocation. Trades in the final 30 minutes before the snapshot count toward the next day instead.",
    ],
    bullets: [
      "Open the Airdrops page and connect your wallet. Eligible tokens show up under Your claimable airdrops with a Claim button, plus a Claim all button for everything at once.",
      "Only wallets with a net ETH loss of at least 0.001 ETH qualify. Breaking even or profiting means you are not in the list that day.",
      "Eligibility is per token. You can be eligible for one token and not another.",
      "Nothing expires. If you skip a day you can still claim the full amount later.",
    ],
  },
  {
    id: "marketplace",
    title: "Marketplace & trading",
    paragraphs: [
      "Browse every collection from the Explore feed: a swipeable featured row up top, then a searchable list. Switch between the NFTs and Tokens tabs, filter by Live, Bonded or Upcoming, and sort by Newest, Cheapest (floor first), Top or Active. Each collection shows who created it, with their verified handle when they have connected one.",
      "Open a collection to reach its market. NFTs are shown cheapest-first by default, so the floor is always at the top, and that order holds even when you filter by a specific rarity. Once a collection is more than a day old the rarity breakdown panel tucks away to keep the market view clean.",
      "After bonding, the built-in marketplace is fully on-chain inside the collection contract itself. There are no approvals to any external marketplace, and buying, listing and offering all settle in a single transaction.",
    ],
    bullets: [
      "Buy: any listed NFT shows its price and a Buy button. Listings are sorted floor-first so the cheapest is easy to find.",
      "List: owners set a price and an expiry (from 30 minutes up to 6 months). The expiry is enforced on-chain, so once it passes the NFT can no longer be bought at that listing, and you can relist anytime.",
      "Collection offer: make one collection-wide offer from the market toolbar (it is not a bid on a single NFT). Your ETH is held in escrow and any holder in that collection can accept it for one of their NFTs. You can cancel anytime to get your ETH back. One active offer per wallet per collection.",
      "Fees: every sale carries a flat 1.5%, paid out instantly in the same transaction (1% creator, 0.2% platform, 0.2% maintenance, 0.1% airdrop vault). The seller receives the price minus 1.5%.",
      "Coming soon: sweep buying, to select several listed NFTs and buy them all in one transaction.",
    ],
  },
  {
    id: "fees",
    title: "Fees",
    paragraphs: [
      "Every fee is fixed in the contract and flows back to the people who use Hoodsea. There are four recipients across the whole platform: the creator, the platform, maintenance (running costs), and the airdrop vault that rewards the community. No hidden cuts, no oracle-priced surprises.",
      "Fees are charged in two ways. Mint and marketplace fees are split and paid out instantly in the same transaction, so there is nothing to claim. Token swap fees collect in the token's own on-chain fee splitter and are released by a permissionless distribute() call (the CLAIM button on the token page), so anyone can trigger the payout. Every rate below is enforced on-chain.",
    ],
    bullets: [
      "Mint: pay only the creator's mint price (often free). No platform fee added on mint.",
      "Sell back before bonding: redeeming an NFT to the pool before sellout returns half of its pool share; the other 50% goes to the platform.",
      "NFT marketplace trade: 1.5% of the sale price, split and sent instantly in the same transaction (1% creator, 0.2% platform, 0.2% maintenance, 0.1% airdrop vault). The seller receives the price minus 1.5%. Nothing to claim.",
      "Token swap (Uniswap V4): a creator-set fee of 1.5% to 3.5% in ETH on every buy and sell. It collects in the token's own fee splitter and is released by a permissionless distribute() call (the CLAIM button on the token page) into 66.7% creator, 13.3% platform, 13.3% maintenance, 6.7% airdrop vault.",
      "Airdrop vault: the 0.1% slice from every trade funds the community airdrops, on top of the token's epoch schedule.",
    ],
  },
];
