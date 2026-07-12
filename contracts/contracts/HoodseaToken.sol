// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IHoodseaVault {
    function notifyDeployment(address token, address creator) external;
}

/**
 * @title HoodseaToken
 * @notice Clean ERC-20 deployed per NFT collection after bonding. No transfer
 *         tax: the 1.5% trade fee is charged by the Uniswap V4 HoodseaFeeHook on
 *         the pool, so both buys and sells work normally.
 * @dev Supply 1B. Half is minted to the factory to seed the locked V4 pool, the
 *      other half stays in this contract until lockVault moves it to the vault
 *      (5% airdrop schedule + 45% burn over 5 epochs).
 */
contract HoodseaToken is ERC20 {
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 * 1e18; // 1B tokens
    uint256 public constant VAULT_PERCENT = 50; // 50% locked to vault after 24h

    address public creator;
    address public nftCollection;
    // Canonical vault is fixed at deploy by the factory. lockVault can only ever
    // move the vault half here, never to a caller-chosen address.
    address public immutable canonicalVault;
    address public vaultContract;

    string public imageURI;
    string public bio;
    string public socialX;
    string public socialGithub;
    string public socialFarcaster;

    uint256 public deployedAt;
    bool public vaultLocked;

    event VaultLocked(uint256 vaultAmount);

    constructor(
        string memory _name,
        string memory _symbol,
        address _creator,
        address _nftCollection,
        address _vault,
        string memory _imageURI,
        string memory _bio,
        string memory _socialX,
        string memory _socialGithub,
        string memory _socialFarcaster
    ) ERC20(_name, _symbol) {
        require(_vault != address(0), "Invalid vault");
        creator = _creator;
        nftCollection = _nftCollection;
        canonicalVault = _vault;
        imageURI = _imageURI;
        bio = _bio;
        socialX = _socialX;
        socialGithub = _socialGithub;
        socialFarcaster = _socialFarcaster;
        deployedAt = block.timestamp;

        // Liquidity half goes to the deployer (factory) to seed the pool now.
        // Vault half stays here until lockVault. No function can move the vault
        // half except lockVault, so it cannot be drained.
        _mint(msg.sender, TOTAL_SUPPLY / 2);
        _mint(address(this), TOTAL_SUPPLY - TOTAL_SUPPLY / 2);
    }

    /// @notice Lock 50% of supply into the canonical vault after 24 hours.
    /// @dev Permissionless trigger, but the destination is the immutable vault
    ///      set at deploy, so no caller can redirect the supply to themselves.
    function lockVault() external {
        require(!vaultLocked, "Already locked");
        require(block.timestamp >= deployedAt + 24 hours, "Too early (wait 24h)");

        vaultContract = canonicalVault;
        vaultLocked = true;

        uint256 vaultAmount = balanceOf(address(this));
        _transfer(address(this), canonicalVault, vaultAmount);
        IHoodseaVault(canonicalVault).notifyDeployment(address(this), creator);

        emit VaultLocked(vaultAmount);
    }

    function getTokenInfo() external view returns (
        string memory _name,
        string memory _symbol,
        string memory _image,
        string memory _bio,
        address _creator,
        address _nftCollection,
        uint256 _deployedAt,
        bool _vaultLocked
    ) {
        return (name(), symbol(), imageURI, bio, creator, nftCollection, deployedAt, vaultLocked);
    }
}
