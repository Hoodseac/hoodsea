// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {INonfungiblePositionManagerMin, IERC721Min} from "../UniV3Interfaces.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @dev Test mock of the Uniswap v3 NonfungiblePositionManager. mint actually pulls
 *      the requested token side via transferFrom (so approval + single-sidedness are
 *      verified) and tracks ownerOf so the locker's lock() ownership check passes.
 *      collect pays pre-loaded fees to the recipient (the locker) so the fee-split
 *      path can be exercised. `useFraction` lets a test leave rounding dust.
 */
contract MockNonfungiblePositionManager is INonfungiblePositionManagerMin, IERC721Min {
    bool public minted;
    address public mintToken0;
    address public mintToken1;
    int24 public mintTickLower;
    int24 public mintTickUpper;
    uint256 public mintAmount0; // amount actually used (pulled)
    uint256 public mintAmount1;
    address public mintRecipient;
    uint256 public lastTokenId;
    uint256 public nextTokenId = 1;
    mapping(uint256 => address) public ownerOf; // IERC721Min

    // Fees made available for the next collect() (token0-, token1-denominated).
    uint256 public feesToken0;
    uint256 public feesToken1;
    uint256 public collectCount;

    // Fraction (of 10000) of each desired amount the position actually takes; the
    // remainder is left with the caller as rounding dust. 10000 = take everything.
    uint256 public useFraction = 10000;

    bool public revertOnMint;

    function setRevertOnMint(bool v) external { revertOnMint = v; }
    function setUseFraction(uint256 bps) external { useFraction = bps; }
    function setFees(uint256 f0, uint256 f1) external { feesToken0 = f0; feesToken1 = f1; }

    function mint(MintParams calldata p)
        external
        payable
        override
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        require(!revertOnMint, "mock mint revert");
        uint256 use0 = (p.amount0Desired * useFraction) / 10000;
        uint256 use1 = (p.amount1Desired * useFraction) / 10000;
        // Pull only what the position uses; the rest stays with the caller as dust.
        if (use0 > 0) IERC20(p.token0).transferFrom(msg.sender, address(this), use0);
        if (use1 > 0) IERC20(p.token1).transferFrom(msg.sender, address(this), use1);
        minted = true;
        mintToken0 = p.token0;
        mintToken1 = p.token1;
        mintTickLower = p.tickLower;
        mintTickUpper = p.tickUpper;
        mintAmount0 = use0;
        mintAmount1 = use1;
        mintRecipient = p.recipient;
        tokenId = nextTokenId++;
        lastTokenId = tokenId;
        ownerOf[tokenId] = p.recipient;
        liquidity = uint128(use0 + use1);
        amount0 = use0;
        amount1 = use1;
    }

    function collect(CollectParams calldata p)
        external
        payable
        override
        returns (uint256 amount0, uint256 amount1)
    {
        collectCount++;
        amount0 = feesToken0;
        amount1 = feesToken1;
        // Pay the accrued fees to the recipient (the locker). Fees must have been
        // pre-loaded here by the test (mirrors the pool paying out tokensOwed0/1).
        if (amount0 > 0) IERC20(mintToken0).transfer(p.recipient, amount0);
        if (amount1 > 0) IERC20(mintToken1).transfer(p.recipient, amount1);
        feesToken0 = 0;
        feesToken1 = 0;
    }
}
