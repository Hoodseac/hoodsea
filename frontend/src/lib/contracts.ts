import { keccak256, encodeAbiParameters } from "viem";
import { robinhoodChain } from "./chain";

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || robinhoodChain.id);
// Robinhood Chain is mainnet-only for this app; kept for components that
// conditionally render testnet-only UI (always false here).
export const IS_TESTNET = false;
export const ACTIVE_CHAIN = robinhoodChain;

// ─── Contract Addresses ───────────────────────────────────────────────────────
export const CONTRACTS = {
  launchpad: (process.env.NEXT_PUBLIC_LAUNCHPAD_ADDRESS || "0x0") as `0x${string}`,
  vault: (process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0x0") as `0x${string}`,
  airdropDistributor: (process.env.NEXT_PUBLIC_AIRDROP_DISTRIBUTOR || "0x0") as `0x${string}`,
  originAirdrop: (process.env.NEXT_PUBLIC_AIRDROP_ADDRESS || "0x0") as `0x${string}`,
  tokenFactory: (process.env.NEXT_PUBLIC_TOKEN_FACTORY_ADDRESS || "0x0") as `0x${string}`,
  feeHook: (process.env.NEXT_PUBLIC_FEE_HOOK_ADDRESS || "0x0") as `0x${string}`,
  poolManager: (process.env.NEXT_PUBLIC_POOL_MANAGER || "0x8366a39cc670b4001a1121b8f6a443a643e40951") as `0x${string}`,
  swapRouter: (process.env.NEXT_PUBLIC_SWAP_ROUTER || "0x0") as `0x${string}`,
  // Uniswap V4 StateView on Robinhood Chain.
  stateView: (process.env.NEXT_PUBLIC_V4_STATE_VIEW || "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b") as `0x${string}`,
};

// AirdropDistributor: cumulative merkle claim pool (the 1% per epoch, claimable forever)
export const AIRDROP_DISTRIBUTOR_ABI = [
  { name: "claim", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "token", type: "address" }, { name: "cumulativeAmount", type: "uint256" }, { name: "proof", type: "bytes32[]" },
  ], outputs: [] },
  { name: "claimMany", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "tokens", type: "address[]" }, { name: "cumulativeAmounts", type: "uint256[]" }, { name: "proofs", type: "bytes32[][]" },
  ], outputs: [] },
  { name: "claimed", type: "function", stateMutability: "view", inputs: [
    { name: "", type: "address" }, { name: "", type: "address" },
  ], outputs: [{ type: "uint256" }] },
  { name: "merkleRoot", type: "function", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ type: "bytes32" }] },
] as const;

// OriginAirdrop: permissionless multi-campaign airdrops (merkle list + FCFS). Deployed Robinhood Chain.
export const ORIGIN_AIRDROP_ABI = [
  { name: "createMerkleCampaign", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "token", type: "address" }, { name: "merkleRoot", type: "bytes32" }, { name: "totalAmount", type: "uint256" }, { name: "expiry", type: "uint64" },
  ], outputs: [{ name: "id", type: "uint256" }] },
  { name: "createFcfsCampaign", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "token", type: "address" }, { name: "amountPerWallet", type: "uint256" }, { name: "totalAmount", type: "uint256" },
    { name: "gateToken", type: "address" }, { name: "gateMin", type: "uint256" }, { name: "expiry", type: "uint64" },
  ], outputs: [{ name: "id", type: "uint256" }] },
  { name: "claimMerkle", type: "function", stateMutability: "nonpayable", inputs: [
    { name: "id", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "proof", type: "bytes32[]" },
  ], outputs: [] },
  { name: "claimFcfs", type: "function", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { name: "sweep", type: "function", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }], outputs: [] },
  { name: "campaignsCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "campaigns", type: "function", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [
    { name: "creator", type: "address" }, { name: "token", type: "address" }, { name: "mode", type: "uint8" },
    { name: "merkleRoot", type: "bytes32" }, { name: "amountPerWallet", type: "uint256" }, { name: "gateToken", type: "address" },
    { name: "gateMin", type: "uint256" }, { name: "deposited", type: "uint256" }, { name: "remaining", type: "uint256" },
    { name: "claimedCount", type: "uint256" }, { name: "expiry", type: "uint64" }, { name: "swept", type: "bool" },
  ] },
  { name: "claimed", type: "function", stateMutability: "view", inputs: [
    { name: "", type: "uint256" }, { name: "", type: "address" },
  ], outputs: [{ type: "bool" }] },
  { name: "fcfsEligible", type: "function", stateMutability: "view", inputs: [
    { name: "id", type: "uint256" }, { name: "account", type: "address" },
  ], outputs: [{ name: "eligible", type: "bool" }, { name: "amount", type: "uint256" }] },
  { name: "merkleEligible", type: "function", stateMutability: "view", inputs: [
    { name: "id", type: "uint256" }, { name: "account", type: "address" }, { name: "amount", type: "uint256" }, { name: "proof", type: "bytes32[]" },
  ], outputs: [{ name: "eligible", type: "bool" }] },
  { name: "CampaignCreated", type: "event", inputs: [
    { name: "id", type: "uint256", indexed: true }, { name: "creator", type: "address", indexed: true }, { name: "token", type: "address", indexed: true },
    { name: "mode", type: "uint8", indexed: false }, { name: "deposited", type: "uint256", indexed: false }, { name: "expiry", type: "uint64", indexed: false },
  ] },
  { name: "Claimed", type: "event", inputs: [
    { name: "id", type: "uint256", indexed: true }, { name: "account", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false },
  ] },
  { name: "Swept", type: "event", inputs: [
    { name: "id", type: "uint256", indexed: true }, { name: "creator", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false },
  ] },
] as const;

// Uniswap V4 pool fee tier + tick spacing used by the factory (LP fee = 0)
export const V4_LP_FEE = 0;
export const V4_TICK_SPACING = 60;

// PoolKey for a token's native-ETH / TOKEN pool
export function poolKeyFor(token: `0x${string}`) {
  return {
    currency0: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    currency1: token,
    fee: V4_LP_FEE,
    tickSpacing: V4_TICK_SPACING,
    hooks: CONTRACTS.feeHook,
  };
}

// PoolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))
export function poolIdFor(token: `0x${string}`): `0x${string}` {
  const k = poolKeyFor(token);
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]
    )
  );
}

// Read a pool's swap fee in bps (150-350) from the hook
export const FEE_HOOK_ABI = [
  { name: "poolFeeBps", type: "function", stateMutability: "view", inputs: [{ name: "", type: "bytes32" }], outputs: [{ type: "uint256" }] },
  // The OriginFeeSplitter that collects this pool's ETH fees
  { name: "feeRecipient", type: "function", stateMutability: "view", inputs: [{ name: "", type: "bytes32" }], outputs: [{ type: "address" }] },
] as const;

// OriginFeeSplitter: holds the accumulated swap fees; distribute() is
// permissionless and splits to creator/platform/kas/airdrop.
export const SPLITTER_ABI = [
  { name: "distribute", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;

export const SWAP_ROUTER_ABI = [
  {
    name: "swapExactIn",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "key", type: "tuple", components: [
        { name: "currency0", type: "address" },
        { name: "currency1", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "tickSpacing", type: "int24" },
        { name: "hooks", type: "address" },
      ]},
      { name: "zeroForOne", type: "bool" },
      { name: "amountIn", type: "uint256" },
      { name: "minOut", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

export const STATE_VIEW_ABI = [
  {
    name: "getSlot0",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
] as const;

export const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

// ─── ABIs (key functions only) ───────────────────────────────────────────────

export const LAUNCHPAD_ABI = [
  {
    name: "launchCollection",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "ticker", type: "string" },
          { name: "bio", type: "string" },
          { name: "photoURIs", type: "string[6]" },
          { name: "photoCount", type: "uint8" },
          { name: "socialX", type: "string" },
          { name: "socialGithub", type: "string" },
          { name: "socialFarcaster", type: "string" },
          { name: "mintPriceWei", type: "uint256" },
          { name: "tokenEnabled", type: "bool" },
          { name: "tokenFeeBps", type: "uint256" },
          { name: "decaySeconds", type: "uint256" },
          { name: "feeReceiveType", type: "uint8" },
          { name: "startMcPairWei", type: "uint256" },
          { name: "pairIsUSDC", type: "bool" },
          { name: "phaseRoots", type: "bytes32[4]" },
          { name: "phaseStarts", type: "uint256[4]" },
          { name: "phaseEnds", type: "uint256[4]" },
          { name: "phaseMaxPerWallet", type: "uint256[4]" },
          { name: "allowlistCID", type: "string" },
        ],
      },
    ],
    outputs: [{ name: "collection", type: "address" }],
  },
  {
    name: "getPlatformFeeETH",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getAllCollections",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
  {
    name: "getCreatorCollections",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "creator", type: "address" }],
    outputs: [{ type: "address[]" }],
  },
  {
    name: "CollectionLaunched",
    type: "event",
    inputs: [
      { name: "collection", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "ticker", type: "string", indexed: false },
      { name: "mintPrice", type: "uint256", indexed: false },
      { name: "mintStart", type: "uint256", indexed: false },
    ],
  },
] as const;

export const NFT_ABI = [
  {
    name: "mint",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "quantity", type: "uint256" },
      { name: "proof", type: "bytes32[]" },
    ],
    outputs: [],
  },
  {
    name: "currentPhaseId",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    name: "hasActivePhase",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    name: "isEligible",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_phaseId", type: "uint8" },
      { name: "_wallet", type: "address" },
      { name: "_proof", type: "bytes32[]" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "remainingForWallet",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_phaseId", type: "uint8" },
      { name: "_wallet", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getRarity",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_tokenId", type: "uint256" }],
    outputs: [{ type: "uint8" }],
  },
  {
    name: "isRevealed",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    name: "phasesConfigured",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    name: "phases",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "merkleRoot", type: "bytes32" },
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "maxPerWallet", type: "uint256" },
    ],
  },
  {
    name: "allowlistCID",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    name: "sellPreBonding",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_tokenId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "poolBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "totalMinted",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "listNFT",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_tokenId", type: "uint256" },
      { name: "_price", type: "uint256" },
      { name: "_expiry", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "cancelListing",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_tokenId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "buyNFT",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "_tokenId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "makeCollectionOffer",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    name: "cancelCollectionOffer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "acceptCollectionOffer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_tokenId", type: "uint256" },
      { name: "_offerer", type: "address" },
    ],
    outputs: [],
  },
  {
    name: "collectionOffer",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getMintStatus",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "isOpen", type: "bool" },
      { name: "isScheduled", type: "bool" },
      { name: "startTime", type: "uint256" },
      { name: "endTime", type: "uint256" },
      { name: "minted", type: "uint256" },
      { name: "remaining", type: "uint256" },
      { name: "bonded", type: "bool" },
    ],
  },
  {
    name: "getCollectionInfo",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "name", type: "string" },
          { name: "ticker", type: "string" },
          { name: "bio", type: "string" },
          { name: "socialX", type: "string" },
          { name: "socialGithub", type: "string" },
          { name: "socialFarcaster", type: "string" },
          { name: "photoURIs", type: "string[6]" },
          { name: "photoCount", type: "uint8" },
          { name: "creator", type: "address" },
          { name: "mintPrice", type: "uint256" },
          { name: "platformFeeETH", type: "uint256" },
          { name: "bondingComplete", type: "bool" },
          { name: "tokenAddress", type: "address" },
          { name: "tokenEnabled", type: "bool" },
          { name: "tokenFeeBps", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "triggerMintOpen",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "NFTMinted",
    type: "event",
    inputs: [
      { name: "minter", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: false },
      { name: "rarity", type: "uint8", indexed: false },
      { name: "price", type: "uint256", indexed: false },
    ],
  },
  {
    name: "BondingComplete",
    type: "event",
    inputs: [{ name: "tokenAddress", type: "address", indexed: false }],
  },
  {
    name: "NFTListed",
    type: "event",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "price", type: "uint256", indexed: false },
      { name: "expiry", type: "uint256", indexed: false },
      { name: "seller", type: "address", indexed: false },
    ],
  },
  {
    name: "NFTListingCancelled",
    type: "event",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: false },
    ],
  },
  {
    name: "CollectionOfferMade",
    type: "event",
    inputs: [
      { name: "offerer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    name: "NFTSold",
    type: "event",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "price", type: "uint256", indexed: false },
      { name: "from", type: "address", indexed: false },
      { name: "to", type: "address", indexed: false },
    ],
  },
  {
    name: "uri",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_tokenId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
  {
    name: "tokenOwner",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "tokenListPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "tokenListExpiry",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "tokenLastSalePrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "withdrawEmergency",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "revealRarities",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "revealed",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  }
] as const;

export const TOKEN_ABI = [
  {
    name: "getTokenInfo",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "_name", type: "string" },
      { name: "_symbol", type: "string" },
      { name: "_image", type: "string" },
      { name: "_bio", type: "string" },
      { name: "_creator", type: "address" },
      { name: "_nftCollection", type: "address" },
      { name: "_deployedAt", type: "uint256" },
      { name: "_vaultLocked", type: "bool" },
    ],
  },
  {
    name: "lockVault",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const VAULT_ABI = [
  {
    name: "getManagedTokens",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    name: "getVaultStatus",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "balance", type: "uint256" },
      { name: "executed", type: "uint256[5]" },
      { name: "epochTimes", type: "uint256[5]" },
      { name: "ready", type: "bool[5]" },
    ],
  },
  {
    name: "executeEpoch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "epochIndex", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

// ─── Rarity Config ────────────────────────────────────────────────────────────

export const RARITY = {
  0: { name: "Common", color: "#6b7280", class: "rarity-common" },
  1: { name: "Uncommon", color: "#22c55e", class: "rarity-uncommon" },
  2: { name: "Rare", color: "#3b82f6", class: "rarity-rare" },
  3: { name: "Epic", color: "#a855f7", class: "rarity-epic" },
  4: { name: "Legendary", color: "#f59e0b", class: "rarity-legendary" },
  5: { name: "Mythic", color: "#ec4899", class: "rarity-mythic" },
} as const;

export type RarityKey = keyof typeof RARITY;
