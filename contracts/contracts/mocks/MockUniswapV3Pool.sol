// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IUniswapV3PoolMin} from "../UniV3Interfaces.sol";

/// @dev Minimal test pool: records the initialize price and exposes it via slot0.
contract MockUniswapV3Pool is IUniswapV3PoolMin {
    uint160 public sqrtPrice;
    int24 public curTick;
    bool public initialized;

    function initialize(uint160 sqrtPriceX96) external override {
        require(!initialized, "already initialized");
        sqrtPrice = sqrtPriceX96;
        initialized = true;
    }

    function slot0()
        external
        view
        override
        returns (uint160, int24, uint16, uint16, uint16, uint8, bool)
    {
        return (sqrtPrice, curTick, 0, 0, 0, 0, false);
    }
}
