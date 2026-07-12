// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";

/**
 * @dev Permissive test mock of the Uniswap V4 PoolManager. It implements only the
 *      surface the factory calls during single-sided seeding (initialize / unlock /
 *      modifyLiquidity) and returns a ZERO BalanceDelta from modifyLiquidity so the
 *      factory's settle path is skipped (no real AMM math needed). Enough to prove
 *      the existing V4 seed path is still invoked with the correct PoolKey.
 */
contract MockV4PoolManager {
    bool public initialized;
    address public lastHooks;
    uint24 public lastFee;
    int24 public lastTickSpacing;
    address public lastCurrency0;
    bool public modifyCalled;
    bool public unlockCalled;

    // When true, initialize reverts — used to prove a V4 failure never bricks the
    // V3 seed or bonding.
    bool public revertOnInit;

    function setRevertOnInit(bool v) external { revertOnInit = v; }

    function initialize(PoolKey calldata key, uint160) external returns (int24 tick) {
        require(!revertOnInit, "mock init revert");
        initialized = true;
        lastHooks = address(key.hooks);
        lastFee = key.fee;
        lastTickSpacing = key.tickSpacing;
        lastCurrency0 = Currency.unwrap(key.currency0);
        return 0;
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        unlockCalled = true;
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function modifyLiquidity(PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        returns (BalanceDelta, BalanceDelta)
    {
        modifyCalled = true;
        // Zero delta: nothing owed, so the factory's settle branch is skipped.
        return (BalanceDelta.wrap(0), BalanceDelta.wrap(0));
    }
}
