// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title HoodseaAirdrop
 * @notice Permissionless, multi-campaign airdrop pool for ANY ERC-20 on Robinhood Chain.
 *         Anyone (creator or user) opens a campaign, deposits tokens, and others claim.
 *         Phase 1 supports two claim models; richer eligibility (top holder/loser,
 *         NFT multiplier, hold-duration) is computed OFF-CHAIN and committed as a
 *         MERKLE root, so this contract already serves them with no changes.
 *
 * Models:
 *   - MERKLE: creator commits a root of (account, amount) leaves (a manual wallet
 *     list OR any snapshot result). Recipients claim their exact amount with a proof.
 *   - FCFS:   fixed amountPerWallet, first come first served until the pool empties.
 *     Optional gate: claimer must hold >= gateMin of gateToken (ERC-20 or ERC-721,
 *     both expose balanceOf(address)). gateToken == 0 means open to anyone.
 *
 * Security model (this contract custodies user funds):
 *   - Per-campaign accounting via `remaining`; one campaign can never touch another's
 *     balance even when they share the same token.
 *   - Checks-Effects-Interactions: state (claimed / remaining) is written BEFORE any
 *     token transfer, plus nonReentrant.
 *   - SafeERC20 for non-standard tokens; deposits measure the ACTUAL received amount so
 *     fee-on-transfer tokens cannot over-credit a campaign.
 *   - NO owner / admin. Nobody can pause, drain, or alter a live campaign. Funds are
 *     locked until expiry; only the original creator can sweep the UNCLAIMED remainder
 *     AFTER expiry. This removes any rug/backdoor vector.
 *   - Custom errors (not strip-able by the compiler's revertStrings:strip), so failures
 *     stay precise and cheap.
 *
 * Leaf hashing matches OpenZeppelin merkle-tree StandardMerkleTree(["address","uint256"]):
 *   leaf = keccak256(bytes.concat(keccak256(abi.encode(account, amount))))
 *
 * SUPPORTED TOKENS / LIMITATIONS (audit 2026-06-23):
 *   - Standard and fee-on-transfer ERC-20s are supported. Deposits credit the ACTUAL
 *     received amount, so fee-on-transfer cannot over-credit a campaign.
 *   - REBASING / elastic-supply tokens are NOT supported: balances of one token are
 *     commingled across campaigns and tracked by `remaining`; a negative rebase can
 *     make sum(remaining) exceed the real balance (late claims/sweep revert), and a
 *     positive rebase strands the surplus. Do not create campaigns with such tokens.
 *   - A campaign's `remaining` accounting trusts the token's own balanceOf. A token
 *     that lies about balances can only affect ITS OWN campaigns (transfers are per
 *     `c.token`); it can never reach a campaign of a different token. The front end
 *     additionally requires real DEX liquidity on mainnet to keep junk tokens out.
 *   - FCFS holder gate uses balanceOf(address): works for ERC-20 and ERC-721, NOT
 *     ERC-1155 (different signature; such a gate simply bricks that one campaign). The
 *     gate is a balance check at claim time, so it is NOT Sybil-resistant (the gate
 *     token can be moved between wallets). For strict eligibility use a MERKLE snapshot.
 *
 * No emoji, no em dash.
 */
contract HoodseaAirdrop is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroToken();
    error ZeroRoot();
    error ZeroAmount();
    error ZeroPerWallet();
    error AmountBelowPerWallet();
    error ZeroGateMin();
    error ExpiryPast();
    error NotMerkle();
    error NotFcfs();
    error Expired();
    error AlreadyClaimed();
    error BadProof();
    error InsufficientPool();
    error PoolEmpty();
    error NotEligible();
    error NotCreator();
    error NotExpired();
    error AlreadySwept();
    error NothingReceived();

    enum Mode { MERKLE, FCFS }

    struct Campaign {
        address creator;
        address token;
        Mode mode;
        bytes32 merkleRoot;      // MERKLE only
        uint256 amountPerWallet; // FCFS only
        address gateToken;       // FCFS optional gate (ERC20/ERC721); 0 = open
        uint256 gateMin;         // FCFS gate threshold
        uint256 deposited;       // actual tokens received at creation
        uint256 remaining;       // tokens still claimable; sweepable after expiry
        uint256 claimedCount;    // number of successful claims (analytics)
        uint64  expiry;          // unix ts; claims allowed while now <= expiry
        bool    swept;           // creator pulled the leftover after expiry
    }

    Campaign[] public campaigns;
    // campaignId => account => already claimed
    mapping(uint256 => mapping(address => bool)) public claimed;

    event CampaignCreated(
        uint256 indexed id, address indexed creator, address indexed token,
        Mode mode, uint256 deposited, uint64 expiry
    );
    event Claimed(uint256 indexed id, address indexed account, uint256 amount);
    event Swept(uint256 indexed id, address indexed creator, uint256 amount);

    // ----------------------------------------------------------------- create

    /// @notice Open a MERKLE campaign (manual list or any off-chain snapshot result).
    function createMerkleCampaign(
        address token,
        bytes32 merkleRoot,
        uint256 totalAmount,
        uint64 expiry
    ) external nonReentrant returns (uint256 id) {
        if (token == address(0)) revert ZeroToken();
        if (merkleRoot == bytes32(0)) revert ZeroRoot();
        if (totalAmount == 0) revert ZeroAmount();
        if (expiry <= block.timestamp) revert ExpiryPast();

        uint256 received = _pullDeposit(token, totalAmount);

        id = campaigns.length;
        campaigns.push(Campaign({
            creator: msg.sender,
            token: token,
            mode: Mode.MERKLE,
            merkleRoot: merkleRoot,
            amountPerWallet: 0,
            gateToken: address(0),
            gateMin: 0,
            deposited: received,
            remaining: received,
            claimedCount: 0,
            expiry: expiry,
            swept: false
        }));
        emit CampaignCreated(id, msg.sender, token, Mode.MERKLE, received, expiry);
    }

    /// @notice Open an FCFS campaign: fixed amount per wallet until the pool empties.
    function createFcfsCampaign(
        address token,
        uint256 amountPerWallet,
        uint256 totalAmount,
        address gateToken,
        uint256 gateMin,
        uint64 expiry
    ) external nonReentrant returns (uint256 id) {
        if (token == address(0)) revert ZeroToken();
        if (amountPerWallet == 0) revert ZeroPerWallet();
        if (totalAmount < amountPerWallet) revert AmountBelowPerWallet();
        if (expiry <= block.timestamp) revert ExpiryPast();
        if (gateToken != address(0) && gateMin == 0) revert ZeroGateMin();

        uint256 received = _pullDeposit(token, totalAmount);

        id = campaigns.length;
        campaigns.push(Campaign({
            creator: msg.sender,
            token: token,
            mode: Mode.FCFS,
            merkleRoot: bytes32(0),
            amountPerWallet: amountPerWallet,
            gateToken: gateToken,
            gateMin: gateMin,
            deposited: received,
            remaining: received,
            claimedCount: 0,
            expiry: expiry,
            swept: false
        }));
        emit CampaignCreated(id, msg.sender, token, Mode.FCFS, received, expiry);
    }

    // ------------------------------------------------------------------ claim

    function claimMerkle(uint256 id, uint256 amount, bytes32[] calldata proof)
        external nonReentrant
    {
        Campaign storage c = campaigns[id];
        if (c.mode != Mode.MERKLE) revert NotMerkle();
        if (block.timestamp > c.expiry) revert Expired();
        if (claimed[id][msg.sender]) revert AlreadyClaimed();
        if (amount == 0) revert ZeroAmount();
        if (!MerkleProof.verify(proof, c.merkleRoot, _leaf(msg.sender, amount))) revert BadProof();
        if (c.remaining < amount) revert InsufficientPool();

        // effects before interaction
        claimed[id][msg.sender] = true;
        c.remaining -= amount;
        c.claimedCount += 1;

        IERC20(c.token).safeTransfer(msg.sender, amount);
        emit Claimed(id, msg.sender, amount);
    }

    function claimFcfs(uint256 id) external nonReentrant {
        Campaign storage c = campaigns[id];
        if (c.mode != Mode.FCFS) revert NotFcfs();
        if (block.timestamp > c.expiry) revert Expired();
        if (claimed[id][msg.sender]) revert AlreadyClaimed();
        uint256 amt = c.amountPerWallet;
        if (c.remaining < amt) revert PoolEmpty();
        if (c.gateToken != address(0) && _balanceOf(c.gateToken, msg.sender) < c.gateMin) {
            revert NotEligible();
        }

        // effects before interaction
        claimed[id][msg.sender] = true;
        c.remaining -= amt;
        c.claimedCount += 1;

        IERC20(c.token).safeTransfer(msg.sender, amt);
        emit Claimed(id, msg.sender, amt);
    }

    // ------------------------------------------------------------------ sweep

    /// @notice After expiry, the creator reclaims whatever was never claimed.
    function sweep(uint256 id) external nonReentrant {
        Campaign storage c = campaigns[id];
        if (msg.sender != c.creator) revert NotCreator();
        if (block.timestamp <= c.expiry) revert NotExpired();
        if (c.swept) revert AlreadySwept();
        uint256 amt = c.remaining;
        c.swept = true;
        c.remaining = 0;
        if (amt > 0) IERC20(c.token).safeTransfer(c.creator, amt);
        emit Swept(id, c.creator, amt);
    }

    // ------------------------------------------------------------------ views

    function campaignsCount() external view returns (uint256) {
        return campaigns.length;
    }

    /// @notice FCFS eligibility helper for the frontend (real-time checker).
    function fcfsEligible(uint256 id, address account)
        external view returns (bool eligible, uint256 amount)
    {
        Campaign storage c = campaigns[id];
        if (c.mode != Mode.FCFS) return (false, 0);
        if (block.timestamp > c.expiry) return (false, 0);
        if (claimed[id][account]) return (false, 0);
        if (c.remaining < c.amountPerWallet) return (false, 0);
        if (c.gateToken != address(0) && _balanceOf(c.gateToken, account) < c.gateMin) {
            return (false, 0);
        }
        return (true, c.amountPerWallet);
    }

    /// @notice MERKLE eligibility helper: verifies a proof without spending gas to claim.
    function merkleEligible(uint256 id, address account, uint256 amount, bytes32[] calldata proof)
        external view returns (bool eligible)
    {
        Campaign storage c = campaigns[id];
        if (c.mode != Mode.MERKLE) return false;
        if (block.timestamp > c.expiry) return false;
        if (claimed[id][account]) return false;
        if (amount == 0 || c.remaining < amount) return false;
        return MerkleProof.verify(proof, c.merkleRoot, _leaf(account, amount));
    }

    // --------------------------------------------------------------- internal

    function _pullDeposit(address token, uint256 amount) internal returns (uint256 received) {
        // Measure actual received so fee-on-transfer tokens cannot over-credit.
        uint256 balBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        received = IERC20(token).balanceOf(address(this)) - balBefore;
        if (received == 0) revert NothingReceived();
    }

    function _leaf(address account, uint256 amount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, amount))));
    }

    function _balanceOf(address token, address account) internal view returns (uint256) {
        // Works for ERC-20 and ERC-721 (both expose balanceOf(address)).
        return IERC20(token).balanceOf(account);
    }
}
