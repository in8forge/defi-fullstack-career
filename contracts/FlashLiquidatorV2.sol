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

// ETH Derivative interfaces
interface IWeETH {
    function unwrap(uint256 amount) external returns (uint256);
}

interface IWstETH {
    function unwrap(uint256 amount) external returns (uint256);
}

contract FlashLiquidatorV2 {
    address public owner;
    IPool public immutable POOL;
    ISwapRouter public immutable swapRouter;
    
    address public WETH;
    address public USDC;
    
    // ETH derivative tokens
    mapping(address => bool) public isEthDerivative;
    mapping(address => address) public derivativeUnderlying; // derivative => underlying (e.g., weETH => eETH)
    
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
        uint256 profit
    );
    
    event ProfitWithdrawn(address token, uint256 amount);
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    constructor(
        address _poolProvider,
        address _swapRouter,
        address _weth,
        address _usdc
    ) {
        owner = msg.sender;
        POOL = IPool(IPoolAddressesProvider(_poolProvider).getPool());
        swapRouter = ISwapRouter(_swapRouter);
        WETH = _weth;
        USDC = _usdc;
    }
    
    // ============================================================
    // CONFIGURATION
    // ============================================================
    
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
    
    // Legacy function for compatibility with existing bot
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
            false // receive underlying, not aToken
        );
        
        // 4. Calculate collateral received
        uint256 colReceived = IERC20(lp.collateralAsset).balanceOf(address(this)) - colBefore;
        require(colReceived > 0, "No collateral received");
        
        // 5. Calculate amount owed (flash loan + premium)
        uint256 amountOwed = amount + premium;
        
        // 6. Convert collateral to debt asset if needed
        if (lp.collateralAsset != lp.debtAsset) {
            _swapCollateralToDebt(lp.collateralAsset, lp.debtAsset, colReceived, amountOwed);
        }
        
        // 7. Approve repayment
        IERC20(asset).approve(address(POOL), amountOwed);
        
        // 8. Calculate and verify profit
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
            profit
        );
        
        return true;
    }
    
    // ============================================================
    // SMART SWAP LOGIC
    // ============================================================
    
    function _swapCollateralToDebt(
        address collateral,
        address debt,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal {
        uint256 amountToSwap = amountIn;
        address tokenToSwap = collateral;
        
        // Step 1: If ETH derivative, try to unwrap first
        if (isEthDerivative[collateral]) {
            tokenToSwap = _tryUnwrapDerivative(collateral, amountIn);
            if (tokenToSwap != collateral) {
                amountToSwap = IERC20(tokenToSwap).balanceOf(address(this));
            }
            
            // If debt is WETH and we unwrapped to WETH-like, we might be done
            if (tokenToSwap == debt) {
                return;
            }
        }
        
        // Step 2: Try direct V3 swap with multiple fee tiers
        IERC20(tokenToSwap).approve(address(swapRouter), amountToSwap);
        
        uint24[3] memory fees = [uint24(500), uint24(3000), uint24(10000)];
        
        for (uint i = 0; i < fees.length; i++) {
            try swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
                    tokenIn: tokenToSwap,
                    tokenOut: debt,
                    fee: fees[i],
                    recipient: address(this),
                    deadline: block.timestamp + 300,
                    amountIn: amountToSwap,
                    amountOutMinimum: minAmountOut,
                    sqrtPriceLimitX96: 0
                })
            ) returns (uint256) {
                return; // Success
            } catch {
                continue;
            }
        }
        
        // Step 3: Try multi-hop through WETH
        if (tokenToSwap != WETH && debt != WETH) {
            _swapViaWeth(tokenToSwap, debt, amountToSwap, minAmountOut);
            return;
        }
        
        revert("All swaps failed");
    }
    
    function _tryUnwrapDerivative(address derivative, uint256 amount) internal returns (address) {
        // Try weETH unwrap (Base: 0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A)
        if (derivative == 0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A) {
            try IWeETH(derivative).unwrap(amount) returns (uint256) {
                // weETH unwraps to eETH, which we then need to swap
                return derivativeUnderlying[derivative];
            } catch {
                return derivative; // Unwrap failed, swap derivative directly
            }
        }
        
        // Try wstETH unwrap (Base: 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452)
        if (derivative == 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452) {
            try IWstETH(derivative).unwrap(amount) returns (uint256) {
                return derivativeUnderlying[derivative];
            } catch {
                return derivative;
            }
        }
        
        // cbETH and others - just swap directly, no unwrap needed
        return derivative;
    }
    
    function _swapViaWeth(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) internal {
        // First swap: tokenIn -> WETH
        IERC20(tokenIn).approve(address(swapRouter), amountIn);
        
        uint256 wethReceived;
        uint24[3] memory fees = [uint24(500), uint24(3000), uint24(10000)];
        bool firstSwapDone = false;
        
        for (uint i = 0; i < fees.length && !firstSwapDone; i++) {
            try swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
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
        IERC20(WETH).approve(address(swapRouter), wethReceived);
        
        bool secondSwapDone = false;
        for (uint i = 0; i < fees.length && !secondSwapDone; i++) {
            try swapRouter.exactInputSingle(
                ISwapRouter.ExactInputSingleParams({
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
    
    function estimateProfit(
        uint256 collateralValue,
        uint256 debtValue,
        uint256 liquidationBonus // e.g., 500 = 5%
    ) external pure returns (uint256) {
        // Rough estimate: bonus - flash loan fee (0.09%)
        uint256 bonus = collateralValue * liquidationBonus / 10000;
        uint256 flashFee = debtValue * 9 / 10000;
        return bonus > flashFee ? bonus - flashFee : 0;
    }
    
    receive() external payable {}
}
