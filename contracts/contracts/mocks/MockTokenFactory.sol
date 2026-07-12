// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "../HoodseaToken.sol";

/**
 * @dev Test mock: deploys HoodseaToken without Uniswap pool setup.
 */
contract MockTokenFactory {
    address public platformTreasury;
    address public airdropVault;
    address public kasWallet;

    mapping(address => address) public collectionToToken;
    address[] public allTokens;

    event TokenDeployed(address indexed collection, address indexed token);

    constructor(address _treasury, address _vault, address _kas) {
        platformTreasury = _treasury;
        airdropVault = _vault;
        kasWallet = _kas;
    }

    function deployToken(
        address collection,
        address creator,
        string calldata name,
        string calldata symbol,
        string calldata imageURI,
        string calldata bio,
        string calldata socialX,
        string calldata socialGithub,
        string calldata socialFarcaster
    ) external payable returns (address tokenAddress) {
        require(collectionToToken[collection] == address(0), "Already deployed");

        HoodseaToken token = new HoodseaToken(
            name, symbol,
            creator,
            collection,
            airdropVault,
            imageURI, bio, socialX, socialGithub, socialFarcaster
        );

        tokenAddress = address(token);
        collectionToToken[collection] = tokenAddress;
        allTokens.push(tokenAddress);

        if (msg.value > 0) {
            (bool ok,) = creator.call{value: msg.value}("");
            require(ok);
        }

        emit TokenDeployed(collection, tokenAddress);
    }
}
