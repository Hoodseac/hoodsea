// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./HoodseaV3Locker.sol";

/**
 * @title HoodseaV3LockerDeployer
 * @notice Tiny helper that deploys a per-token HoodseaV3Locker. It exists purely so
 *         the locker's CREATION bytecode lives here instead of inside
 *         HoodseaTokenFactory, keeping the factory under the 24KB EIP-170 limit.
 * @dev `deploy` forwards its own caller (msg.sender) as the locker's authorized
 *      factory, so only the HoodseaTokenFactory that called it can lock the position.
 *      Anyone may call deploy, but a locker whose factory is not the real factory is
 *      simply an orphan the factory never references — it changes no protocol state.
 */
contract HoodseaV3LockerDeployer {
    event LockerDeployed(address indexed factory, address indexed creator, address locker);

    function deploy(address npm, address creator, address platform, uint256 creatorSplitBps)
        external
        returns (address locker)
    {
        locker = address(new HoodseaV3Locker(npm, msg.sender, creator, platform, creatorSplitBps));
        emit LockerDeployed(msg.sender, creator, locker);
    }
}
