// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FlashLoanSimpleReceiverBase} from "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {IERC20} from "@aave/core-v3/contracts/dependencies/openzeppelin/contracts/IERC20.sol";

interface IUniswapV2Router {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}

contract FlashLoanExecutor is FlashLoanSimpleReceiverBase {
    address public owner;
    uint256 public maxFlashAmount;

    event FlashLoanExecuted(address indexed asset, uint256 amount, uint256 premium, int256 netPnl);
    event ArbitrageExecuted(uint256 amountIn, uint256 amountOut);

    constructor(address provider) FlashLoanSimpleReceiverBase(IPoolAddressesProvider(provider)) {
        owner = msg.sender;
        maxFlashAmount = 1_000_000e6;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function setMaxFlashAmount(uint256 newMax) external onlyOwner {
        maxFlashAmount = newMax;
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Caller not Pool");
        require(amount <= maxFlashAmount, "Amount exceeds max");

        (address r1, address r2, address[] memory p1, address[] memory p2) = 
            abi.decode(params, (address, address, address[], address[]));

        uint256 finalAmount = _executeArbitrage(asset, amount, r1, r2, p1, p2);

        uint256 owed = amount + premium;
        require(IERC20(asset).balanceOf(address(this)) >= owed, "Insufficient balance");

        IERC20(asset).approve(address(POOL), owed);

        emit FlashLoanExecuted(asset, amount, premium, int256(finalAmount) - int256(amount));
        emit ArbitrageExecuted(amount, finalAmount);

        return true;
    }

    function requestFlashLoan(
        address asset,
        uint256 amount,
        address router1,
        address router2,
        address[] calldata path1,
        address[] calldata path2
    ) external onlyOwner {
        require(amount <= maxFlashAmount, "Amount exceeds max");
        require(path1[0] == asset && path2[path2.length - 1] == asset, "Invalid paths");

        bytes memory params = abi.encode(router1, router2, path1, path2);
        POOL.flashLoanSimple(address(this), asset, amount, params, 0);
    }

    function _executeArbitrage(
        address asset,
        uint256 amount,
        address r1,
        address r2,
        address[] memory p1,
        address[] memory p2
    ) internal returns (uint256) {
        IERC20(asset).approve(r1, amount);

        uint[] memory a1 = IUniswapV2Router(r1).swapExactTokensForTokens(
            amount,
            0,
            p1,
            address(this),
            block.timestamp + 300
        );

        uint256 intermediate = a1[a1.length - 1];
        IERC20(p1[p1.length - 1]).approve(r2, intermediate);

        uint[] memory a2 = IUniswapV2Router(r2).swapExactTokensForTokens(
            intermediate,
            0,
            p2,
            address(this),
            block.timestamp + 300
        );

        return a2[a2.length - 1];
    }

    function withdrawToken(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount);
    }

    receive() external payable {}
}
