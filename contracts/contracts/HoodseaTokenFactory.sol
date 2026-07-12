// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./HoodseaToken.sol";
import "./HoodseaFeeSplitter.sol";
import "./UniV3Interfaces.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {CurrencySettler} from "./lib/CurrencySettler.sol";

interface IHoodseaFeeHook {
    function registerPool(PoolKey calldata key, address recipient, uint256 feeBps, uint256 decaySeconds) external;
}

// Deploys per-token lockers off-factory (keeps the locker creation code out of the
// factory bytecode for EIP-170). Returns a locker whose authorized factory == the
// caller (this factory).
interface IHoodseaV3LockerDeployer {
    function deploy(address npm, address creator, address platform, uint256 creatorSplitBps)
        external
        returns (address locker);
}

// The only locker function the factory calls after minting the position to it.
interface IHoodseaV3Locker {
    function lock(uint256 tokenId) external;
}

// Used to fetch a collection's anti-sniper decay setting at bonding time. The
// collection (HoodseaNFT) exposes its launchpad, and the launchpad stores the
// per-collection decay window chosen at launch.
interface IHoodseaNFTForDecay {
    function launchpad() external view returns (address);
}

interface IHoodseaLaunchpadForDecay {
    function collectionDecay(address collection) external view returns (uint256);
    function collectionFeeType(address collection) external view returns (uint8);
    function collectionStartMc(address collection) external view returns (uint256);
    function collectionPairUSDC(address collection) external view returns (bool);
}

/**
 * @title HoodseaTokenFactory
 * @notice Deploys the per-collection token, its fee splitter, and a Uniswap V4
 *         native-ETH / TOKEN pool with the HoodseaFeeHook attached. Liquidity is
 *         seeded and left in this contract with no removal path, so it is locked
 *         forever. The pool's own LP fee is 0; the 1.5% trade fee is charged by
 *         the hook and paid out as ETH to the splitter.
 */
contract HoodseaTokenFactory is Ownable, IUnlockCallback {
    using CurrencySettler for Currency;

    address public platformTreasury;
    address public airdropVault;
    address public kasWallet;

    IPoolManager public immutable poolManager;
    address public immutable feeHook;
    // USDC for the optional USDC-paired pool (set per network at deploy; 0 = ETH-only).
    address public immutable usdc;

    // ─── Uniswap V3 dual-seed (ported from Primehod's V3 launch) ─────────────────
    // In ADDITION to the V4 pool (with the HoodseaFeeHook), each token is also seeded
    // into a plain Uniswap V3 pool (the canonical 1% fee tier, no hooks) so generic
    // bots, snipers and screeners (DexScreener etc.) that skip V4 pools carrying an
    // unknown custom hook can still index and trade the token everywhere. Wired at
    // deploy (canonical Robinhood Chain deployment); all-zero => V3-off (V4-only).
    IUniswapV3FactoryMin public immutable v3Factory;
    INonfungiblePositionManagerMin public immutable v3Npm;
    // Off-factory deployer for the per-token lockers (keeps their creation code out of
    // this contract's bytecode). Part of the V3 wiring; 0 => V3 seeding off.
    IHoodseaV3LockerDeployer public immutable v3LockerDeployer;
    // WETH9 on the target chain. V3 has no native-ETH pool, so the V3 pool is always
    // TOKEN/WETH (the most universally-indexed pair) regardless of the V4 quote choice.
    address public immutable weth;
    uint24 public constant V3_FEE = 10000;       // 1% tier (fixed by the pool on Robinhood Chain)
    int24 public constant V3_TICK_SPACING = 200; // tick spacing of the 1% tier (verified on-chain)
    // Creator's cut of each collected V3 swap fee, out of 10000 (default 55%, the rest
    // to the platform). Baked into each per-token locker at seed time; owner-settable.
    uint256 public creatorSplitBps = 5500;
    // token => its HoodseaV3Locker (holds the position NFT + routes the 1% fees).
    mapping(address => address) public tokenToV3Locker;
    // Portion of the token liquidity half (TOTAL_SUPPLY/2) routed to the V3 pool,
    // in bps; the remainder seeds the V4 pool. Owner-settable so the split can be
    // tuned without a redeploy. Default 5000 = 50/50 (25% of full supply to each
    // pool). 0 = V4-only (original behaviour); 10000 = V3-only.
    uint256 public v3SeedBps = 5000;
    // HoodseaSwapRouter, used by each token's splitter to buy back the token for
    // creators who chose TOKEN/BOTH fee delivery. Set once after deploy (the router
    // is deployed after the factory). 0 = buyback off (splitters fall back to ETH).
    address public router;

    uint24 public constant LP_FEE = 0; // no LP fee; all trade fee via hook
    int24 public constant TICK_SPACING = 60;

    mapping(address => address) public collectionToToken;
    mapping(address => address) public tokenToCollection;
    mapping(address => address) public tokenToSplitter;
    address[] public allTokens;

    event TokenDeployed(address indexed collection, address indexed token, address creator, string name, string symbol);
    event PoolCreated(address indexed token, address splitter, uint256 ethAmount, uint256 tokenAmount);
    event V3PoolSeeded(address indexed token, address pool, address locker, uint256 tokenId, uint256 tokenAmount, bool tokenIsToken0);
    event V3SeedSkipped(address indexed token, uint256 reason); // 1=disabled 2=usdc-pair
    event V4PoolSeeded(address indexed token, uint256 tokenAmount);
    event V3SeedBpsSet(uint256 bps);
    event CreatorSplitBpsSet(uint256 bps);

    constructor(
        address _platformTreasury,
        address _airdropVault,
        address _kasWallet,
        address _poolManager,
        address _feeHook,
        address _usdc,
        address _v3Factory,
        address _v3Npm,
        address _weth,
        address _v3LockerDeployer
    ) Ownable(msg.sender) {
        platformTreasury = _platformTreasury;
        airdropVault = _airdropVault;
        kasWallet = _kasWallet;
        poolManager = IPoolManager(_poolManager);
        feeHook = _feeHook;
        usdc = _usdc;
        // V3 seeding is optional: if any of v3Factory/v3Npm/weth/lockerDeployer is zero
        // the factory behaves exactly as before (V4-only). Read only when all are set.
        v3Factory = IUniswapV3FactoryMin(_v3Factory);
        v3Npm = INonfungiblePositionManagerMin(_v3Npm);
        weth = _weth;
        v3LockerDeployer = IHoodseaV3LockerDeployer(_v3LockerDeployer);
    }

    receive() external payable {}

    function deployToken(
        address collection,
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata imageURI,
        string calldata bio,
        string calldata socialX,
        string calldata socialGithub,
        string calldata socialFarcaster,
        uint256 feeBps
    ) external payable returns (address tokenAddress) {
        // Only the collection itself can deploy its own token. Without this an
        // attacker could pre-register any collection's token and permanently
        // brick that collection's bonding completion.
        require(msg.sender == collection, "Caller not collection");
        require(collectionToToken[collection] == address(0), "Token already deployed");

        // Factory receives TOTAL_SUPPLY/2 (liquidity half) from the constructor.
        // The vault half is locked inside the token to the canonical airdropVault.
        HoodseaToken token = new HoodseaToken(
            name, symbol, creator, collection, airdropVault,
            imageURI, bio, socialX, socialGithub, socialFarcaster
        );
        tokenAddress = address(token);

        // Read this collection's launch config from its launchpad. Defensive: any
        // failure leaves decay off (0) and fee type ETH (0) so bonding never bricks.
        ( , uint8 feeType, , ) = _collectionConfig(collection);

        HoodseaFeeSplitter splitter = new HoodseaFeeSplitter(
            creator, platformTreasury, kasWallet, airdropVault,
            tokenAddress, router, feeHook, feeType
        );

        collectionToToken[collection] = tokenAddress;
        tokenToCollection[tokenAddress] = collection;
        tokenToSplitter[tokenAddress] = address(splitter);
        allTokens.push(tokenAddress);

        emit TokenDeployed(collection, tokenAddress, creator, name, symbol);

        // Pools are seeded single-sided (token-only) at the collection's starting
        // market cap. Seeding is BEST-EFFORT (self-call try/catch) so a pool failure
        // never bricks bonding — the token still deploys. Any ETH forwarded is returned
        // to the collection so it becomes the creator's mint revenue.
        //
        // V3 FIRST: also seed a plain, hook-less Uniswap V3 pool (TOKEN/WETH) so the
        // token is universally indexable/tradeable by bots and screeners that skip V4
        // hook pools. It returns the token amount actually placed in V3 (0 if skipped
        // for USDC-pair / disabled / front-run pre-init, or if it reverts). The V4
        // seed then consumes the REMAINDER of the liquidity half, so no token is ever
        // stranded: a griefed/skipped V3 simply routes the FULL half into V4.
        uint256 v3Used;
        try this.seedV3External(collection, tokenAddress, creator) returns (uint256 used) {
            v3Used = used;
        } catch {
            v3Used = 0;
        }
        try this.seedPoolExternal(collection, tokenAddress, address(splitter), feeBps, v3Used) {} catch {}
        if (msg.value > 0) {
            (bool ok, ) = payable(msg.sender).call{value: msg.value}("");
            require(ok, "refund failed");
        }
        emit PoolCreated(tokenAddress, address(splitter), 0, token.TOTAL_SUPPLY() / 2);
    }

    /// @dev Best-effort single-sided V4 pool seeding, called by `this` so failures
    ///      can be caught without bricking bonding. Self-call only. `v3Used` is the
    ///      token amount already placed in V3 (0 if V3 was skipped/failed); V4 seeds
    ///      the rest of the liquidity half, so nothing is left stranded in the factory.
    function seedPoolExternal(address collection, address tokenAddr, address splitter, uint256 feeBps, uint256 v3Used) external {
        require(msg.sender == address(this), "self only");
        _createPool(collection, tokenAddr, splitter, feeBps, v3Used);
    }

    function _createPool(address collection, address tokenAddr, address splitter, uint256 feeBps, uint256 v3Used) internal {
        (uint256 decaySeconds, , uint256 startMc, bool pairUSDC) = _collectionConfig(collection);
        uint256 fdvSupply = HoodseaToken(tokenAddr).TOTAL_SUPPLY();         // FDV uses full supply
        // The token liquidity half is shared with the V3 pool: V4 seeds whatever V3
        // did NOT consume. FDV (starting price) is unchanged, so the V4 pool still
        // initialises at exactly the same price — only its depth changes. If V3 was
        // skipped/failed (v3Used == 0) V4 keeps the FULL half (no stranded supply).
        uint256 tokenAmount = (fdvSupply / 2) - v3Used;                     // pooled liquidity (V4 share)

        // Quote currency: USDC if requested AND configured, else native ETH.
        address quote = (pairUSDC && usdc != address(0)) ? usdc : address(0);
        // Sensible default starting MC if the creator left it unset (quote raw units).
        if (startMc == 0) startMc = (quote == address(0)) ? 3 ether : uint256(10_000) * 1e6;

        // Sort currencies (currency0 < currency1). Native ETH (0x0) is always currency0.
        bool tokenIsCurrency0;
        Currency c0;
        Currency c1;
        if (quote == address(0)) {
            c0 = Currency.wrap(address(0));
            c1 = Currency.wrap(tokenAddr);
            tokenIsCurrency0 = false;
        } else if (tokenAddr < quote) {
            c0 = Currency.wrap(tokenAddr);
            c1 = Currency.wrap(quote);
            tokenIsCurrency0 = true;
        } else {
            c0 = Currency.wrap(quote);
            c1 = Currency.wrap(tokenAddr);
            tokenIsCurrency0 = false;
        }

        PoolKey memory key = PoolKey({
            currency0: c0, currency1: c1, fee: LP_FEE, tickSpacing: TICK_SPACING, hooks: IHooks(feeHook)
        });

        // Starting price = startMc(quote raw) over full supply (token raw). sqrtPrice
        // encodes sqrt(amount1/amount0). token is currency1 -> price=token/quote=fdv/mc;
        // token is currency0 -> price=quote/token=mc/fdv.
        uint160 sp = tokenIsCurrency0
            ? _calcSqrtPriceX96(fdvSupply, startMc)
            : _calcSqrtPriceX96(startMc, fdvSupply);
        // Snap the starting price to the tick grid and seed the single-sided
        // position with its edge EXACTLY at this tick — no gap between the start
        // price and the liquidity, so the very first swap trades immediately.
        int24 boundary = _floorTick(TickMath.getTickAtSqrtPrice(sp));
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(boundary);

        poolManager.initialize(key, sqrtPriceX96);
        IHoodseaFeeHook(feeHook).registerPool(key, splitter, feeBps, decaySeconds);

        poolManager.unlock(abi.encode(key, boundary, tokenAmount, tokenIsCurrency0));
        emit V4PoolSeeded(tokenAddr, tokenAmount);
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "not pool manager");
        (PoolKey memory key, int24 boundary, uint256 tokenAmount, bool tokenIsCurrency0) =
            abi.decode(data, (PoolKey, int24, uint256, bool));

        int24 minTick = (TickMath.MIN_TICK / TICK_SPACING) * TICK_SPACING;
        int24 maxTick = (TickMath.MAX_TICK / TICK_SPACING) * TICK_SPACING;
        // Pool's current price sits exactly at `boundary` (set in _createPool).
        uint160 curSqrt = TickMath.getSqrtPriceAtTick(boundary);

        // Concentrate the token in a bounded band next to the start price instead
        // of the full tick range. A full-range single-sided position spreads the
        // tokens so thin that early buys barely move price and can round to zero;
        // a band (~e^6.9 ≈ 1000x price span) keeps liquidity dense so small buys
        // trade immediately. The band starts exactly at the current price so there
        // is no dead gap.
        int24 BAND = 69000; // tick-spacings span; ~1000x price range
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0;
        uint256 amount1;
        if (tokenIsCurrency0) {
            // token = currency0: band ABOVE current. Buyers push price UP -> token out.
            tickLower = boundary;
            tickUpper = boundary + BAND;
            if (tickUpper > maxTick) tickUpper = maxTick;
            amount0 = tokenAmount;
        } else {
            // token = currency1: band BELOW current. Buyers push price DOWN -> token out.
            tickUpper = boundary;
            tickLower = boundary - BAND;
            if (tickLower < minTick) tickLower = minTick;
            amount1 = tokenAmount;
        }

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            curSqrt,
            TickMath.getSqrtPriceAtTick(tickLower),
            TickMath.getSqrtPriceAtTick(tickUpper),
            amount0,
            amount1
        );

        (BalanceDelta delta, ) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            ""
        );

        // Only the token side should be owed (single-sided). Settle any negative deltas.
        if (delta.amount0() < 0) {
            key.currency0.settle(poolManager, address(this), uint256(uint128(-delta.amount0())), false);
        }
        if (delta.amount1() < 0) {
            key.currency1.settle(poolManager, address(this), uint256(uint128(-delta.amount1())), false);
        }
        // Position stays owned by this factory with no removal path => locked forever
        return "";
    }

    // ─── Uniswap V3 single-sided seed (plain 1% pool, universally indexable) ─────
    // Ported from Primehod's createTokenV3: create the canonical 1% pool, initialise
    // it at the start price, mint the whole V3 allotment as a single-sided token-only
    // position covering the range above the start price, and lock the position NFT in
    // a per-token HoodseaV3Locker (no principal-withdraw path; only the 1% fees flow,
    // split creator/platform by creatorSplitBps).

    /// @dev Token amount routed to the V3 pool = v3SeedBps of the liquidity half.
    ///      Zero when V3 seeding is disabled (v3 wiring unset or v3SeedBps == 0).
    function _v3Amount(uint256 fdvSupply) internal view returns (uint256) {
        if (
            address(v3Factory) == address(0) || address(v3Npm) == address(0) ||
            weth == address(0) || address(v3LockerDeployer) == address(0) || v3SeedBps == 0
        ) {
            return 0;
        }
        return ((fdvSupply / 2) * v3SeedBps) / 10000;
    }

    /// @dev Best-effort V3 seeding, called by `this` so a failure can be caught
    ///      without bricking bonding or the V4 seed. Self-call only. Returns the
    ///      token amount routed to V3 (0 if skipped) so the caller seeds V4 with the
    ///      remainder — nothing is left stranded in the factory.
    function seedV3External(address collection, address tokenAddr, address creator) external returns (uint256) {
        require(msg.sender == address(this), "self only");
        return _seedV3(collection, tokenAddr, creator);
    }

    function _seedV3(address collection, address tokenAddr, address creator) internal returns (uint256) {
        uint256 fdvSupply = HoodseaToken(tokenAddr).TOTAL_SUPPLY();
        uint256 marketSupply = _v3Amount(fdvSupply);
        if (marketSupply == 0) { emit V3SeedSkipped(tokenAddr, 1); return 0; }

        // FIX (LOW): the V3 pool always prices in WETH (18dp) using startMc as wei.
        // A USDC-paired collection sets startMc in 6dp USDC units, which would
        // mis-scale the WETH price, so skip V3 entirely for USDC pairs (production is
        // ETH-only, usdc==0, so this never triggers there). Skipped supply folds into
        // V4 via the returned 0.
        ( , , uint256 startMc, bool pairUSDC) = _collectionConfig(collection);
        if (pairUSDC && usdc != address(0)) { emit V3SeedSkipped(tokenAddr, 2); return 0; }
        if (startMc == 0) startMc = 3 ether;

        // Per-token locker with immutable creator/platform + fee split, deployed via
        // the off-factory deployer (its `factory` is set to THIS factory, so only we
        // can lock). Keeps the locker creation code out of this contract (EIP-170).
        address locker = v3LockerDeployer.deploy(address(v3Npm), creator, platformTreasury, creatorSplitBps);

        // priceTick = the WETH-per-token tick for the target FDV (mc/fdv). poolTick is
        // the pool price token1/token0: equals priceTick when token is token0, else
        // its inverse (mirrors Primehod's orientation handling).
        bool tokenIs0 = tokenAddr < weth;
        int24 priceTick = TickMath.getTickAtSqrtPrice(_calcSqrtPriceX96(fdvSupply, startMc));
        int24 poolTick = tokenIs0 ? priceTick : -priceTick;

        // FIX (MEDIUM): createPool REVERTS if the pool already exists, so a front-run
        // pre-initialization at a bogus price makes this whole self-call revert and V3
        // is skipped cleanly (supply folds into V4) — we never mint into someone
        // else's pool. A freshly created pool is initialised at our price right here.
        address pool = v3Factory.createPool(tokenAddr, weth, V3_FEE);
        IUniswapV3PoolMin(pool).initialize(TickMath.getSqrtPriceAtTick(poolTick));

        // Single-sided token-only liquidity covering the whole range above the start
        // price: buys move price into the range, like a curve, but visible to bots.
        int24 tickLower;
        int24 tickUpper;
        if (tokenIs0) {
            tickLower = _alignUp(poolTick + 1); // token0-only requires currentTick < tickLower
            tickUpper = TickMath.MAX_TICK - (TickMath.MAX_TICK % V3_TICK_SPACING);
        } else {
            tickUpper = _alignDown(poolTick); // token1-only requires currentTick >= tickUpper
            tickLower = -(TickMath.MAX_TICK - (TickMath.MAX_TICK % V3_TICK_SPACING));
        }

        require(HoodseaToken(tokenAddr).approve(address(v3Npm), marketSupply), "approve failed");
        (uint256 positionId, , uint256 used0, uint256 used1) = v3Npm.mint(
            INonfungiblePositionManagerMin.MintParams({
                token0: tokenIs0 ? tokenAddr : weth,
                token1: tokenIs0 ? weth : tokenAddr,
                fee: V3_FEE,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: tokenIs0 ? marketSupply : 0,
                amount1Desired: tokenIs0 ? 0 : marketSupply,
                amount0Min: 0,
                amount1Min: 0,
                recipient: locker,
                deadline: block.timestamp
            })
        );
        IHoodseaV3Locker(locker).lock(positionId);
        uint256 usedTok = tokenIs0 ? used0 : used1;
        require(usedTok > 0, "no liquidity minted");
        // Rounding dust the position couldn't take joins the locked fee stream, so the
        // FULL marketSupply leaves the factory (nothing stranded) and V4 gets the rest.
        uint256 leftover = marketSupply - usedTok;
        if (leftover > 0) require(HoodseaToken(tokenAddr).transfer(locker, leftover), "dust transfer failed");

        tokenToV3Locker[tokenAddr] = locker;
        emit V3PoolSeeded(tokenAddr, pool, locker, positionId, marketSupply, tokenIs0);
        return marketSupply;
    }

    function _alignUp(int24 tick) private pure returns (int24) {
        int24 aligned = (tick / V3_TICK_SPACING) * V3_TICK_SPACING;
        if (aligned < tick) aligned += V3_TICK_SPACING;
        return aligned;
    }

    function _alignDown(int24 tick) private pure returns (int24) {
        int24 aligned = (tick / V3_TICK_SPACING) * V3_TICK_SPACING;
        if (aligned > tick) aligned -= V3_TICK_SPACING;
        return aligned;
    }

    // Align a tick down to the spacing grid (toward negative infinity).
    function _floorTick(int24 t) internal pure returns (int24 r) {
        r = (t / TICK_SPACING) * TICK_SPACING;
        if (t < 0 && r != t) r -= TICK_SPACING;
    }

    // ─── sqrt price helper ──────────────────────────────────────────────────────
    function _calcSqrtPriceX96(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        // sqrtPriceX96 = sqrt(amount1/amount0) * 2^96
        uint256 sqrtA0 = _sqrt(amount0);
        uint256 sqrtA1 = _sqrt(amount1);
        return uint160((sqrtA1 * (2 ** 96)) / sqrtA0);
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x >> 1) + 1;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) >> 1;
        }
    }

    // ─── Admin / views ──────────────────────────────────────────────────────────
    function updateAddresses(address _treasury, address _vault, address _kas) external onlyOwner {
        platformTreasury = _treasury;
        airdropVault = _vault;
        kasWallet = _kas;
    }

    /// @notice Set the HoodseaSwapRouter used for creator fee buybacks (TOKEN/BOTH).
    function setRouter(address _router) external onlyOwner {
        router = _router;
    }

    /// @notice Set the portion (bps) of the token liquidity half routed to the V3
    ///         pool; the remainder seeds the V4 pool. 0 = V4-only, 10000 = V3-only.
    ///         Applies to tokens bonded AFTER the change.
    function setV3SeedBps(uint256 _bps) external onlyOwner {
        require(_bps <= 10000, "bps > 10000");
        v3SeedBps = _bps;
        emit V3SeedBpsSet(_bps);
    }

    /// @notice Set the creator's cut of each collected V3 swap fee (bps of 10000; the
    ///         rest goes to the platform). Baked into each per-token locker at seed
    ///         time, so it applies to tokens bonded AFTER the change. Default 5500.
    function setCreatorSplitBps(uint256 _bps) external onlyOwner {
        require(_bps <= 10000, "bps > 10000");
        creatorSplitBps = _bps;
        emit CreatorSplitBpsSet(_bps);
    }

    /// @dev Read a collection's launch config (decay window, fee receive type) from
    ///      its launchpad. Fully defensive: any failure returns safe defaults
    ///      (decay 0 = off, feeType 0 = ETH) so bonding can never be bricked.
    function _collectionConfig(address collection)
        internal view returns (uint256 dec, uint8 feeType, uint256 startMc, bool pairUSDC)
    {
        try IHoodseaNFTForDecay(collection).launchpad() returns (address lp) {
            if (lp != address(0)) {
                try IHoodseaLaunchpadForDecay(lp).collectionDecay(collection) returns (uint256 d) { dec = d; } catch {}
                try IHoodseaLaunchpadForDecay(lp).collectionFeeType(collection) returns (uint8 f) { feeType = f; } catch {}
                try IHoodseaLaunchpadForDecay(lp).collectionStartMc(collection) returns (uint256 m) { startMc = m; } catch {}
                try IHoodseaLaunchpadForDecay(lp).collectionPairUSDC(collection) returns (bool u) { pairUSDC = u; } catch {}
            }
        } catch {}
    }

    function getAllTokens() external view returns (address[] memory) { return allTokens; }
    function getTokenCount() external view returns (uint256) { return allTokens.length; }
}
