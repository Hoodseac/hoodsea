// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {CurrencySettler} from "./lib/CurrencySettler.sol";

/**
 * @title HoodseaSwapRouter
 * @notice Minimal exact-input swap router for the app's in-app Buy/Sell box.
 *         Buy  = send ETH (zeroForOne true), receive token.
 *         Sell = approve + send token (zeroForOne false), receive ETH.
 *         The 1.5% fee is charged by the pool's HoodseaFeeHook, so the output is
 *         already net of fee; minOut protects against slippage.
 */
contract HoodseaSwapRouter is IUnlockCallback {
    using CurrencySettler for Currency;

    IPoolManager public immutable pm;

    struct CB {
        PoolKey key;
        bool zeroForOne;
        int256 amountSpecified;
        address payer;
        address recipient;
    }

    error Slippage(uint256 out, uint256 minOut);

    constructor(address _pm) {
        pm = IPoolManager(_pm);
    }

    receive() external payable {}

    /// @notice Swap an exact input amount. For buys, send ETH as msg.value.
    /// @param amountIn exact input (ETH for buy, token for sell)
    /// @param minOut minimum output the recipient must receive (slippage guard)
    function swapExactIn(
        PoolKey calldata key,
        bool zeroForOne,
        uint256 amountIn,
        uint256 minOut,
        address recipient
    ) external payable returns (uint256 amountOut) {
        bytes memory res = pm.unlock(
            abi.encode(CB(key, zeroForOne, -int256(amountIn), msg.sender, recipient))
        );
        amountOut = abi.decode(res, (uint256));
        if (amountOut < minOut) revert Slippage(amountOut, minOut);

        // Refund any leftover ETH (e.g. dust) to the buyer
        if (address(this).balance > 0) {
            (bool ok, ) = msg.sender.call{value: address(this).balance}("");
            require(ok, "refund failed");
        }
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
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

        // Pay the input (negative side)
        if (a0 < 0) c.key.currency0.settle(pm, c.payer, uint256(uint128(-a0)), false);
        if (a1 < 0) c.key.currency1.settle(pm, c.payer, uint256(uint128(-a1)), false);

        // Receive the output (positive side) to the recipient
        uint256 amountOut;
        if (a0 > 0) {
            amountOut = uint256(uint128(a0));
            c.key.currency0.take(pm, c.recipient, amountOut, false);
        }
        if (a1 > 0) {
            amountOut = uint256(uint128(a1));
            c.key.currency1.take(pm, c.recipient, amountOut, false);
        }

        return abi.encode(amountOut);
    }
}
