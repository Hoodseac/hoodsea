// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Minimal local mirror of Uniswap V4 PoolKey (Currency/IHooks are address-wide,
// so this ABI-encodes identically to the router's PoolKey parameter).
struct SplitPoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

interface IHoodseaSwapRouter {
    function swapExactIn(
        SplitPoolKey calldata key,
        bool zeroForOne,
        uint256 amountIn,
        uint256 minOut,
        address recipient
    ) external payable returns (uint256);
}

/**
 * @title HoodseaFeeSplitter
 * @notice One per token. Receives the swap fee in native ETH from the
 *         HoodseaFeeHook and splits it among creator, platform, kas and airdrop
 *         (of every 150 bps: creator 100, platform 20, kas 20, airdrop 10).
 *         distribute() is permissionless.
 *
 *         The creator chooses how THEIR share is delivered (feeReceiveType):
 *           0 = ETH only   (native ETH, default)
 *           1 = TOKEN only (buy back the token with the ETH, send token)
 *           2 = BOTH       (half ETH, half bought-back token)
 *         Platform/kas/airdrop are always paid in ETH (the airdrop share must
 *         stay ETH for the vault / stream-2). Token buyback routes through the
 *         HoodseaSwapRouter; if it ever fails the creator is paid in ETH instead,
 *         so distribute() can never brick.
 */
contract HoodseaFeeSplitter is ReentrancyGuard {
    address public immutable creator;
    address public immutable platform;
    address public immutable kas;
    address public immutable airdrop;

    // Buyback config (set once by the factory at token deploy).
    address public immutable token;     // this collection's token (currency1)
    address public immutable router;    // HoodseaSwapRouter (0 = buyback disabled)
    address public immutable feeHook;   // hook in the pool key
    uint8 public immutable feeReceiveType; // 0=ETH, 1=TOKEN, 2=BOTH

    int24 internal constant TICK_SPACING = 60; // matches the factory pool

    uint256 public constant CREATOR_BPS = 100; // 1.0%
    uint256 public constant PLATFORM_BPS = 20; // 0.2%
    uint256 public constant KAS_BPS = 20; // 0.2%
    uint256 public constant AIRDROP_BPS = 10; // 0.1%
    uint256 public constant TOTAL_BPS = 150; // 1.5%

    event Distributed(uint256 toCreator, uint256 toPlatform, uint256 toKas, uint256 toAirdrop);

    constructor(
        address _creator,
        address _platform,
        address _kas,
        address _airdrop,
        address _token,
        address _router,
        address _feeHook,
        uint8 _feeReceiveType
    ) {
        require(_creator != address(0) && _platform != address(0) && _kas != address(0) && _airdrop != address(0), "zero addr");
        require(_feeReceiveType <= 2, "bad fee type");
        creator = _creator;
        platform = _platform;
        kas = _kas;
        airdrop = _airdrop;
        token = _token;
        router = _router;
        feeHook = _feeHook;
        feeReceiveType = _feeReceiveType;
    }

    receive() external payable {}

    /// @notice Split the accumulated ETH fees. Anyone can call.
    /// @dev nonReentrant + creator paid last so a contract-creator cannot reenter
    ///      to skew the split away from platform/kas/airdrop.
    function distribute() external nonReentrant {
        _distribute(0); // permissionless; creator buyback unprotected (try/catch -> ETH fallback)
    }

    /// @notice S2: a caller that can quote off-chain (the oracle) supplies a slippage
    ///         floor so the creator's token buyback can't be MEV-sandwiched.
    function distribute(uint256 minCreatorOut) external nonReentrant {
        _distribute(minCreatorOut);
    }

    function _distribute(uint256 minCreatorOut) private {
        uint256 bal = address(this).balance;
        require(bal > 0, "nothing to distribute");

        uint256 toCreator = (bal * CREATOR_BPS) / TOTAL_BPS;
        uint256 toPlatform = (bal * PLATFORM_BPS) / TOTAL_BPS;
        uint256 toAirdrop = (bal * AIRDROP_BPS) / TOTAL_BPS;
        uint256 toKas = bal - toCreator - toPlatform - toAirdrop;

        // platform/kas/airdrop always in ETH (airdrop must stay ETH for the vault)
        _send(platform, toPlatform);
        _send(airdrop, toAirdrop);
        _send(kas, toKas);

        // creator share delivered per their chosen type, paid last
        _payCreator(toCreator, minCreatorOut);

        emit Distributed(toCreator, toPlatform, toKas, toAirdrop);
    }

    function _payCreator(uint256 amount, uint256 minOut) private {
        if (amount == 0) return;
        if (feeReceiveType == 1) {            // TOKEN only
            _buybackToCreator(amount, minOut);
        } else if (feeReceiveType == 2) {     // BOTH: half ETH, half token
            uint256 half = amount / 2;
            _send(creator, amount - half);
            _buybackToCreator(half, minOut);
        } else {                              // ETH only (default)
            _send(creator, amount);
        }
    }

    /// @dev Buy the token with `ethIn` and send it to the creator. On any failure
    ///      (no router/token, pool not ready, slippage) fall back to paying ETH.
    function _buybackToCreator(uint256 ethIn, uint256 minOut) private {
        if (ethIn == 0) return;
        if (router == address(0) || token == address(0)) { _send(creator, ethIn); return; }
        SplitPoolKey memory key = SplitPoolKey({
            currency0: address(0), currency1: token, fee: 0, tickSpacing: TICK_SPACING, hooks: feeHook
        });
        try IHoodseaSwapRouter(router).swapExactIn{value: ethIn}(key, true, ethIn, minOut, creator) returns (uint256) {
            // token delivered to the creator by the router
        } catch {
            _send(creator, ethIn); // buyback failed: pay ETH instead
        }
    }

    function _send(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "send failed");
    }
}
