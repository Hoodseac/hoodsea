// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fee-on-transfer token for tests: burns `feeBps` of every transfer so the
/// recipient receives less than the sent amount. Used to prove HoodseaAirdrop credits
/// the ACTUAL received amount and never over-credits a campaign.
contract MockFeeToken is ERC20 {
    uint256 public immutable feeBps; // e.g. 100 = 1%

    constructor(uint256 supply, uint256 _feeBps) ERC20("Fee", "FEE") {
        feeBps = _feeBps;
        _mint(msg.sender, supply);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10_000;
        if (fee > 0) super._update(from, address(0xdead), fee); // burn-to-dead
        super._update(from, to, value - fee);
    }
}
