// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./HoodseaNFT.sol";

/**
 * @title HoodseaNFTDeployer
 * @notice Holds the HoodseaNFT creation bytecode so HoodseaLaunchpad stays under
 *         the EIP-170 24KB runtime size limit. The caller (launchpad) is
 *         recorded as the NFT's launchpad address.
 */
contract HoodseaNFTDeployer {
    // The launchpad allowed to deploy NFTs. Set once after the launchpad is
    // deployed, so nobody can create orphan collections that spoof this deployer
    // as their launchpad. (S5)
    address public launchpad;
    // Only the deployer EOA can wire the launchpad — closes the front-run window
    // where anyone could set launchpad first and brick/spoof the deployer (F-8).
    address public immutable owner;

    constructor() {
        owner = msg.sender;
    }

    function setLaunchpad(address _launchpad) external {
        require(msg.sender == owner, "not owner");
        require(launchpad == address(0), "launchpad already set");
        require(_launchpad != address(0), "zero launchpad");
        launchpad = _launchpad;
    }

    function deployNFT(
        address _creator,
        string calldata _name,
        string calldata _ticker,
        string calldata _bio,
        string[6] calldata _photoURIs,
        uint8 _photoCount,
        string calldata _socialX,
        string calldata _socialGithub,
        string calldata _socialFarcaster,
        uint256 _mintPriceWei,
        uint256 _platformFeeWei,
        bool _tokenEnabled,
        uint256 _tokenFeeBps,
        address _platformTreasury,
        address _airdropVault,
        address _kasWallet,
        address _tokenFactory,
        uint256 _maxSupply,
        address _royaltyReceiver
    ) external returns (address) {
        require(msg.sender == launchpad, "only launchpad"); // S5: no orphan collections
        HoodseaNFT nft = new HoodseaNFT(
            _creator,
            _name,
            _ticker,
            _bio,
            _photoURIs,
            _photoCount,
            _socialX,
            _socialGithub,
            _socialFarcaster,
            _mintPriceWei,
            _platformFeeWei,
            _tokenEnabled,
            _tokenFeeBps,
            _platformTreasury,
            _airdropVault,
            _kasWallet,
            _tokenFactory,
            msg.sender,
            _maxSupply,
            _royaltyReceiver
        );
        return address(nft);
    }
}
