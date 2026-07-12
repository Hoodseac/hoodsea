// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title AirdropDistributor
 * @notice Cumulative merkle airdrop for launchpad tokens. Funded by HoodseaVault
 *         (the 1% per epoch that used to be burned now lives here, claimable forever).
 *
 * @dev Model (policy lives off-chain in the oracle, this contract just enforces it):
 *   - The vault transfers the per-epoch airdrop allocation into this contract per token.
 *   - Each day the oracle publishes a CUMULATIVE merkle root per token. A leaf is
 *     (account, cumulativeAmount) where cumulativeAmount is the total that account is
 *     entitled to up to that snapshot. Daily snapshots, the 0.001 ETH minimum loss
 *     filter, and rollover of the unallocated pool to the next day's losers are all
 *     decided by the oracle when it builds each root.
 *   - A user can claim anytime, forever, with no expiry. claimed[token][user] tracks the
 *     cumulative amount already pulled, so re-publishing a higher root just tops them up
 *     and double-claiming is impossible.
 *   - Leaf hashing matches OpenZeppelin merkle-tree StandardMerkleTree(["address","uint256"]):
 *       leaf = keccak256(bytes.concat(keccak256(abi.encode(account, cumulativeAmount))))
 *
 * No emoji, no em dash.
 */
contract AirdropDistributor is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public oracle; // publishes daily cumulative roots
    address public vault;  // the only address allowed to fund (HoodseaVault)

    // token => current cumulative merkle root
    mapping(address => bytes32) public merkleRoot;
    // token => snapshot round counter (bumped on every root update, for the frontend/events)
    mapping(address => uint256) public round;
    // token => account => cumulative amount already claimed
    mapping(address => mapping(address => uint256)) public claimed;
    // token => total funded into this contract over its lifetime (accounting only)
    mapping(address => uint256) public totalFunded;
    // token => total claimed across all users (accounting only)
    mapping(address => uint256) public totalClaimed;

    event OracleUpdated(address indexed oracle);
    event VaultUpdated(address indexed vault);
    event Funded(address indexed token, uint256 amount, address indexed from);
    event RootUpdated(address indexed token, uint256 indexed round, bytes32 root);
    event Claimed(address indexed token, address indexed account, uint256 amount);

    constructor(address _owner, address _oracle) Ownable(_owner) {
        oracle = _oracle;
        emit OracleUpdated(_oracle);
    }

    // ─── Admin ─────────────────────────────────────────────────────────────────────
    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
        emit OracleUpdated(_oracle);
    }

    function setVault(address _vault) external onlyOwner {
        vault = _vault;
        emit VaultUpdated(_vault);
    }

    // ─── Funding (from the vault on each epoch) ──────────────────────────────────────
    /// @notice Pull `amount` of `token` from the caller into the pool. Caller must approve first.
    /// @dev Restricted to the vault so random tokens cannot grief the accounting.
    function fund(address token, uint256 amount) external {
        require(msg.sender == vault, "Only vault");
        require(amount > 0, "Zero amount");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        totalFunded[token] += amount;
        emit Funded(token, amount, msg.sender);
    }

    /// @notice Account for tokens already transferred straight into this contract (push funding).
    /// @dev Lets the vault simply safeTransfer then notify, avoiding an approve step.
    function notifyFunded(address token, uint256 amount) external {
        require(msg.sender == vault, "Only vault");
        totalFunded[token] += amount;
        emit Funded(token, amount, msg.sender);
    }

    // ─── Oracle: publish the daily cumulative root ──────────────────────────────────
    function setRoot(address token, bytes32 root) external {
        require(msg.sender == oracle, "Not oracle");
        merkleRoot[token] = root;
        uint256 r = ++round[token];
        emit RootUpdated(token, r, root);
    }

    function setRoots(address[] calldata tokens, bytes32[] calldata roots) external {
        require(msg.sender == oracle, "Not oracle");
        require(tokens.length == roots.length, "Length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            merkleRoot[tokens[i]] = roots[i];
            uint256 r = ++round[tokens[i]];
            emit RootUpdated(tokens[i], r, roots[i]);
        }
    }

    // ─── Claim ──────────────────────────────────────────────────────────────────────
    function _leaf(address account, uint256 cumulativeAmount) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, cumulativeAmount))));
    }

    /// @notice How much `account` can claim right now given a valid cumulative leaf.
    function claimable(address token, address account, uint256 cumulativeAmount, bytes32[] calldata proof)
        external
        view
        returns (uint256)
    {
        if (!MerkleProof.verify(proof, merkleRoot[token], _leaf(account, cumulativeAmount))) return 0;
        uint256 already = claimed[token][account];
        return cumulativeAmount > already ? cumulativeAmount - already : 0;
    }

    /// @notice Claim the outstanding (cumulative minus already claimed) amount for one token.
    function claim(address token, uint256 cumulativeAmount, bytes32[] calldata proof) public nonReentrant {
        require(
            MerkleProof.verify(proof, merkleRoot[token], _leaf(msg.sender, cumulativeAmount)),
            "Invalid proof"
        );
        uint256 already = claimed[token][msg.sender];
        require(cumulativeAmount > already, "Nothing to claim");
        uint256 payout = cumulativeAmount - already;

        claimed[token][msg.sender] = cumulativeAmount; // effects before interaction
        totalClaimed[token] += payout;

        IERC20(token).safeTransfer(msg.sender, payout);
        emit Claimed(token, msg.sender, payout);
    }

    /// @notice Claim across many tokens in one transaction ("claim all").
    function claimMany(
        address[] calldata tokens,
        uint256[] calldata cumulativeAmounts,
        bytes32[][] calldata proofs
    ) external {
        require(tokens.length == cumulativeAmounts.length && tokens.length == proofs.length, "Length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            claim(tokens[i], cumulativeAmounts[i], proofs[i]);
        }
    }
}
