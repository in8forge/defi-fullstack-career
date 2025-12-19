// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@aave/v3-core/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import "@aave/v3-core/contracts/interfaces/IPoolAddressesProvider.sol";

interface IVToken {
    function liquidateBorrow(address borrower, uint repayAmount, address vTokenCollateral) external returns (uint);
    function underlying() external view returns (address);
    function balanceOf(address owner) external view returns (uint);
    function redeem(uint redeemTokens) external returns (uint);
}

interface IERC20 {
    function transfer(address to, uint amount) external returns (bool);
    function approve(address spender, uint amount) external returns (bool);
    function balanceOf(address account) external view returns (uint);
}

interface IPancakeRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory);
}

contract BNBFlashLiquidator is FlashLoanSimpleReceiverBase {
    address public owner;
    address public constant PANCAKE_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address public constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    
    // Venus vTokens
    address public constant vUSDT = 0xfD5840Cd36d94D7229439859C0112a4185BC0255;
    address public constant vUSDC = 0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8;
    address public constant vBNB = 0xA07c5b74C9B40447a954e1466938b865b6BBea36;
    
    struct LiquidationParams {
        address vTokenBorrowed;
        address vTokenCollateral;
        address borrower;
        uint256 repayAmount;
    }
    
    constructor(address _addressProvider) 
        FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_addressProvider)) 
    {
        owner = msg.sender;
    }
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
    function executeLiquidation(
        address debtAsset,
        uint256 debtAmount,
        address vTokenBorrowed,
        address vTokenCollateral,
        address borrower
    ) external onlyOwner {
        bytes memory params = abi.encode(LiquidationParams({
            vTokenBorrowed: vTokenBorrowed,
            vTokenCollateral: vTokenCollateral,
            borrower: borrower,
            repayAmount: debtAmount
        }));
        
        // Request flash loan from Aave V3
        POOL.flashLoanSimple(
            address(this),
            debtAsset,
            debtAmount,
            params,
            0 // referral code
        );
    }
    
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Invalid caller");
        require(initiator == address(this), "Invalid initiator");
        
        LiquidationParams memory liqParams = abi.decode(params, (LiquidationParams));
        
        // 1. Approve vToken to spend debt asset
        IERC20(asset).approve(liqParams.vTokenBorrowed, amount);
        
        // 2. Execute Venus liquidation
        uint result = IVToken(liqParams.vTokenBorrowed).liquidateBorrow(
            liqParams.borrower,
            liqParams.repayAmount,
            liqParams.vTokenCollateral
        );
        require(result == 0, "Liquidation failed");
        
        // 3. Redeem seized vTokens
        uint vTokenBalance = IVToken(liqParams.vTokenCollateral).balanceOf(address(this));
        if (vTokenBalance > 0) {
            IVToken(liqParams.vTokenCollateral).redeem(vTokenBalance);
        }
        
        // 4. Get collateral underlying address
        address collateralUnderlying;
        if (liqParams.vTokenCollateral == vBNB) {
            collateralUnderlying = WBNB;
        } else {
            collateralUnderlying = IVToken(liqParams.vTokenCollateral).underlying();
        }
        
        // 5. Swap collateral to debt asset if different
        if (collateralUnderlying != asset) {
            uint collateralBalance = IERC20(collateralUnderlying).balanceOf(address(this));
            if (collateralBalance > 0) {
                _swap(collateralUnderlying, asset, collateralBalance);
            }
        }
        
        // 6. Approve repayment
        uint256 amountOwed = amount + premium;
        IERC20(asset).approve(address(POOL), amountOwed);
        
        return true;
    }
    
    function _swap(address tokenIn, address tokenOut, uint amountIn) internal {
        IERC20(tokenIn).approve(PANCAKE_ROUTER, amountIn);
        
        address[] memory path;
        if (tokenIn == WBNB || tokenOut == WBNB) {
            path = new address[](2);
            path[0] = tokenIn;
            path[1] = tokenOut;
        } else {
            path = new address[](3);
            path[0] = tokenIn;
            path[1] = WBNB;
            path[2] = tokenOut;
        }
        
        IPancakeRouter(PANCAKE_ROUTER).swapExactTokensForTokens(
            amountIn,
            0, // Accept any amount (add slippage protection in production)
            path,
            address(this),
            block.timestamp + 300
        );
    }
    
    // Withdraw profits
    function withdraw(address token) external onlyOwner {
        uint balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).transfer(owner, balance);
        }
    }
    
    function withdrawBNB() external onlyOwner {
        uint balance = address(this).balance;
        if (balance > 0) {
            payable(owner).transfer(balance);
        }
    }
    
    receive() external payable {}
}
