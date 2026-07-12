// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CurrencySettler} from "@uniswap/v4-core/test/utils/CurrencySettler.sol";

/// @notice Minimal exact-input swap router for testing the V4 fee hook.
contract SwapHelper is IUnlockCallback {
    using CurrencySettler for Currency;

    IPoolManager public immutable pm;

    struct CB {
        PoolKey key;
        bool zeroForOne;
        int256 amountSpecified;
        address payer;
    }

    constructor(address _pm) {
        pm = IPoolManager(_pm);
    }

    receive() external payable {}

    /// @param amountIn exact input amount (positive)
    function swapExactIn(PoolKey calldata key, bool zeroForOne, uint256 amountIn) external payable returns (BalanceDelta) {
        bytes memory res = pm.unlock(abi.encode(CB(key, zeroForOne, -int256(amountIn), msg.sender)));
        return abi.decode(res, (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "not pm");
        CB memory c = abi.decode(data, (CB));

        BalanceDelta delta = pm.swap(
            c.key,
            SwapParams({
                zeroForOne: c.zeroForOne,
                amountSpecified: c.amountSpecified,
                sqrtPriceLimitX96: c.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );

        int128 a0 = delta.amount0();
        int128 a1 = delta.amount1();
        // pay inputs (negative), receive outputs (positive)
        if (a0 < 0) c.key.currency0.settle(pm, c.payer, uint256(uint128(-a0)), false);
        if (a1 < 0) c.key.currency1.settle(pm, c.payer, uint256(uint128(-a1)), false);
        if (a0 > 0) c.key.currency0.take(pm, c.payer, uint256(uint128(a0)), false);
        if (a1 > 0) c.key.currency1.take(pm, c.payer, uint256(uint128(a1)), false);

        return abi.encode(delta);
    }
}
