// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IFactoryDeploy {
    function deployToken(
        address collection,
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata imageURI,
        string calldata bio,
        string calldata socialX,
        string calldata socialGithub,
        string calldata socialFarcaster,
        uint256 feeBps
    ) external payable returns (address);
}

/**
 * @dev Stands in for a bonded HoodseaNFT: it calls factory.deployToken with itself
 *      as the collection, satisfying the factory's `msg.sender == collection` guard,
 *      so the real HoodseaTokenFactory dual-seed path can be unit-tested directly.
 */
contract MockBondingCollection {
    address public lastToken;

    function bond(
        address factory,
        address creator,
        string calldata name,
        string calldata symbol,
        uint256 feeBps
    ) external returns (address token) {
        token = IFactoryDeploy(factory).deployToken(
            address(this), creator, name, symbol, "ipfs://img", "bio", "", "", "", feeBps
        );
        lastToken = token;
    }
}
