// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./HoodseaNFT.sol";
import "./HoodseaNFTDeployer.sol";
import "./HoodseaFeeSplitter.sol";

/**
 * @title HoodseaLaunchpad
 * @notice Entry point for creating NFT collections on Hoodsea
 * @dev Flat platform fee of 0.0003 ETH per mint (no oracle dependency)
 */
contract HoodseaLaunchpad is Ownable, ReentrancyGuard {

    // Flat platform fee per mint. Settable by the owner (0 = free mints) so the
    // fee can be tuned without a redeploy. Baked into each collection at launch.
    uint256 public platformFeeETH = 0;

    // ─── Addresses ───────────────────────────────────────────────────────────────
    address public platformTreasury;
    address public airdropVault;
    address public kasWallet;
    address public tokenFactory;
    HoodseaNFTDeployer public nftDeployer;

    // ─── Registry ────────────────────────────────────────────────────────────────
    address[] public allCollections;
    mapping(address => address[]) public creatorCollections;
    mapping(address => bool) public isCollection;
    // collection => anti-sniper fee decay window in seconds (0 = off)
    mapping(address => uint256) public collectionDecay;
    // collection => creator fee delivery type (0=ETH, 1=token, 2=both)
    mapping(address => uint8) public collectionFeeType;
    // collection => single-sided pool seed config (read by factory at bonding)
    mapping(address => uint256) public collectionStartMc;   // starting FDV in pair units
    mapping(address => bool) public collectionPairUSDC;      // pair vs USDC (else ETH)

    // ─── Events ──────────────────────────────────────────────────────────────────
    event CollectionLaunched(
        address indexed collection,
        address indexed creator,
        string name,
        string ticker,
        uint256 mintPrice,
        uint256 mintStart
    );

    constructor(
        address _platformTreasury,
        address _airdropVault,
        address _kasWallet,
        address _tokenFactory,
        address _nftDeployer
    ) Ownable(msg.sender) {
        platformTreasury = _platformTreasury;
        airdropVault = _airdropVault;
        kasWallet = _kasWallet;
        tokenFactory = _tokenFactory;
        nftDeployer = HoodseaNFTDeployer(_nftDeployer);
    }

    // ─── Platform Fee ───────────────────────────────────────────────────────────

    /**
     * @notice Flat platform fee per mint (settable; 0 = free).
     */
    function getPlatformFeeETH() public view returns (uint256) {
        return platformFeeETH;
    }

    /**
     * @notice Owner can change the per-mint platform fee at any time.
     * @dev Applies to collections launched AFTER this change (fee is baked in at launch).
     */
    function setPlatformFee(uint256 _feeWei) external onlyOwner {
        platformFeeETH = _feeWei;
    }

    // ─── Create Collection ────────────────────────────────────────────────────────

    struct LaunchParams {
        string name;
        string ticker;
        string bio;
        string[6] photoURIs;
        uint8 photoCount;
        string socialX;
        string socialGithub;
        string socialFarcaster;
        uint256 mintPriceWei;   // 0 = free (creator sets their price, can be 0)
        bool tokenEnabled;      // deploy a token at bonding, or NFT-only
        uint256 tokenFeeBps;    // token swap fee: 150 (1.5%) to 350 (3.5%)
        uint256 decaySeconds;   // anti-sniper fee decay window (0 = off; fee 80%->base over N sec)
        uint8 feeReceiveType;   // creator fee delivery: 0=ETH, 1=token (buyback), 2=both
        // Token pool is seeded SINGLE-SIDED (token-only) at this starting market
        // cap, in the chosen pair currency. ETH from mints is creator revenue.
        uint256 startMcPairWei; // target starting FDV in pair units (ETH wei or USDC 6dp); 0 = factory default
        bool pairIsUSDC;        // false = pair vs native ETH, true = pair vs USDC
        // Phase config (0=Team, 1=GTD, 2=FCFS, 3=Public)
        bytes32[4] phaseRoots;     // 0x0 = open/public (no allowlist)
        uint256[4] phaseStarts;    // UTC unix start per phase
        uint256[4] phaseEnds;      // UTC unix end per phase
        uint256[4] phaseMaxPerWallet; // 0 = unlimited
        string allowlistCID;       // IPFS CID of full address lists
        // Creator-chosen collection supply (number of NFTs). Bounded to
        // [10, 10000] by HoodseaNFT; bonding (token launch) triggers at sellout.
        // Appended last so all existing field positions keep their meaning.
        uint256 maxSupply;
    }

    /**
     * @notice Launch a new NFT collection
     * @dev Creator can set mintPrice to 0, but platform fee still applies
     */
    function launchCollection(LaunchParams calldata p) external nonReentrant returns (address collection) {
        require(p.photoCount >= 3 && p.photoCount <= 6, "Need 3-6 photos");
        require(bytes(p.name).length > 0, "Name required");
        require(bytes(p.ticker).length > 0, "Ticker required");

        uint256 platformFeeWei = getPlatformFeeETH();

        // Per-collection EIP-2981 royalty receiver. A HoodseaFeeSplitter with no
        // buyback (token/router/hook = 0, feeReceiveType = 0 = ETH-only) is exactly a
        // four-way ETH splitter: of every 150 bps it forwards creator 100 / platform 20
        // / kas 20 / airdrop 10 — identical to the token swap-fee split. Marketplace
        // royalties (ETH) land here and anyone can call distribute() to release them.
        address royaltyReceiver = address(new HoodseaFeeSplitter(
            msg.sender,        // creator
            platformTreasury,  // platform
            kasWallet,         // kas
            airdropVault,      // airdrop -> HoodseaVault
            address(0),        // token (no buyback)
            address(0),        // router (buyback disabled)
            address(0),        // feeHook
            0                  // feeReceiveType: ETH-only
        ));

        collection = nftDeployer.deployNFT(
            msg.sender,
            p.name,
            p.ticker,
            p.bio,
            p.photoURIs,
            p.photoCount,
            p.socialX,
            p.socialGithub,
            p.socialFarcaster,
            p.mintPriceWei,
            platformFeeWei,
            p.tokenEnabled,
            p.tokenFeeBps,
            platformTreasury,
            airdropVault,
            kasWallet,
            tokenFactory,
            p.maxSupply,
            royaltyReceiver
        );

        allCollections.push(collection);
        creatorCollections[msg.sender].push(collection);
        isCollection[collection] = true;
        // Anti-sniper decay window + creator fee delivery type for this collection,
        // read by the factory at bonding (pool registration / splitter creation).
        require(p.feeReceiveType <= 2, "bad fee type");
        collectionDecay[collection] = p.decaySeconds;
        collectionFeeType[collection] = p.feeReceiveType;
        // Single-sided pool seed config (token pool always single-sided at this MC).
        collectionStartMc[collection] = p.startMcPairWei;
        collectionPairUSDC[collection] = p.pairIsUSDC;

        // Configure mint phases (GTD / FCFS / Public)
        HoodseaNFT(collection).setupPhases(
            p.phaseRoots,
            p.phaseStarts,
            p.phaseEnds,
            p.phaseMaxPerWallet,
            p.allowlistCID
        );

        emit CollectionLaunched(collection, msg.sender, p.name, p.ticker, p.mintPriceWei, p.phaseStarts[0]);
    }

    // ─── View ─────────────────────────────────────────────────────────────────────

    function getAllCollections() external view returns (address[] memory) {
        return allCollections;
    }

    function getCreatorCollections(address creator) external view returns (address[] memory) {
        return creatorCollections[creator];
    }

    function getCollectionCount() external view returns (uint256) {
        return allCollections.length;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────────

    function updateAddresses(
        address _treasury,
        address _vault,
        address _kasWallet,
        address _factory
    ) external onlyOwner {
        platformTreasury = _treasury;
        airdropVault = _vault;
        kasWallet = _kasWallet;
        tokenFactory = _factory;
    }

}
