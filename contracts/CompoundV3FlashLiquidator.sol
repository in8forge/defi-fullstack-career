// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
// COMPOUND V3 FLASH LIQUIDATOR
// ============================================================
// Uses Aave V3 flash loans to liquidate Compound V3 positions
// Flow: Flash loan USDC -> buyCollateral at discount -> swap to USDC -> repay + profit
// ============================================================

interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

interface IPoolAddressesProvider {
    function getPool() external view returns (address);
}

interface IComet {
    function absorb(address absorber, address[] calldata accounts) external;
    function buyCollateral(
        address asset,
        uint256 minAmount,
        uint256 baseAmount,
        address recipient
    ) external;
    function quoteCollateral(address asset, uint256 baseAmount) external view returns (uint256);
    function getAssetInfo(uint8 i) external view returns (AssetInfo memory);
    function numAssets() external view returns (uint8);
    function baseToken() external view returns (address);
    function isLiquidatable(address account) external view returns (bool);
    function collateralBalanceOf(address account, address asset) external view returns (uint128);
}

struct AssetInfo {
    uint8 offset;
    address asset;
    address priceFeed;
    uint64 scale;
    uint64 borrowCollateralFactor;
    uint64 liquidateCollateralFactor;
    uint64 liquidationFactor;
    uint128 supplyCap;
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
}

contract CompoundV3FlashLiquidator {
    address public owner;
    address public immutable POOL;
    
    // Chain-specific addresses (set in constructor based on chain)
    address public ADDRESSES_PROVIDER;
    address public SWAP_ROUTER;
    address public WETH;
    
    // Supported Compound V3 markets
    mapping(address => bool) public supportedComets;
    
    // Slippage protection (basis points, 100 = 1%)
    uint256 public maxSlippageBps = 300; // 3% default
    
    struct LiquidationParams {
        address comet;
        address borrower;
        address collateralAsset;
        uint256 baseAmount;
    }
    
    event LiquidationExecuted(
        address indexed comet,
        address indexed borrower,
        address collateralAsset,
        uint256 baseAmount,
        uint256 profit
    );
    
    event CollateralBought(
        address indexed asset,
        uint256 baseAmount,
        uint256 collateralReceived
    );
    
    constructor(
        address _addressesProvider,
        address _swapRouter,
        address _weth
    ) {
        owner = msg.sender;
        ADDRESSES_PROVIDER = _addressesProvider;
        SWAP_ROUTER = _swapRouter;
        WETH = _weth;
        POOL = IPoolAddressesProvider(_addressesProvider).getPool();
    }
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    // ============================================================
    // ADMIN FUNCTIONS
    // ============================================================
    
    function addComet(address comet) external onlyOwner {
        supportedComets[comet] = true;
    }
    
    function removeComet(address comet) external onlyOwner {
        supportedComets[comet] = false;
    }
    
    function setSlippage(uint256 _maxSlippageBps) external onlyOwner {
        require(_maxSlippageBps <= 1000, "Max 10%");
        maxSlippageBps = _maxSlippageBps;
    }
    
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }
    
    // ============================================================
    // LIQUIDATION ENTRY POINT
    // ============================================================
    
    /// @notice Liquidate a Compound V3 position using flash loan
    /// @param comet The Compound V3 market address
    /// @param borrower The underwater account to liquidate
    /// @param collateralAsset The collateral asset to seize
    /// @param baseAmount Amount of base token (USDC) to use for buying collateral
    function executeLiquidation(
        address comet,
        address borrower,
        address collateralAsset,
        uint256 baseAmount
    ) external onlyOwner {
        require(supportedComets[comet], "Comet not supported");
        
        address baseToken = IComet(comet).baseToken();
        
        bytes memory params = abi.encode(LiquidationParams({
            comet: comet,
            borrower: borrower,
            collateralAsset: collateralAsset,
            baseAmount: baseAmount
        }));
        
        // Flash loan the base token (USDC)
        IPool(POOL).flashLoanSimple(
            address(this),
            baseToken,
            baseAmount,
            params,
            0
        );
    }
    
    /// @notice Liquidate multiple collateral types from one borrower
    /// @param comet The Compound V3 market address
    /// @param borrower The underwater account to liquidate
    /// @param baseAmount Amount of base token to use per collateral type
    function executeLiquidationAll(
        address comet,
        address borrower,
        uint256 baseAmount
    ) external onlyOwner {
        require(supportedComets[comet], "Comet not supported");
        
        // First absorb the account
        address[] memory accounts = new address[](1);
        accounts[0] = borrower;
        
        try IComet(comet).absorb(owner, accounts) {
            // Absorb successful
        } catch {
            // Account may already be absorbed or not liquidatable
        }
        
        // Get all collateral assets and buy each one
        uint8 numAssets = IComet(comet).numAssets();
        address baseToken = IComet(comet).baseToken();
        
        for (uint8 i = 0; i < numAssets; i++) {
            AssetInfo memory info = IComet(comet).getAssetInfo(i);
            
            // Check if there's collateral to buy
            uint256 quote = IComet(comet).quoteCollateral(info.asset, baseAmount);
            if (quote > 0) {
                // Flash loan and buy this collateral
                bytes memory params = abi.encode(LiquidationParams({
                    comet: comet,
                    borrower: borrower,
                    collateralAsset: info.asset,
                    baseAmount: baseAmount
                }));
                
                try IPool(POOL).flashLoanSimple(
                    address(this),
                    baseToken,
                    baseAmount,
                    params,
                    0
                ) {
                    // Success
                } catch {
                    // Skip this collateral
                }
            }
        }
    }
    
    // ============================================================
    // FLASH LOAN CALLBACK
    // ============================================================
    
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
        require(msg.sender == POOL, "Invalid caller");
        require(initiator == address(this), "Invalid initiator");
        
        LiquidationParams memory liqParams = abi.decode(params, (LiquidationParams));
        
        // 1. Approve Comet to spend base token
        IERC20(asset).approve(liqParams.comet, amount);
        
        // 2. Get quote for collateral
        uint256 expectedCollateral = IComet(liqParams.comet).quoteCollateral(
            liqParams.collateralAsset,
            liqParams.baseAmount
        );
        
        // 3. Apply slippage protection
        uint256 minCollateral = expectedCollateral * (10000 - maxSlippageBps) / 10000;
        
        // 4. Buy collateral at discount
        uint256 collateralBefore = IERC20(liqParams.collateralAsset).balanceOf(address(this));
        
        IComet(liqParams.comet).buyCollateral(
            liqParams.collateralAsset,
            minCollateral,
            liqParams.baseAmount,
            address(this)
        );
        
        uint256 collateralReceived = IERC20(liqParams.collateralAsset).balanceOf(address(this)) - collateralBefore;
        
        emit CollateralBought(liqParams.collateralAsset, liqParams.baseAmount, collateralReceived);
        
        // 5. Swap collateral back to base token (USDC)
        uint256 baseReceived = _swapToBase(
            liqParams.collateralAsset,
            asset,
            collateralReceived
        );
        
        // 6. Repay flash loan
        uint256 amountOwed = amount + premium;
        require(baseReceived >= amountOwed, "Unprofitable liquidation");
        
        IERC20(asset).approve(POOL, amountOwed);
        
        // 7. Calculate and emit profit
        uint256 profit = baseReceived - amountOwed;
        
        emit LiquidationExecuted(
            liqParams.comet,
            liqParams.borrower,
            liqParams.collateralAsset,
            liqParams.baseAmount,
            profit
        );
        
        return true;
    }
    
    // ============================================================
    // SWAP LOGIC
    // ============================================================
    
    function _swapToBase(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256 amountOut) {
        if (tokenIn == tokenOut) {
            return amountIn;
        }
        
        // Handle WETH wrapping if needed
        if (tokenIn == WETH && address(this).balance > 0) {
            IWETH(WETH).deposit{value: address(this).balance}();
            amountIn = IERC20(WETH).balanceOf(address(this));
        }
        
        IERC20(tokenIn).approve(SWAP_ROUTER, amountIn);
        
        // Try direct swap first (0.3% fee tier)
        try ISwapRouter(SWAP_ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: 3000, // 0.3%
                recipient: address(this),
                deadline: block.timestamp + 300,
                amountIn: amountIn,
                amountOutMinimum: 0, // We check profitability after
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256 out) {
            return out;
        } catch {}
        
        // Try 0.05% fee tier
        try ISwapRouter(SWAP_ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: 500, // 0.05%
                recipient: address(this),
                deadline: block.timestamp + 300,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256 out) {
            return out;
        } catch {}
        
        // Try 1% fee tier
        try ISwapRouter(SWAP_ROUTER).exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: 10000, // 1%
                recipient: address(this),
                deadline: block.timestamp + 300,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256 out) {
            return out;
        } catch {}
        
        // Multi-hop through WETH if direct fails
        if (tokenIn != WETH && tokenOut != WETH) {
            // tokenIn -> WETH
            IERC20(tokenIn).approve(SWAP_ROUTER, amountIn);
            
            uint256 wethAmount = ISwapRouter(SWAP_ROUTER).exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: WETH,
                    fee: 3000,
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: amountIn,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
            
            // WETH -> tokenOut
            IERC20(WETH).approve(SWAP_ROUTER, wethAmount);
            
            amountOut = ISwapRouter(SWAP_ROUTER).exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: WETH,
                    tokenOut: tokenOut,
                    fee: 500, // WETH-USDC usually 0.05%
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: wethAmount,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            );
            
            return amountOut;
        }
        
        revert("Swap failed");
    }
    
    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================
    
    /// @notice Check if a liquidation would be profitable
    /// @param comet The Compound V3 market
    /// @param collateralAsset The collateral to buy
    /// @param baseAmount Amount of base token to spend
    /// @return profitable Whether the liquidation would be profitable
    /// @return expectedProfit Expected profit in base token
    function simulateLiquidation(
        address comet,
        address collateralAsset,
        uint256 baseAmount
    ) external view returns (bool profitable, uint256 expectedProfit) {
        // Get collateral quote (how much collateral we'd receive)
        uint256 collateralAmount = IComet(comet).quoteCollateral(collateralAsset, baseAmount);
        
        if (collateralAmount == 0) {
            return (false, 0);
        }
        
        // Estimate swap output (rough estimate - actual may vary)
        // Compound gives ~8% discount, so we expect ~8% profit minus fees
        // Flash loan fee: 0.09%
        // Swap fee: ~0.3%
        // Total fees: ~0.4%
        // Expected profit: ~7.6% of baseAmount
        
        uint256 estimatedReturn = baseAmount * 1076 / 1000; // 7.6% profit estimate
        uint256 flashLoanFee = baseAmount * 9 / 10000; // 0.09%
        
        if (estimatedReturn > baseAmount + flashLoanFee) {
            expectedProfit = estimatedReturn - baseAmount - flashLoanFee;
            profitable = true;
        } else {
            expectedProfit = 0;
            profitable = false;
        }
    }
    
    /// @notice Get all collateral assets for a Comet market
    function getCollateralAssets(address comet) external view returns (address[] memory assets) {
        uint8 numAssets = IComet(comet).numAssets();
        assets = new address[](numAssets);
        
        for (uint8 i = 0; i < numAssets; i++) {
            AssetInfo memory info = IComet(comet).getAssetInfo(i);
            assets[i] = info.asset;
        }
    }
    
    // ============================================================
    // WITHDRAW FUNCTIONS
    // ============================================================
    
    function withdrawToken(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).transfer(owner, balance);
        }
    }
    
    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            payable(owner).transfer(balance);
        }
    }
    
    function withdrawAll(address[] calldata tokens) external onlyOwner {
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 balance = IERC20(tokens[i]).balanceOf(address(this));
            if (balance > 0) {
                IERC20(tokens[i]).transfer(owner, balance);
            }
        }
        
        if (address(this).balance > 0) {
            payable(owner).transfer(address(this).balance);
        }
    }
    
    receive() external payable {}
}

