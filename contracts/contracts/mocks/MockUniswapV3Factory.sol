// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IUniswapV3FactoryMin} from "../UniV3Interfaces.sol";
import {MockUniswapV3Pool} from "./MockUniswapV3Pool.sol";

/**
 * @dev Test mock of the Uniswap v3 factory. createPool deploys a fresh MockPool.
 *      `revertOnCreate` simulates a front-run: the real factory reverts when the
 *      pool already exists, so setting it proves the factory's V3 seed is skipped
 *      cleanly (and the supply folds into V4) instead of minting into a bogus pool.
 */
contract MockUniswapV3Factory is IUniswapV3FactoryMin {
    bool public revertOnCreate;
    address public lastPool;

    function setRevertOnCreate(bool v) external { revertOnCreate = v; }

    function createPool(address, address, uint24) external override returns (address pool) {
        require(!revertOnCreate, "pool exists"); // mirrors real createPool reverting on pre-existence
        pool = address(new MockUniswapV3Pool());
        lastPool = pool;
    }

    function getPool(address, address, uint24) external view override returns (address) {
        return lastPool;
    }
}
