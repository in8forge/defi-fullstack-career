// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FlashLoanSimpleReceiverBase} from "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {IERC20} from "@aave/core-v3/contracts/dependencies/openzeppelin/contracts/IERC20.sol";

contract FlashLoanExecutor is FlashLoanSimpleReceiverBase {
    address public owner;
    uint256 public maxFlashAmount;

    event FlashLoanRequested(address indexed asset, uint256 amount);
    event FlashLoanExecuted(address indexed asset, uint256 amount, uint256 premium, int256 pnl);
    event MockCycleStarted(address indexed asset, uint256 amount);
    event MockCycleCompleted(address indexed asset, uint256 amount, int256 pnl);

    constructor(address provider)
        FlashLoanSimpleReceiverBase(IPoolAddressesProvider(provider))
    {
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
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        initiator;
        params;

        require(amount > 0, "amount=0");
        require(amount <= maxFlashAmount, "amount>maxFlashAmount");

        uint256 beforeBal = IERC20(asset).balanceOf(address(this));

        int256 pnl = _strategy(asset, amount);

        uint256 totalOwed = amount + premium;
        uint256 afterBal = IERC20(asset).balanceOf(address(this));
        require(afterBal >= totalOwed, "insufficient funds to repay");

        IERC20(asset).approve(address(POOL), totalOwed);

        emit FlashLoanExecuted(asset, amount, premium, pnl);
        return true;
    }

    function requestFlashLoan(address asset, uint256 amount, bytes calldata params) external onlyOwner {
        require(amount > 0, "amount=0");
        require(amount <= maxFlashAmount, "amount>maxFlashAmount");

        emit FlashLoanRequested(asset, amount);

        POOL.flashLoanSimple(address(this), asset, amount, params, 0);
    }

    function testMockCycle(address asset, uint256 amount) external onlyOwner {
        require(amount > 0, "amount=0");

        uint256 beforeOwner = IERC20(asset).balanceOf(owner);
        uint256 beforeExec = IERC20(asset).balanceOf(address(this));

        emit MockCycleStarted(asset, amount);

        IERC20(asset).transferFrom(owner, address(this), amount);

        int256 pnl = _strategy(asset, amount);

        IERC20(asset).transfer(owner, amount);

        uint256 afterOwner = IERC20(asset).balanceOf(owner);
        uint256 afterExec = IERC20(asset).balanceOf(address(this));

        int256 execDelta = int256(afterExec) - int256(beforeExec);

        emit MockCycleCompleted(asset, amount, execDelta);
    }

    function _strategy(address asset, uint256 amount) internal returns (int256 pnl) {
        asset;
        amount;
        return 0; // neutral strategy placeholder
    }
}
