// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Aave V3 Interfaces
interface IPool {
    function flashLoanSimple(
        address receiverAddress,
        address asset,
        uint256 amount,
        bytes calldata params,
        uint16 referralCode
    ) external;
    
    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external;
}

interface IPoolAddressesProvider {
    function getPool() external view returns (address);
}

// Uniswap V3 Router
interface ISwapRouterV3 {
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

// Uniswap V2 / Sushiswap Router
interface ISwapRouterV2 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
    
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
}

// Curve Pool
interface ICurvePool {
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external returns (uint256);
    function get_dy(int128 i, int128 j, uint256 dx) external view returns (uint256);
}

contract FlashLiquidatorV2 {
    address public owner;
    IPool public immutable POOL;
    
    address public WETH;
    address public USDC;
    
    // DEX Routers
    address public uniswapV3Router;
    address public sushiswapRouter;
    address public curvePool;
    
    // Slippage protection (basis points, 100 = 1%)
    uint256 public maxSlippageBps = 100; // Default 1%
    
    // ETH derivative tokens
    mapping(address => bool) public isEthDerivative;
    mapping(address => address) public derivativeUnderlying;
    
    struct LiquidationParams {
        address collateralAsset;
        address debtAsset;
        address user;
        uint256 debtToCover;
        uint256 minProfit;
    }
    
    LiquidationParams private liquidationParams;
    
    event LiquidationExecuted(
        address indexed user,
        address collateralAsset,
        address debtAsset,
        uint256 debtCovered,
        uint256 collateralReceived,
        uint256 profit,
        string dexUsed
    );
    
    event ProfitWithdrawn(address token, uint256 amount);
    event SlippageUpdated(uint256 newSlippageBps);
    event DexUpdated(string dex, address router);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    constructor(
        address _poolProvider,
        address _uniswapV3Router,
        address _weth,
        address _usdc
    ) {
        owner = msg.sender;
        POOL = IPool(IPoolAddressesProvider(_poolProvider).getPool());
        uniswapV3Router = _uniswapV3Router;
        WETH = _weth;
        USDC = _usdc;
    }
    
    // ============================================================
    // CONFIGURATION
    // ============================================================
    
    function setSlippage(uint256 _maxSlippageBps) external onlyOwner {
        require(_maxSlippageBps <= 1000, "Max 10% slippage");
        maxSlippageBps = _maxSlippageBps;
        emit SlippageUpdated(_maxSlippageBps);
    }
    
    function setDexRouters(
        address _uniswapV3,
        address _sushiswap,
        address _curve
    ) external onlyOwner {
        if (_uniswapV3 != address(0)) {
            uniswapV3Router = _uniswapV3;
            emit DexUpdated("UniswapV3", _uniswapV3);
        }
        if (_sushiswap != address(0)) {
            sushiswapRouter = _sushiswap;
            emit DexUpdated("Sushiswap", _sushiswap);
        }
        if (_curve != address(0)) {
            curvePool = _curve;
            emit DexUpdated("Curve", _curve);
        }
    }
    
    function setEthDerivative(address token, bool isDerivative, address underlying) external onlyOwner {
        isEthDerivative[token] = isDerivative;
        derivativeUnderlying[token] = underlying;
    }
    
    function setTokens(address _weth, address _usdc) external onlyOwner {
        WETH = _weth;
        USDC = _usdc;
    }
    
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid owner");
        owner = newOwner;
    }
    
    // ============================================================
    // MAIN LIQUIDATION FUNCTION
    // ============================================================
    
    function executeLiquidation(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        uint256 minProfit
    ) external onlyOwner {
        liquidationParams = LiquidationParams({
            collateralAsset: collateralAsset,
            debtAsset: debtAsset,
            user: user,
            debtToCover: debtToCover,
            minProfit: minProfit
        });
        
        POOL.flashLoanSimple(address(this), debtAsset, debtToCover, "", 0);
    }
    
    // Legacy function for compatibility
    function executeLiquidation(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover
    ) external onlyOwner {
        liquidationParams = LiquidationParams({
            collateralAsset: collateralAsset,
            debtAsset: debtAsset,
            user: user,
            debtToCover: debtToCover,
            minProfit: 0
        });
        
        POOL.flashLoanSimple(address(this), debtAsset, debtToCover, "", 0);
    }
    
    // ============================================================
    // FLASH LOAN CALLBACK
    // ============================================================
    
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata
    ) external returns (bool) {
        require(msg.sender == address(POOL), "Caller must be pool");
        require(initiator == address(this), "Invalid initiator");
        
        LiquidationParams memory lp = liquidationParams;
        
        // 1. Approve debt asset for liquidation
        IERC20(asset).approve(address(POOL), amount);
        
        // 2. Get collateral balance before
        uint256 colBefore = IERC20(lp.collateralAsset).balanceOf(address(this));
        
        // 3. Execute liquidation
        POOL.liquidationCall(
            lp.collateralAsset,
            lp.debtAsset,
            lp.user,
            lp.debtToCover,
            false
        );
        
        // 4. Calculate collateral received
        uint256 colReceived = IERC20(lp.collateralAsset).balanceOf(address(this)) - colBefore;
        require(colReceived > 0, "No collateral received");
        
        // 5. Calculate amount owed (flash loan + premium)
        uint256 amountOwed = amount + premium;
        
        // 6. Calculate minimum output with slippage protection
        uint256 minOutput = amountOwed * (10000 + maxSlippageBps) / 10000;
        
        // 7. Convert collateral to debt asset using best DEX
        string memory dexUsed = "none";
        if (lp.collateralAsset != lp.debtAsset) {
            dexUsed = _swapWithBestDex(lp.collateralAsset, lp.debtAsset, colReceived, amountOwed);
        }
        
        // 8. Approve repayment
        IERC20(asset).approve(address(POOL), amountOwed);
        
        // 9. Calculate and verify profit
        uint256 finalBalance = IERC20(asset).balanceOf(address(this));
        require(finalBalance >= amountOwed, "Insufficient balance to repay");
        
        uint256 profit = finalBalance - amountOwed;
        require(profit >= lp.minProfit, "Below minimum profit");
        
        emit LiquidationExecuted(
            lp.user,
            lp.collateralAsset,
            lp.debtAsset,
            lp.debtToCover,
            colReceived,
            profit,
            dexUsed
        );
        
        return true;
    }
    
    // ============================================================
    // MULTI-DEX SWAP LOGIC
    // ============================================================
    
    function _swapWithBestDex(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal returns (string memory dexUsed) {
        
        // Get quotes from all DEXs
        uint256 uniV3Quote = _getUniswapV3Quote(tokenIn, tokenOut, amountIn);
        uint256 sushiQuote = _getSushiswapQuote(tokenIn, tokenOut, amountIn);
        
        // Find best quote
        uint256 bestQuote = uniV3Quote;
        uint8 bestDex = 1; // 1 = UniV3, 2 = Sushi, 3 = Curve
        
        if (sushiQuote > bestQuote) {
            bestQuote = sushiQuote;
            bestDex = 2;
        }
        
        // Apply slippage protection
        uint256 minWithSlippage = minAmountOut * (10000 - maxSlippageBps) / 10000;
        require(bestQuote >= minWithSlippage, "All DEX quotes below minimum");
        
        // Execute swap on best DEX
        if (bestDex == 1) {
            _swapUniswapV3(tokenIn, tokenOut, amountIn, minWithSlippage);
            return "UniswapV3";
        } else if (bestDex == 2) {
            _swapSushiswap(tokenIn, tokenOut, amountIn, minWithSlippage);
            return "Sushiswap";
        }
        
        // Fallback: try multi-hop through WETH
        if (tokenIn != WETH && tokenOut != WETH) {
            _swapViaWeth(tokenIn, tokenOut, amountIn, minWithSlippage);
            return "MultiHop";
        }
        
        revert("All swaps failed");
    }
    
    // ============================================================
    // DEX QUOTE FUNCTIONS
    // ============================================================
    
    function _getUniswapV3Quote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal returns (uint256) {
        if (uniswapV3Router == address(0)) return 0;
        
        // Try swap with 0 minOut to get quote (will revert if no liquidity)
        uint24[3] memory fees = [uint24(500), uint24(3000), uint24(10000)];
        
        for (uint i = 0; i < fees.length; i++) {
            try ISwapRouterV3(uniswapV3Router).exactInputSingle(
                ISwapRouterV3.ExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    fee: fees[i],
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: 0, // Quote only
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            ) returns (uint256 quote) {
                // Scale up from 0 input
                if (quote > 0) return quote * amountIn;
            } catch {}
        }
        
        return 0;
    }
    
    function _getSushiswapQuote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) internal view returns (uint256) {
        if (sushiswapRouter == address(0)) return 0;
        
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        
        try ISwapRouterV2(sushiswapRouter).getAmountsOut(amountIn, path) returns (uint256[] memory amounts) {
            return amounts[1];
        } catch {}
        
        // Try via WETH
        if (tokenIn != WETH && tokenOut != WETH) {
            address[] memory pathViaWeth = new address[](3);
            pathViaWeth[0] = tokenIn;
            pathViaWeth[1] = WETH;
            pathViaWeth[2] = tokenOut;
            
            try ISwapRouterV2(sushiswapRouter).getAmountsOut(amountIn, pathViaWeth) returns (uint256[] memory amounts) {
                return amounts[2];
            } catch {}
        }
        
        return 0;
    }
    
    // ============================================================
    // DEX SWAP EXECUTION
    // ============================================================
    
    function _swapUniswapV3(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal returns (uint256) {
        IERC20(tokenIn).approve(uniswapV3Router, amountIn);
        
        uint24[3] memory fees = [uint24(500), uint24(3000), uint24(10000)];
        
        for (uint i = 0; i < fees.length; i++) {
            try ISwapRouterV3(uniswapV3Router).exactInputSingle(
                ISwapRouterV3.ExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: tokenOut,
                    fee: fees[i],
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: amountIn,
                    amountOutMinimum: minAmountOut,
                    sqrtPriceLimitX96: 0
                })
            ) returns (uint256 amountOut) {
                return amountOut;
            } catch {
                continue;
            }
        }
        
        revert("UniswapV3 swap failed");
    }
    
    function _swapSushiswap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal returns (uint256) {
        IERC20(tokenIn).approve(sushiswapRouter, amountIn);
        
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;
        
        try ISwapRouterV2(sushiswapRouter).swapExactTokensForTokens(
            amountIn,
            minAmountOut,
            path,
            address(this),
            block.timestamp + 300
        ) returns (uint256[] memory amounts) {
            return amounts[1];
        } catch {}
        
        // Try via WETH
        if (tokenIn != WETH && tokenOut != WETH) {
            address[] memory pathViaWeth = new address[](3);
            pathViaWeth[0] = tokenIn;
            pathViaWeth[1] = WETH;
            pathViaWeth[2] = tokenOut;
            
            uint256[] memory amounts = ISwapRouterV2(sushiswapRouter).swapExactTokensForTokens(
                amountIn,
                minAmountOut,
                pathViaWeth,
                address(this),
                block.timestamp + 300
            );
            return amounts[2];
        }
        
        revert("Sushiswap swap failed");
    }
    
    function _swapViaWeth(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal {
        // First swap: tokenIn -> WETH on UniswapV3
        IERC20(tokenIn).approve(uniswapV3Router, amountIn);
        
        uint256 wethReceived;
        uint24[3] memory fees = [uint24(500), uint24(3000), uint24(10000)];
        bool firstSwapDone = false;
        
        for (uint i = 0; i < fees.length && !firstSwapDone; i++) {
            try ISwapRouterV3(uniswapV3Router).exactInputSingle(
                ISwapRouterV3.ExactInputSingleParams({
                    tokenIn: tokenIn,
                    tokenOut: WETH,
                    fee: fees[i],
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: amountIn,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                })
            ) returns (uint256 out) {
                wethReceived = out;
                firstSwapDone = true;
            } catch {
                continue;
            }
        }
        
        require(firstSwapDone, "First hop failed");
        
        // Second swap: WETH -> tokenOut
        IERC20(WETH).approve(uniswapV3Router, wethReceived);
        
        bool secondSwapDone = false;
        for (uint i = 0; i < fees.length && !secondSwapDone; i++) {
            try ISwapRouterV3(uniswapV3Router).exactInputSingle(
                ISwapRouterV3.ExactInputSingleParams({
                    tokenIn: WETH,
                    tokenOut: tokenOut,
                    fee: fees[i],
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: wethReceived,
                    amountOutMinimum: minAmountOut,
                    sqrtPriceLimitX96: 0
                })
            ) returns (uint256) {
                secondSwapDone = true;
            } catch {
                continue;
            }
        }
        
        require(secondSwapDone, "Second hop failed");
    }
    
    // ============================================================
    // PROFIT WITHDRAWAL
    // ============================================================
    
    function withdrawProfit(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) {
            IERC20(token).transfer(owner, bal);
            emit ProfitWithdrawn(token, bal);
        }
    }
    
    function withdrawAllProfits(address[] calldata tokens) external onlyOwner {
        for (uint i = 0; i < tokens.length; i++) {
            uint256 bal = IERC20(tokens[i]).balanceOf(address(this));
            if (bal > 0) {
                IERC20(tokens[i]).transfer(owner, bal);
                emit ProfitWithdrawn(tokens[i], bal);
            }
        }
    }
    
    function withdrawETH() external onlyOwner {
        uint256 bal = address(this).balance;
        if (bal > 0) {
            payable(owner).transfer(bal);
        }
    }
    
    // ============================================================
    // VIEW FUNCTIONS
    // ============================================================
    
    function getSlippage() external view returns (uint256) {
        return maxSlippageBps;
    }
    
    function getDexRouters() external view returns (address, address, address) {
        return (uniswapV3Router, sushiswapRouter, curvePool);
    }
    
    receive() external payable {}
}
