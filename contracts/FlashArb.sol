// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniswapV2 {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract FlashArb {
    address public owner;
    IPool public aavePool;
    address public uniswap;
    address public sushi;

    constructor(address _pool, address _uni, address _sushi) {
        owner = msg.sender;
        aavePool = IPool(_pool);
        uniswap = _uni;
        sushi = _sushi;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    // Skeleton flash-loan request (no strategy inside yet)
    function executeFlashLoan(address asset, uint amount) external onlyOwner {
        address receiver = address(this);
        bytes memory params = "";

        aavePool.flashLoanSimple(
            receiver,
            asset,
            amount,
            params,
            0 // referralCode
        );
    }

    // Called back by Aave during the flash loan
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address /*initiator*/,
        bytes calldata /*params*/
    ) external returns (bool) {
        uint256 amountOwing = amount + premium;

        // In a real strategy you would do arb here (Uni/Sushi, Curve, etc)
        // For now, just approve payback so the loan succeeds.
        IERC20(asset).approve(address(aavePool), amountOwing);

        return true;
    }
}

