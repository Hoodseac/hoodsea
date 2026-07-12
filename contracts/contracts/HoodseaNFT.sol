// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

interface IHoodseaTokenFactory {
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
 * @title HoodseaNFT
 * @notice NFT collection contract for Hoodsea platform
 * @dev Supports up to 6 photo slots, 5 rarity tiers, bonding curve, scheduling
 */
contract HoodseaNFT is ERC1155, Ownable, ReentrancyGuard {
    using Strings for uint256;

    // ─── Constants ──────────────────────────────────────────────────────────────
    // Per-collection mint supply, chosen by the creator at launch (see constructor).
    // Bounded to [MIN_SUPPLY, MAX_SUPPLY_LIMIT]. Bonding (token launch) triggers when
    // totalMinted reaches this value.
    uint256 public immutable maxSupply;
    uint256 public constant MIN_SUPPLY = 10;
    uint256 public constant MAX_SUPPLY_LIMIT = 10000;
    uint256 public constant PRE_BONDING_SELL_FEE_BPS = 5000; // 50%
    uint256 public constant BUY_FEE_BPS = 150;  // 1.5%
    uint256 public constant SELL_FEE_BPS = 150; // 1.5%
    uint256 public constant CREATOR_FEE_BPS = 100;   // 1% of trade volume
    uint256 public constant PLATFORM_TRADE_FEE_BPS = 20; // 0.2%
    uint256 public constant KAS_FEE_BPS = 20;        // 0.2% maintenance
    uint256 public constant AIRDROP_FEE_BPS = 10;    // 0.1%
    uint256 public constant MIN_TOKEN_FEE_BPS = 100; // 1% floor (Clanker-style band)
    uint256 public constant MAX_TOKEN_FEE_BPS = 500; // 5% cap (Clanker-style band)
    uint256 public constant MIN_TTL = 10 minutes;
    uint256 public constant MAX_TTL = 14 days;

    // ─── Rarity ─────────────────────────────────────────────────────────────────
    // Rarities are assigned all at once at sellout via _revealShuffle (exact
    // rarityDistribution), never per-mint.
    enum Rarity { Common, Uncommon, Rare, Epic, Legendary, Mythic }

    // ─── Collection Metadata ─────────────────────────────────────────────────────
    struct CollectionInfo {
        string name;
        string ticker;
        string bio;
        string socialX;
        string socialGithub;
        string socialFarcaster;
        string[6] photoURIs;  // max 6 photos, min 3 required
        uint8 photoCount;
        address creator;
        uint256 mintPrice;    // user-set price in ETH (can be 0)
        uint256 platformFeeETH; // flat platform fee per mint, set from launchpad (0.0003 ETH)
        bool bondingComplete;
        address tokenAddress;
        bool tokenEnabled;    // creator chose to deploy a token at bonding
        uint256 tokenFeeBps;  // swap fee for the token: 150 (1.5%) to 350 (3.5%)
    }

    CollectionInfo public info;

    // ─── Mint Schedule ───────────────────────────────────────────────────────────
    uint256 public mintStartTime;  // UTC unix timestamp
    uint256 public mintEndTime;    // startTime + TTL
    bool public mintScheduled;
    bool public mintOpen;

    // ─── Allowlist Phases (0=Team, 1=GTD, 2=FCFS, 3=Public) ──────────────────────
    struct Phase {
        bytes32 merkleRoot;   // 0x0 = open to all (public, no proof)
        uint256 startTime;    // UTC unix
        uint256 endTime;      // UTC unix
        uint256 maxPerWallet; // 0 = unlimited
    }
    Phase[4] public phases;
    bool public phasesConfigured;
    string public allowlistCID; // IPFS CID for full address lists
    mapping(uint8 => mapping(address => uint256)) public mintedInPhase;

    // ─── Reveal ───────────────────────────────────────────────────────────────────
    bool public revealed;
    uint256 public revealSeed;
    uint256 public bondingBlock; // block at sellout; reveal seed drawn from a later block
    uint256 public constant REVEAL_DELAY = 5; // S1: blocks after sellout for the seed block
    // Rarities packed 3 bits per token, 85 entries per 256-bit word (255 bits used,
    // no entry straddles a word boundary). Length = ceil(maxSupply / 85), so for the
    // 10000 cap this is ceil(10000/85) = 118 words, written once at reveal.
    uint256 public constant RARITIES_PER_WORD = 85;
    uint256[] public packedRarity;

    // Rarity distribution as a per-100 RATIO: [Common, Uncommon, Rare, Epic,
    // Legendary, Mythic]. At reveal these are scaled proportionally to maxSupply
    // (rarer tiers floor-scaled, Common absorbs the remainder), so the counts always
    // sum to exactly maxSupply while preserving the relative ratios. For maxSupply=100
    // this reproduces the original exact counts [46, 30, 15, 5, 1, 3].
    uint8[6] private rarityDistribution = [46, 30, 15, 5, 1, 3];

    // ─── Supply & Pool ───────────────────────────────────────────────────────────
    uint256 public totalMinted;
    uint256 public poolBalance; // ETH in bonding pool
    uint256 public totalOffersEscrow; // ETH held for open collection offers
    // S4: if a fee/sale payout fails (a recipient contract reverts on receive), credit
    // it here instead of bricking the whole trade. The payee pulls it via withdrawPending.
    mapping(address => uint256) public pendingWithdrawals;
    uint256 public totalPending; // sum of pendingWithdrawals (excluded from owner sweep)

    // Token ID => owner mapping for marketplace
    mapping(uint256 => address) public tokenOwner;
    mapping(uint256 => uint256) public tokenListPrice;  // 0 = not listed
    mapping(uint256 => uint256) public tokenListExpiry; // 0 = no expiry
    mapping(uint256 => uint256) public tokenLastSalePrice;

    // Collection-level offers: offerer => amountOffered (pending ETH)
    mapping(address => uint256) public collectionOffer;
    // S7: each offer expires; a stale offer can't be accepted at an old price.
    mapping(address => uint256) public offerExpiry;
    uint256 public constant MAX_OFFER_DURATION = 30 days;

    // ─── Platform ────────────────────────────────────────────────────────────────
    address public platformTreasury;
    address public airdropVault;
    address public kasWallet;
    IHoodseaTokenFactory public tokenFactory;
    address public launchpad;

    // ─── EIP-2981 Royalties (OpenSea) ────────────────────────────────────────────
    // royaltyInfo returns a single receiver — the per-collection HoodseaRoyaltySplitter,
    // which splits each royalty payment between the creator and the airdrop vault.
    // royaltyBps is settable by the creator (owner) up to MAX_ROYALTY_BPS.
    address public royaltyReceiver;              // per-collection HoodseaRoyaltySplitter
    uint256 public royaltyBps = 500;             // 5% default
    uint256 public constant MAX_ROYALTY_BPS = 1000; // 10% cap
    bytes4 private constant ERC2981_INTERFACE_ID = 0x2a55205a;

    // ─── Events ──────────────────────────────────────────────────────────────────
    event CollectionCreated(address indexed creator, string name, string ticker);
    event MintScheduled(uint256 startTime, uint256 endTime);
    event MintOpened();
    event NFTMinted(address indexed minter, uint256 tokenId, Rarity rarity, uint256 price);
    event BondingComplete(address tokenAddress);
    event NFTListed(uint256 indexed tokenId, uint256 price, uint256 expiry, address seller);
    event NFTListingCancelled(uint256 indexed tokenId, address seller);
    event NFTSold(uint256 indexed tokenId, uint256 price, address from, address to);
    event PaymentCredited(address indexed to, uint256 amount); // S4: payout fell back to pull
    event PreBondingSell(uint256 indexed tokenId, address seller, uint256 returned);
    event CollectionOfferMade(address indexed offerer, uint256 amount);
    event CollectionOfferCancelled(address indexed offerer, uint256 amount);

    // ─── Constructor ─────────────────────────────────────────────────────────────
    constructor(
        address _creator,
        string memory _name,
        string memory _ticker,
        string memory _bio,
        string[6] memory _photoURIs,
        uint8 _photoCount,
        string memory _socialX,
        string memory _socialGithub,
        string memory _socialFarcaster,
        uint256 _mintPriceWei,
        uint256 _platformFeeWei,
        bool _tokenEnabled,
        uint256 _tokenFeeBps,
        address _platformTreasury,
        address _airdropVault,
        address _kasWallet,
        address _tokenFactory,
        address _launchpad,
        uint256 _maxSupply,
        address _royaltyReceiver
    ) ERC1155("") Ownable(_creator) {
        require(_photoCount >= 3 && _photoCount <= 6, "Need 3-6 photos");
        require(_maxSupply >= MIN_SUPPLY && _maxSupply <= MAX_SUPPLY_LIMIT, "Supply out of range");
        if (_tokenEnabled) {
            require(
                _tokenFeeBps >= MIN_TOKEN_FEE_BPS && _tokenFeeBps <= MAX_TOKEN_FEE_BPS,
                "Fee out of range"
            );
        }

        maxSupply = _maxSupply;
        info.name = _name;
        info.ticker = _ticker;
        info.bio = _bio;
        info.photoURIs = _photoURIs;
        info.photoCount = _photoCount;
        info.socialX = _socialX;
        info.socialGithub = _socialGithub;
        info.socialFarcaster = _socialFarcaster;
        info.creator = _creator;
        info.mintPrice = _mintPriceWei;
        info.platformFeeETH = _platformFeeWei;
        info.tokenEnabled = _tokenEnabled;
        info.tokenFeeBps = _tokenEnabled ? _tokenFeeBps : 0;

        platformTreasury = _platformTreasury;
        airdropVault = _airdropVault;
        kasWallet = _kasWallet;
        tokenFactory = IHoodseaTokenFactory(_tokenFactory);
        launchpad = _launchpad;
        royaltyReceiver = _royaltyReceiver;

        emit CollectionCreated(_creator, _name, _ticker);
    }

    // ─── Scheduling ──────────────────────────────────────────────────────────────

    modifier onlyOwnerOrLaunchpad() {
        require(msg.sender == owner() || msg.sender == launchpad, "Not authorized");
        _;
    }

    /**
     * @notice Schedule mint for a future UTC time with optional TTL
     * @param _startTime Unix timestamp (UTC) for mint open
     * @param _ttlSeconds Duration in seconds (MIN_TTL to MAX_TTL), 0 = no expiry
     */
    function scheduleMint(uint256 _startTime, uint256 _ttlSeconds) external onlyOwnerOrLaunchpad {
        require(!mintOpen, "Already open");
        require(_startTime > block.timestamp, "Start must be future");
        if (_ttlSeconds > 0) {
            require(_ttlSeconds >= MIN_TTL, "TTL too short (min 10min)");
            require(_ttlSeconds <= MAX_TTL, "TTL too long (max 14 days)");
            mintEndTime = _startTime + _ttlSeconds;
        }
        mintStartTime = _startTime;
        mintScheduled = true;
        emit MintScheduled(_startTime, mintEndTime);
    }

    /**
     * @notice Open mint immediately (no schedule)
     */
    function openMintNow(uint256 _ttlSeconds) external onlyOwnerOrLaunchpad {
        require(!mintOpen, "Already open");
        mintStartTime = block.timestamp;
        if (_ttlSeconds > 0) {
            require(_ttlSeconds >= MIN_TTL, "TTL too short");
            require(_ttlSeconds <= MAX_TTL, "TTL too long");
            mintEndTime = block.timestamp + _ttlSeconds;
        }
        mintOpen = true;
        emit MintOpened();
    }

    /**
     * @notice Trigger open if scheduled time has passed
     */
    function triggerMintOpen() external {
        require(mintScheduled && !mintOpen, "Not scheduled or already open");
        require(block.timestamp >= mintStartTime, "Not time yet");
        mintOpen = true;
        emit MintOpened();
    }

    // ─── Phase Management ─────────────────────────────────────────────────────────

    /**
     * @notice Configure 4 mint phases (Team, GTD, FCFS, Public). Called once by launchpad.
     * @dev Pass merkleRoot 0x0 for a phase with no allowlist (public).
     *      Team phase (index 0) is for the creator's team before public launch.
     */
    function setupPhases(
        bytes32[4] calldata _roots,
        uint256[4] calldata _starts,
        uint256[4] calldata _ends,
        uint256[4] calldata _maxPerWallet,
        string calldata _allowlistCID
    ) external onlyOwnerOrLaunchpad {
        require(!phasesConfigured, "Phases already set");
        for (uint8 i = 0; i < 4; i++) {
            // Sanity-check ordering so a fat-fingered config cannot create a
            // dead phase (start >= end) or an out-of-order / overlapping window.
            // currentPhaseId() returns the lowest active index, so requiring
            // start[i] >= end[i-1] keeps phases sequential and non-overlapping.
            require(_starts[i] < _ends[i], "phase start >= end");
            if (i > 0) require(_starts[i] >= _ends[i - 1], "phase overlap/disorder");
            phases[i] = Phase({
                merkleRoot: _roots[i],
                startTime: _starts[i],
                endTime: _ends[i],
                maxPerWallet: _maxPerWallet[i]
            });
        }
        allowlistCID = _allowlistCID;
        phasesConfigured = true;
        mintStartTime = _starts[0];
        mintEndTime = _ends[3];
    }

    /**
     * @notice Returns the currently active phase id (0=Team,1=GTD,2=FCFS,3=Public),
     *         or reverts if none active.
     */
    function currentPhaseId() public view returns (uint8) {
        for (uint8 i = 0; i < 4; i++) {
            if (block.timestamp >= phases[i].startTime && block.timestamp <= phases[i].endTime) {
                return i;
            }
        }
        revert("No active phase");
    }

    function hasActivePhase() public view returns (bool) {
        for (uint8 i = 0; i < 4; i++) {
            if (block.timestamp >= phases[i].startTime && block.timestamp <= phases[i].endTime) {
                return true;
            }
        }
        return false;
    }

    function isEligible(uint8 _phaseId, address _wallet, bytes32[] calldata _proof) public view returns (bool) {
        require(_phaseId < 4, "Bad phase");
        bytes32 root = phases[_phaseId].merkleRoot;
        if (root == bytes32(0)) return true; // public
        bytes32 leaf = keccak256(abi.encodePacked(_wallet));
        return MerkleProof.verify(_proof, root, leaf);
    }

    function remainingForWallet(uint8 _phaseId, address _wallet) public view returns (uint256) {
        require(_phaseId < 4, "Bad phase");
        uint256 cap = phases[_phaseId].maxPerWallet;
        if (cap == 0) return type(uint256).max;
        uint256 used = mintedInPhase[_phaseId][_wallet];
        return cap > used ? cap - used : 0;
    }

    // ─── Minting ─────────────────────────────────────────────────────────────────

    /**
     * @notice Mint an NFT. Rarity assigned pseudo-randomly on-chain.
     */
    function mint(uint256 quantity, bytes32[] calldata proof) external payable nonReentrant {
        require(phasesConfigured, "Phases not set");
        require(!info.bondingComplete, "Bonding complete");
        require(quantity > 0, "Qty must be > 0");
        require(totalMinted + quantity <= maxSupply, "Exceeds supply");

        // Determine active phase
        uint8 phaseId = currentPhaseId();
        Phase storage ph = phases[phaseId];

        // Allowlist check (public phase has root 0x0 -> always eligible)
        if (ph.merkleRoot != bytes32(0)) {
            bytes32 leaf = keccak256(abi.encodePacked(msg.sender));
            require(MerkleProof.verify(proof, ph.merkleRoot, leaf), "Not allowlisted");
        }

        // Per-wallet cap for this phase (Team phase is always capped if configured)
        if (ph.maxPerWallet > 0) {
            require(
                mintedInPhase[phaseId][msg.sender] + quantity <= ph.maxPerWallet,
                "Exceeds wallet limit"
            );
        }

        uint256 unitPrice = info.mintPrice + info.platformFeeETH;
        uint256 totalRequired = unitPrice * quantity;
        require(msg.value >= totalRequired, "Insufficient ETH");

        // Platform fee (per unit) to treasury
        uint256 totalPlatformFee = info.platformFeeETH * quantity;
        if (totalPlatformFee > 0) {
            _payOrCredit(platformTreasury, totalPlatformFee); // S4
        }

        // Mint price portion to pool
        poolBalance += (totalRequired - totalPlatformFee);

        // Mint `quantity` NFTs (rarity assigned later at reveal)
        for (uint256 i = 0; i < quantity; i++) {
            uint256 tokenId = totalMinted + 1;
            tokenOwner[tokenId] = msg.sender;
            totalMinted++;
            _mint(msg.sender, tokenId, 1, "");
            emit NFTMinted(msg.sender, tokenId, Rarity.Common, unitPrice);
        }

        mintedInPhase[phaseId][msg.sender] += quantity;

        // Trigger bonding when sold out. NOTE: only _completeBonding runs here (token
        // deploy, O(1)); the rarity shuffle is deliberately NOT done in this tx so the
        // final minter never pays an N-sized gas cost. The shuffle runs later in
        // _maybeReveal (permissionless revealRarities / first marketplace action).
        if (totalMinted == maxSupply) {
            _completeBonding();
        }

        // Refund excess
        if (msg.value > totalRequired) {
            (bool refund,) = msg.sender.call{value: msg.value - totalRequired}("");
            require(refund, "Refund failed");
        }
    }

    /**
     * @notice Sell NFT back to pool PRE-bonding (50% fee penalty)
     */
    function sellPreBonding(uint256 _tokenId) external nonReentrant {
        require(!info.bondingComplete, "Use marketplace post-bonding");
        require(tokenOwner[_tokenId] == msg.sender, "Not owner");
        require(balanceOf(msg.sender, _tokenId) >= 1, "No balance");

        uint256 pricePerToken = poolBalance / totalMinted;
        uint256 penalty = (pricePerToken * PRE_BONDING_SELL_FEE_BPS) / 10000;
        uint256 returned = pricePerToken - penalty;

        // Remove the full token share from the pool; user gets their part back,
        // the 50% penalty goes to the platform wallet.
        poolBalance -= pricePerToken;
        totalMinted--;
        tokenOwner[_tokenId] = address(0);

        _burn(msg.sender, _tokenId, 1);

        (bool ok,) = msg.sender.call{value: returned}("");
        require(ok, "Transfer failed");

        _payOrCredit(platformTreasury, penalty); // S4

        emit PreBondingSell(_tokenId, msg.sender, returned);
    }

    // ─── Bonding Completion ───────────────────────────────────────────────────────

    function _completeBonding() internal {
        info.bondingComplete = true;

        // Record the sellout block. The reveal seed is drawn from a LATER block's
        // hash (see _maybeReveal), so the final minter cannot compute their rarity
        // in the same transaction and grind for Mythic.
        bondingBlock = block.number;

        // NFT-only collection: no token, no pool. The mint ETH stays in the
        // contract for the creator to withdraw. Marketplace still unlocks.
        if (!info.tokenEnabled) {
            emit BondingComplete(address(0));
            return;
        }

        // Deploy token via factory — uses Mythic photo (last photo added)
        string memory mythicPhoto = info.photoURIs[info.photoCount - 1];

        // The token pool is seeded SINGLE-SIDED (token-only) by the factory, so no
        // ETH is sent here — ALL mint proceeds stay in this contract as the creator's
        // revenue to withdraw. (Previously 20% was forwarded as a two-sided pool seed.)
        uint256 feeBps = info.tokenFeeBps;
        address tokenAddr;
        try tokenFactory.deployToken(
            address(this),
            info.creator,
            info.name,
            info.ticker,
            mythicPhoto,
            info.bio,
            info.socialX,
            info.socialGithub,
            info.socialFarcaster,
            feeBps
        ) returns (address deployed) {
            tokenAddr = deployed;
        } catch {
            // Token deploy failed entirely — bonding still completes as NFT-only so
            // the collection is never bricked. (Pool seeding itself is best-effort
            // inside the factory, so this path is only hit on a hard token failure.)
            tokenAddr = address(0);
        }

        info.tokenAddress = tokenAddr;
        emit BondingComplete(tokenAddr);
    }

    // ─── Reveal / Rarity (view-based, computed from revealSeed) ───────────────────

    /**
     * @notice Fisher-Yates shuffle of the exact rarity distribution over the full
     *         maxSupply, packed 3 bits per token into a dynamic uint256[] (85 entries
     *         per word). Runs once at reveal, NOT at the last mint, so its N-sized
     *         cost is paid by whoever first triggers reveal, never forced on the final
     *         minter. For maxSupply=10000 this is ~118 storage words, well within a
     *         single transaction on this chain (block gas limit is astronomically
     *         high; see report).
     */
    function _revealShuffle() internal {
        uint256 n = maxSupply;

        // Build the rarity array. new bytes(n) is zero-initialised, and Common == 0,
        // so we only WRITE the rarer tiers (1..5), floor-scaled from the per-100 ratio.
        // The remaining (zero) positions are Common, so the counts sum to exactly n
        // with the remainder assigned to Common (the most common tier).
        bytes memory arr = new bytes(n);
        uint256 idx = 0;
        for (uint8 r = 1; r < 6; r++) {
            uint256 count = (uint256(rarityDistribution[r]) * n) / 100;
            for (uint256 c = 0; c < count; c++) {
                arr[idx] = bytes1(r);
                idx++;
            }
        }
        // positions idx..n-1 remain 0 (Rarity.Common)

        // Fisher-Yates shuffle using revealSeed
        for (uint256 i = n - 1; i > 0; i--) {
            uint256 j = uint256(keccak256(abi.encodePacked(revealSeed, i))) % (i + 1);
            bytes1 tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }

        // Pack 3 bits per token, RARITIES_PER_WORD (85) entries per word so no entry
        // straddles a word boundary. Build in memory, then one storage assignment
        // resizes packedRarity and writes ceil(n / 85) words.
        uint256 words = (n + RARITIES_PER_WORD - 1) / RARITIES_PER_WORD;
        uint256[] memory packed = new uint256[](words);
        for (uint256 i = 0; i < n; i++) {
            uint256 w = i / RARITIES_PER_WORD;
            uint256 shift = (i % RARITIES_PER_WORD) * 3;
            packed[w] |= uint256(uint8(arr[i])) << shift;
        }
        packedRarity = packed;
    }


    /**
     * @notice Draw the reveal seed from a block mined AFTER sellout and shuffle.
     *         Permissionless; auto-triggered by the first marketplace action.
     *         Because blockhash(bondingBlock) is not known during the bonding
     *         transaction, the final minter cannot grind for rare tiers.
     */
    function revealRarities() public {
        _maybeReveal();
    }

    function _maybeReveal() internal {
        if (revealed || !info.bondingComplete || bondingBlock == 0) return;
        uint256 seedBlock = bondingBlock + REVEAL_DELAY;
        if (block.number <= seedBlock) return; // seed block not mined yet

        bytes32 bh = blockhash(seedBlock);
        if (bh == bytes32(0)) {
            // S1: the seed block aged out of the 256-block window before anyone
            // revealed. Re-anchor to a fresh future block so the seed can never
            // collapse to a predictable constant (keccak of 0).
            bondingBlock = block.number;
            return;
        }
        // S1: the seed is a FUTURE block's hash — unknown at sellout (so the final
        // minter can't grind) and fixed once mined (so the seed is identical no matter
        // WHEN reveal is triggered, closing the prevrandao retry-until-rare grind).
        revealSeed = uint256(keccak256(abi.encodePacked(bh, address(this), totalMinted)));
        _revealShuffle();
        revealed = true;
    }

    /**
     * @notice Get the revealed rarity for a token. Returns Common as placeholder
     *         until revealed. Deterministic from revealSeed once revealed.
     * @dev Rarity slots are derived from the seed by assigning the rarest tiers
     *      to pseudo-random token positions, in counts scaled from the per-100
     *      rarity ratios to the collection's maxSupply.
     */
    function getRarity(uint256 _tokenId) public view returns (Rarity) {
        require(_tokenId >= 1 && _tokenId <= totalMinted, "Bad tokenId");
        if (!revealed) return Rarity.Common; // unrevealed placeholder

        // Token #N is stored at position N-1 in the packed array (85 entries/word).
        uint256 pos = _tokenId - 1;
        uint256 word = pos / RARITIES_PER_WORD;
        uint256 shift = (pos % RARITIES_PER_WORD) * 3;
        uint256 val = (packedRarity[word] >> shift) & 0x7; // 3 bits -> 0..5
        return Rarity(val);
    }

    /**
     * @notice Whether the collection has been revealed.
     */
    function isRevealed() external view returns (bool) {
        return revealed;
    }

    // ─── Post-Bonding Marketplace ─────────────────────────────────────────────────

    /**
     * @notice List an NFT for sale with optional expiry timestamp.
     * @param _expiry Unix timestamp after which listing auto-expires; 0 = no expiry.
     */
    function listNFT(uint256 _tokenId, uint256 _price, uint256 _expiry) external {
        require(info.bondingComplete, "Bonding not complete yet");
        _maybeReveal();
        require(tokenOwner[_tokenId] == msg.sender, "Not owner");
        require(_price > 0, "Price must be > 0");
        require(_expiry == 0 || _expiry > block.timestamp, "Expiry must be future");
        tokenListPrice[_tokenId] = _price;
        tokenListExpiry[_tokenId] = _expiry;
        emit NFTListed(_tokenId, _price, _expiry, msg.sender);
    }

    function cancelListing(uint256 _tokenId) external {
        require(tokenOwner[_tokenId] == msg.sender, "Not owner");
        require(tokenListPrice[_tokenId] > 0, "Not listed");
        tokenListPrice[_tokenId] = 0;
        tokenListExpiry[_tokenId] = 0;
        emit NFTListingCancelled(_tokenId, msg.sender);
    }

    /// @dev Execute one listed purchase (price, fees, transfer, payouts). Returns the
    ///      price paid. Caller must ensure msg.value covers the sum of all prices.
    function _buyListed(uint256 _tokenId) private returns (uint256 listPrice) {
        listPrice = tokenListPrice[_tokenId];
        require(listPrice > 0, "Not listed");
        uint256 expiry = tokenListExpiry[_tokenId];
        require(expiry == 0 || block.timestamp <= expiry, "Listing expired");
        address seller = tokenOwner[_tokenId];
        require(seller != msg.sender, "Cannot buy own NFT");

        uint256 creatorFee = (listPrice * CREATOR_FEE_BPS) / 10000;         // 1%
        uint256 platformFee = (listPrice * PLATFORM_TRADE_FEE_BPS) / 10000; // 0.2%
        uint256 kasFee = (listPrice * KAS_FEE_BPS) / 10000;                 // 0.2%
        uint256 airdropFee = (listPrice * AIRDROP_FEE_BPS) / 10000;         // 0.1%
        uint256 sellerReceives = listPrice - creatorFee - platformFee - kasFee - airdropFee;

        tokenOwner[_tokenId] = msg.sender;
        tokenListPrice[_tokenId] = 0;
        tokenListExpiry[_tokenId] = 0;
        tokenLastSalePrice[_tokenId] = listPrice;
        _safeTransferFrom(seller, msg.sender, _tokenId, 1, "");

        // S4: credit-on-fail so a reverting recipient can't brick the sale
        _payOrCredit(seller, sellerReceives);
        _payOrCredit(info.creator, creatorFee);
        _payOrCredit(platformTreasury, platformFee);
        _payOrCredit(kasWallet, kasFee);
        _payOrCredit(airdropVault, airdropFee);

        emit NFTSold(_tokenId, listPrice, seller, msg.sender);
    }

    function buyNFT(uint256 _tokenId) external payable nonReentrant {
        require(info.bondingComplete, "Bonding not complete");
        _maybeReveal();
        uint256 spent = _buyListed(_tokenId);
        require(msg.value >= spent, "Insufficient ETH");
        if (msg.value > spent) {
            (bool refund,) = msg.sender.call{value: msg.value - spent}("");
            require(refund, "Refund failed");
        }
    }

    /// @notice F4: buy several listed NFTs in one transaction (sweep). Reverts the whole
    ///         batch (atomic) if total ETH sent is short of the listed prices.
    function buyMany(uint256[] calldata _tokenIds) external payable nonReentrant {
        require(info.bondingComplete, "Bonding not complete");
        require(_tokenIds.length > 0 && _tokenIds.length <= 50, "Bad count");
        _maybeReveal();
        uint256 spent;
        for (uint256 i = 0; i < _tokenIds.length; i++) {
            spent += _buyListed(_tokenIds[i]);
        }
        require(msg.value >= spent, "Insufficient ETH");
        if (msg.value > spent) {
            (bool refund,) = msg.sender.call{value: msg.value - spent}("");
            require(refund, "Refund failed");
        }
    }

    /**
     * @notice Deposit ETH as a standing offer for any NFT in this collection.
     *         Any owner can call acceptOffer() to sell to the highest offerer.
     */
    function makeCollectionOffer(uint256 _duration) external payable nonReentrant {
        require(info.bondingComplete, "Bonding not complete");
        require(msg.value > 0, "No ETH sent");
        require(_duration > 0 && _duration <= MAX_OFFER_DURATION, "Bad duration"); // S7
        collectionOffer[msg.sender] += msg.value;
        offerExpiry[msg.sender] = block.timestamp + _duration;
        totalOffersEscrow += msg.value;
        emit CollectionOfferMade(msg.sender, collectionOffer[msg.sender]);
    }

    function cancelCollectionOffer() external nonReentrant {
        uint256 amount = collectionOffer[msg.sender];
        require(amount > 0, "No offer");
        collectionOffer[msg.sender] = 0;
        offerExpiry[msg.sender] = 0;
        totalOffersEscrow -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Refund failed");
        emit CollectionOfferCancelled(msg.sender, amount);
    }

    /// @param _agreedPrice the sale price (<= the offerer's deposited budget); any
    ///        excess deposit is refunded to the offerer. (S6) Offer must not be expired (S7).
    function acceptCollectionOffer(uint256 _tokenId, address _offerer, uint256 _agreedPrice) external nonReentrant {
        require(info.bondingComplete, "Bonding not complete");
        _maybeReveal();
        require(tokenOwner[_tokenId] == msg.sender, "Not owner");
        uint256 budget = collectionOffer[_offerer];
        require(budget > 0, "No offer from address");
        require(block.timestamp <= offerExpiry[_offerer], "Offer expired"); // S7
        require(_agreedPrice > 0 && _agreedPrice <= budget, "Bad agreed price"); // S6
        uint256 refund = budget - _agreedPrice;

        collectionOffer[_offerer] = 0;
        offerExpiry[_offerer] = 0;
        totalOffersEscrow -= budget;
        tokenOwner[_tokenId] = _offerer;
        tokenListPrice[_tokenId] = 0;
        tokenListExpiry[_tokenId] = 0;
        tokenLastSalePrice[_tokenId] = _agreedPrice;
        _safeTransferFrom(msg.sender, _offerer, _tokenId, 1, "");

        uint256 creatorFee = (_agreedPrice * CREATOR_FEE_BPS) / 10000;
        uint256 platformFee = (_agreedPrice * PLATFORM_TRADE_FEE_BPS) / 10000;
        uint256 kasFee = (_agreedPrice * KAS_FEE_BPS) / 10000;
        uint256 airdropFee = (_agreedPrice * AIRDROP_FEE_BPS) / 10000;
        uint256 sellerReceives = _agreedPrice - creatorFee - platformFee - kasFee - airdropFee;
        if (refund > 0) _payOrCredit(_offerer, refund); // S6 refund / S4 credit-on-fail

        // S4: credit-on-fail so a reverting recipient can't brick the accept
        _payOrCredit(msg.sender, sellerReceives);
        _payOrCredit(info.creator, creatorFee);
        _payOrCredit(platformTreasury, platformFee);
        _payOrCredit(kasWallet, kasFee);
        _payOrCredit(airdropVault, airdropFee);

        emit NFTSold(_tokenId, _agreedPrice, msg.sender, _offerer);
    }

    // ─── View Functions ───────────────────────────────────────────────────────────

    /**
     * @dev Keep the marketplace's tokenOwner + listings in sync with real ERC1155
     *      balances on every move, including direct safeTransferFrom by holders.
     *      Without this a raw transfer would leave a stale owner/listing, locking
     *      the new holder out of the built-in marketplace and leaving listings
     *      that revert on buy.
     */
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal override {
        super._update(from, to, ids, values);
        // Only resync on real transfers between accounts (not mint or burn, which
        // the mint/sell paths already set explicitly).
        if (from != address(0) && to != address(0)) {
            for (uint256 i = 0; i < ids.length; i++) {
                uint256 id = ids[i];
                tokenOwner[id] = to;
                tokenListPrice[id] = 0;
                tokenListExpiry[id] = 0;
            }
        }
    }

    function uri(uint256 _tokenId) public view override returns (string memory) {
        Rarity r = getRarity(_tokenId);
        // Return appropriate photo based on rarity index
        uint8 photoIdx = uint8(r);
        if (photoIdx >= info.photoCount) photoIdx = info.photoCount - 1;
        return info.photoURIs[photoIdx];
    }

    // ─── OpenSea: contractURI (collection metadata) ───────────────────────────────

    /**
     * @notice OpenSea collection-level metadata, built on-chain from the collection's
     *         existing stored data as a base64 JSON data URI. No off-chain hosting and
     *         no extra storage: {name, description, image}. `image` is the first photo
     *         (already an ipfs:// / gateway URL OpenSea resolves). Royalties are NOT
     *         duplicated here — OpenSea reads them from EIP-2981 royaltyInfo, so the
     *         redundant seller_fee_basis_points/fee_recipient hints are omitted to keep
     *         the embedded creation code under the EIP-170 limit (see report).
     * @dev name/bio are creator-supplied and are NOT JSON-escaped; a creator who puts a
     *      double-quote in their own name/bio only breaks their own contractURI render
     *      (cosmetic, no funds at risk). See report.
     */
    function contractURI() external view returns (string memory) {
        bytes memory json = abi.encodePacked(
            '{"name":"', info.name,
            '","description":"', info.bio,
            '","image":"', info.photoURIs[0],
            '"}'
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(json)));
    }

    // ─── EIP-2981 Royalties ───────────────────────────────────────────────────────

    /**
     * @notice EIP-2981: royalty owed on a sale of `salePrice`. The receiver is this
     *         collection's HoodseaRoyaltySplitter, which forwards the payment split
     *         between the creator and the airdrop vault. Collection-wide (tokenId
     *         is ignored).
     */
    function royaltyInfo(uint256, uint256 salePrice)
        external
        view
        returns (address receiver, uint256 amount)
    {
        return (royaltyReceiver, (salePrice * royaltyBps) / 10000);
    }

    /// @notice Creator (owner) sets the royalty rate, capped at MAX_ROYALTY_BPS (10%).
    function setRoyaltyBps(uint256 _bps) external onlyOwner {
        require(_bps <= MAX_ROYALTY_BPS, "royalty too high");
        royaltyBps = _bps;
    }

    /// @dev Advertise ERC-2981 support (0x2a55205a) alongside ERC1155/ERC165.
    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == ERC2981_INTERFACE_ID || super.supportsInterface(interfaceId);
    }

    function getMintStatus() external view returns (
        bool isOpen,
        bool isScheduled,
        uint256 startTime,
        uint256 endTime,
        uint256 minted,
        uint256 remaining,
        bool bonded
    ) {
        return (mintOpen, mintScheduled, mintStartTime, mintEndTime, totalMinted, maxSupply - totalMinted, info.bondingComplete);
    }

    function getCollectionInfo() external view returns (CollectionInfo memory) {
        return info;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────────

    function updatePlatformFeeETH(uint256 _newFeeWei) external {
        require(msg.sender == platformTreasury, "Only platform");
        info.platformFeeETH = _newFeeWei;
    }

    function withdrawEmergency() external onlyOwner nonReentrant {
        require(info.bondingComplete, "Pool not released");
        // Never touch ETH escrowed for open collection offers or credited to payees
        // via pendingWithdrawals — that money belongs to others.
        uint256 claimable = address(this).balance - totalOffersEscrow - totalPending;
        (bool ok,) = owner().call{value: claimable}("");
        require(ok);
    }

    // ─── S4: non-bricking payouts ────────────────────────────────────────────────
    /// @dev Pay `to`; if the transfer fails (recipient reverts), credit it so the
    ///      payee can pull later instead of bricking the whole trade.
    function _payOrCredit(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) {
            pendingWithdrawals[to] += amount;
            totalPending += amount;
            emit PaymentCredited(to, amount);
        }
    }

    /// @notice Pull a payout that previously failed to send.
    function withdrawPending() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing pending");
        pendingWithdrawals[msg.sender] = 0;
        totalPending -= amount;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
    }
}
