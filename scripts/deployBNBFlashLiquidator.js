import 'dotenv/config';
import { ethers } from 'ethers';
import fs from 'fs';

// BNB Chain Aave V3 Addresses
const AAVE_POOL_PROVIDER = '0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D';
const PANCAKE_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

// Simplified contract bytecode (we'll compile properly)
const CONTRACT_SOURCE = `
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
    function transferFrom(address from, address to, uint amount) external returns (bool);
}

interface IPancakeRouter {
    function swapExactTokensForTokens(
        uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline
    ) external returns (uint[] memory);
}

contract BNBFlashLiquidator {
    address public owner;
    address public immutable POOL;
    address public constant ADDRESSES_PROVIDER = 0xff75B6da14FfbbfD355Daf7a2731456b3562Ba6D;
    address public constant PANCAKE_ROUTER = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
    address public constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    
    // Venus vTokens
    address public constant vBNB = 0xA07c5b74C9B40447a954e1466938b865b6BBea36;
    
    struct LiquidationParams {
        address vTokenBorrowed;
        address vTokenCollateral;
        address borrower;
        uint256 repayAmount;
    }
    
    constructor() {
        owner = msg.sender;
        POOL = IPoolAddressesProvider(ADDRESSES_PROVIDER).getPool();
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
        
        IPool(POOL).flashLoanSimple(
            address(this),
            debtAsset,
            debtAmount,
            params,
            0
        );
    }
    
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
        
        // Approve and liquidate
        IERC20(asset).approve(liqParams.vTokenBorrowed, amount);
        
        uint result = IVToken(liqParams.vTokenBorrowed).liquidateBorrow(
            liqParams.borrower,
            liqParams.repayAmount,
            liqParams.vTokenCollateral
        );
        require(result == 0, "Liquidation failed");
        
        // Redeem vTokens
        uint vTokenBalance = IVToken(liqParams.vTokenCollateral).balanceOf(address(this));
        if (vTokenBalance > 0) {
            IVToken(liqParams.vTokenCollateral).redeem(vTokenBalance);
        }
        
        // Get collateral address
        address collateralUnderlying;
        if (liqParams.vTokenCollateral == vBNB) {
            collateralUnderlying = WBNB;
        } else {
            collateralUnderlying = IVToken(liqParams.vTokenCollateral).underlying();
        }
        
        // Swap if needed
        if (collateralUnderlying != asset) {
            uint collateralBalance = IERC20(collateralUnderlying).balanceOf(address(this));
            if (collateralBalance > 0) {
                IERC20(collateralUnderlying).approve(PANCAKE_ROUTER, collateralBalance);
                
                address[] memory path = new address[](3);
                path[0] = collateralUnderlying;
                path[1] = WBNB;
                path[2] = asset;
                
                IPancakeRouter(PANCAKE_ROUTER).swapExactTokensForTokens(
                    collateralBalance, 0, path, address(this), block.timestamp + 300
                );
            }
        }
        
        // Repay flash loan
        uint256 amountOwed = amount + premium;
        IERC20(asset).approve(POOL, amountOwed);
        
        return true;
    }
    
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
`;

async function deploy() {
    console.log('\\n🚀 Deploying BNB Flash Liquidator...\\n');
    
    const provider = new ethers.JsonRpcProvider('https://bsc-dataseed.binance.org');
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    const balance = await provider.getBalance(wallet.address);
    console.log(`Wallet: ${wallet.address}`);
    console.log(`Balance: ${ethers.formatEther(balance)} BNB\\n`);
    
    if (balance < ethers.parseEther('0.03')) {
        console.log('❌ Need at least 0.03 BNB for deployment');
        return;
    }
    
    // Save source for reference
    fs.writeFileSync('contracts/BNBFlashLiquidator.sol', CONTRACT_SOURCE);
    console.log('📄 Contract source saved\\n');
    
    console.log('To deploy with Hardhat:');
    console.log('  npx hardhat compile');
    console.log('  npx hardhat run scripts/deployBNBFlashLiquidator.js --network bnb');
    console.log('');
    console.log('Or use Remix:');
    console.log('  1. Copy contracts/BNBFlashLiquidator.sol to Remix');
    console.log('  2. Compile with Solidity 0.8.20');
    console.log('  3. Deploy to BNB Chain');
}

deploy().catch(console.error);
