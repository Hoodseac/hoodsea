// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IAirdropReentry {
    function claimFcfs(uint256 id) external;
}

/// @notice Malicious token that re-enters HoodseaAirdrop during the payout transfer.
/// Proves nonReentrant blocks a second drain: without the guard, the re-entrant call
/// (msg.sender == this token, a fresh un-claimed account) would pull another payout.
contract MockReentrantToken is ERC20 {
    address public airdrop;
    uint256 public targetId;
    bool public armed;
    bool public reentryBlocked;
    uint256 public reentryAttempts;

    constructor(uint256 supply) ERC20("Reenter", "RE") {
        _mint(msg.sender, supply);
    }

    function arm(address _airdrop, uint256 _id) external {
        airdrop = _airdrop;
        targetId = _id;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        // Fire once, only when the airdrop is paying someone out.
        if (armed && from == airdrop && airdrop != address(0)) {
            armed = false;
            reentryAttempts++;
            try IAirdropReentry(airdrop).claimFcfs(targetId) {
                // reached payout -> reentrancy SUCCEEDED (would be a vulnerability)
            } catch {
                reentryBlocked = true; // guard correctly rejected the re-entry
            }
        }
        super._update(from, to, value);
    }
}
