// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// Minimal interfaces for the canonical Uniswap v3 deployment on Robinhood Chain
/// (factory + NonfungiblePositionManager), verified on-chain against chainId 4663:
///   factory 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA
///   NonfungiblePositionManager 0x73991a25c818bf1f1128deaab1492d45638de0d3
///   WETH9 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
/// Ported verbatim from the Primehod V3 launch (same chain, same contracts).

interface IUniswapV3FactoryMin {
    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3PoolMin {
    function initialize(uint160 sqrtPriceX96) external;
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}

interface IERC721Min {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface INonfungiblePositionManagerMin {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
}
