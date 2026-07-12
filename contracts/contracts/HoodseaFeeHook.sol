// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseHook} from "@uniswap/v4-periphery/src/utils/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/**
 * @title HoodseaFeeHook
 * @notice Shared Uniswap V4 hook that charges a 1.5% fee on every swap and pays
 *         it out in native ETH. Pools are native-ETH / TOKEN (currency0 = ETH).
 *         - Buy  (ETH -> TOKEN): fee taken from the input ETH in beforeSwap.
 *         - Sell (TOKEN -> ETH): fee taken from the output ETH in afterSwap.
 *         The token has no transfer tax, so buys and sells both work on V4, and
 *         the fee always lands as ETH (no token-to-ETH conversion needed).
 * @dev Deployed once and shared. Its address must be CREATE2 mined so the low
 *      bits encode beforeSwap (0x80) + afterSwap (0x40) + beforeSwapReturnDelta
 *      (0x08) + afterSwapReturnDelta (0x04) = 0xCC. Only exact-input swaps are
 *      charged; the app always swaps exact-input.
 */
contract HoodseaFeeHook is BaseHook {
    using CurrencyLibrary for Currency;

    uint256 public constant MIN_FEE_BPS = 150; // 1.5% base
    uint256 public constant MAX_FEE_BPS = 350; // 3.5% cap

    // Anti-sniper fee decay (optional, per pool). When enabled, the swap fee starts
    // very high at pool launch and falls linearly back to the pool's NORMAL base
    // fee over the window, so bots that buy in the first seconds pay a punitive fee
    // while normal traders who wait pay the normal rate. The high early fees flow to
    // the splitter like any other fee (creator/platform/kas/airdrop) = sniper revenue.
    uint256 public constant DECAY_START_BPS = 8000;  // 80% at t=0
    uint256 public constant MAX_DECAY_SECONDS = 300; // safety cap (5 min)

    address public owner;
    address public factory;

    // poolId => recipient that collects this pool's ETH fees (a splitter)
    mapping(PoolId => address) public feeRecipient;
    // poolId => base swap fee in bps (150-350), set once at registration
    mapping(PoolId => uint256) public poolFeeBps;
    // poolId => decay window in seconds (0 = decay off, use base fee)
    mapping(PoolId => uint256) public decaySeconds;
    // poolId => block timestamp the pool went live (decay reference point)
    mapping(PoolId => uint256) public poolStart;

    event FactorySet(address factory);
    event PoolRegistered(PoolId indexed poolId, address recipient, uint256 feeBps, uint256 decaySeconds);
    event FeeTaken(PoolId indexed poolId, uint256 amount);

    constructor(IPoolManager _manager, address _owner) BaseHook(_manager) {
        owner = _owner;
    }

    function setFactory(address _factory) external {
        require(msg.sender == owner, "not owner");
        require(factory == address(0), "factory set");
        require(_factory != address(0), "zero factory");
        factory = _factory;
        emit FactorySet(_factory);
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: true,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @notice Called by the factory once per pool to set where its ETH fees go.
    /// @param _decaySeconds anti-sniper decay window (0 = off). When > 0 the fee
    ///        starts at DECAY_START_BPS and falls linearly to DECAY_END_BPS over
    ///        this many seconds from now, then stays at DECAY_END_BPS.
    function registerPool(PoolKey calldata key, address recipient, uint256 feeBps, uint256 _decaySeconds) external {
        require(msg.sender == factory, "not factory");
        require(recipient != address(0), "zero recipient");
        require(key.currency0.isAddressZero(), "currency0 not native");
        require(feeBps >= MIN_FEE_BPS && feeBps <= MAX_FEE_BPS, "fee out of range");
        require(_decaySeconds <= MAX_DECAY_SECONDS, "decay too long");
        PoolId id = key.toId();
        require(feeRecipient[id] == address(0), "registered");
        feeRecipient[id] = recipient;
        poolFeeBps[id] = feeBps;
        decaySeconds[id] = _decaySeconds;
        poolStart[id] = block.timestamp;
        emit PoolRegistered(id, recipient, feeBps, _decaySeconds);
    }

    /// @notice The fee in bps that applies to this pool right now. With decay off
    ///         it is the static base fee; with decay on it starts at 80% and falls
    ///         linearly back to the base fee over the window, then stays at base.
    function currentFeeBps(PoolId id) public view returns (uint256) {
        uint256 base = poolFeeBps[id];
        uint256 dur = decaySeconds[id];
        if (dur == 0) return base; // decay off: static base fee
        uint256 elapsed = block.timestamp - poolStart[id];
        if (elapsed >= dur) return base; // window over: back to normal fee
        uint256 range = DECAY_START_BPS - base; // 8000 - base
        return DECAY_START_BPS - (range * elapsed) / dur; // linear 80% -> base
    }

    /// @dev Buy = ETH (currency0) in. Take the ETH fee from the input.
    function _beforeSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        bytes calldata
    ) internal override returns (bytes4, BeforeSwapDelta, uint24) {
        // Exact-output swaps would let a caller take the output without the fee
        // being applied to the input the same way; reject them so the fee can
        // never be bypassed. The app only ever swaps exact-input.
        require(params.amountSpecified < 0, "exact-input only");
        // Only exact-input buys (ETH -> TOKEN). Sells are handled in afterSwap.
        if (!params.zeroForOne || params.amountSpecified >= 0) {
            return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }
        PoolId pid = key.toId();
        address recipient = feeRecipient[pid];
        if (recipient == address(0)) {
            return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        uint256 inputAmount = uint256(-params.amountSpecified);
        uint256 feeAmount = (inputAmount * currentFeeBps(pid)) / 10000;
        if (feeAmount == 0) {
            return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        // Take the fee in native ETH (currency0) from the swap input
        poolManager.take(key.currency0, recipient, feeAmount);
        emit FeeTaken(pid, feeAmount);

        // Positive specified delta: the swap proceeds on (input - fee)
        return (BaseHook.beforeSwap.selector, toBeforeSwapDelta(int128(int256(feeAmount)), 0), 0);
    }

    /// @dev Sell = ETH (currency0) out. Take the ETH fee from the output.
    function _afterSwap(
        address,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) internal override returns (bytes4, int128) {
        // Only exact-input sells (TOKEN -> ETH). Buys are handled in beforeSwap.
        if (params.zeroForOne || params.amountSpecified >= 0) {
            return (BaseHook.afterSwap.selector, int128(0));
        }
        PoolId pid = key.toId();
        address recipient = feeRecipient[pid];
        if (recipient == address(0)) return (BaseHook.afterSwap.selector, int128(0));

        // For an exact-input sell the unspecified currency is the ETH output (currency0)
        int128 ethOut = delta.amount0();
        if (ethOut <= 0) return (BaseHook.afterSwap.selector, int128(0));

        uint256 feeAmount = (uint256(uint128(ethOut)) * currentFeeBps(pid)) / 10000;
        if (feeAmount == 0) return (BaseHook.afterSwap.selector, int128(0));

        poolManager.take(key.currency0, recipient, feeAmount);
        emit FeeTaken(pid, feeAmount);

        // Positive: the swapper receives feeAmount less ETH
        return (BaseHook.afterSwap.selector, int128(int256(feeAmount)));
    }
}
