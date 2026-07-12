// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/**
 * @dev Test mock of the HoodseaFeeHook. Only registerPool is exercised by the
 *      factory's V4 seed path; it records the last registration for assertions.
 */
contract MockFeeHook {
    bool public registered;
    address public lastRecipient;
    uint256 public lastFeeBps;
    uint256 public lastDecaySeconds;

    function registerPool(PoolKey calldata, address recipient, uint256 feeBps, uint256 decaySeconds) external {
        registered = true;
        lastRecipient = recipient;
        lastFeeBps = feeBps;
        lastDecaySeconds = decaySeconds;
    }
}
