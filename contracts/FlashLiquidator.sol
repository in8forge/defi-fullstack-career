// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// Aave V3 Interfaces (inline to avoid dependency issues)
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

interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

interface ISwapRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract FlashLiquidator is IFlashLoanSimpleReceiver {
    address public owner;
    IPool public immutable POOL;
    ISwapRouter public swapRouter;
    
    struct LiquidationParams {
        address collateralAsset;
        address debtAsset;
        address user;
        uint256 debtToCover;
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
    
    constructor(address _poolProvider, address _swapRouter) {
        owner = msg.sender;
        POOL = IPool(IPoolAddressesProvider(_poolProvider).getPool());
        swapRouter = ISwapRouter(_swapRouter);
    }
    
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }
    
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
            debtToCover: debtToCover
        });
        
        POOL.flashLoanSimple(
            address(this),
            debtAsset,
            debtToCover,
            "",
            0
        );
    }
    
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Caller must be pool");
        require(initiator == address(this), "Invalid initiator");
        
        LiquidationParams memory lp = liquidationParams;
        
        // Approve and liquidate
        IERC20(asset).approve(address(POOL), amount);
        
        uint256 colBefore = IERC20(lp.collateralAsset).balanceOf(address(this));
        
        POOL.liquidationCall(
            lp.collateralAsset,
            lp.debtAsset,
            lp.user,
            lp.debtToCover,
            false
        );
        
        uint256 colReceived = IERC20(lp.collateralAsset).balanceOf(address(this)) - colBefore;
        
        // Swap collateral to repay flash loan
        uint256 amountOwed = amount + premium;
        
        if (lp.collateralAsset != lp.debtAsset) {
            IERC20(lp.collateralAsset).approve(address(swapRouter), colReceived);
            
            address[] memory path = new address[](2);
            path[0] = lp.collateralAsset;
            path[1] = lp.debtAsset;
            
            swapRouter.swapExactTokensForTokens(
                colReceived,
                amountOwed,
                path,
                address(this),
                block.timestamp + 300
            );
        }
        
        // Approve repayment
        IERC20(asset).approve(address(POOL), amountOwed);
        
        uint256 profit = IERC20(asset).balanceOf(address(this)) - amountOwed;
        
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
    
    function withdrawProfit(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) IERC20(token).transfer(owner, bal);
    }
    
    function withdrawETH() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }
    
    receive() external payable {}
}
