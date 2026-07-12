// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IVaultNotify {
    function notifyDeployment(address token, address creator) external;
}

/// @dev Test-only token that mimics HoodseaToken.lockVault: send 50% to the vault and register.
contract MockLockToken is ERC20 {
    constructor(uint256 supply) ERC20("Lock", "LCK") {
        _mint(address(this), supply);
    }

    function lock(address vault, address creator) external {
        _transfer(address(this), vault, balanceOf(address(this)) / 2);
        IVaultNotify(vault).notifyDeployment(address(this), creator);
    }
}
