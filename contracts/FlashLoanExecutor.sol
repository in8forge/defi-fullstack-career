// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FlashLoanSimpleReceiverBase} from "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {IERC20} from "@aave/core-v3/contracts/dependencies/openzeppelin/contracts/IERC20.sol";

/**
 * @title FlashLoanExecutor
 * @notice Aave V3 flash-loan executor with a parametric strategy hook.
 *
 * params encoding (non-empty):
 *   abi.encode(address router, address tokenIn, address tokenOut, uint256 minOutBps)
 */
contract FlashLoanExecutor is FlashLoanSimpleReceiverBase {
    address public owner;
    uint256 public maxFlashAmount;

    event FlashLoanRequested(address indexed asset, uint256 amount, bytes params);
    event FlashLoanExecuted(address indexed asset, uint256 amount, uint256 premium, int256 pnl, bytes params);
    event MockCycleStarted(address indexed asset, uint256 amount, bytes params);
    event MockCycleCompleted(address indexed asset, uint256 amount, int256 pnl, bytes params);
    event StrategyExecuted(address indexed asset, uint256 amount, int256 pnl, bytes params);

    constructor(address provider)
        FlashLoanSimpleReceiverBase(IPoolAddressesProvider(provider))
    {
        owner = msg.sender;
        maxFlashAmount = 1_000_000e6; // default cap for 6-decimal assets
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function setMaxFlashAmount(uint256 newMax) external onlyOwner {
        maxFlashAmount = newMax;
    }

    // ========= AAVE FLASH-LOAN PATH =========

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        initiator; // unused

        require(amount > 0, "amount=0");
        require(amount <= maxFlashAmount, "amount>maxFlashAmount");

        uint256 beforeBal = IERC20(asset).balanceOf(address(this));

        int256 pnl = _strategy(asset, amount, params);

        uint256 totalOwed = amount + premium;
        uint256 afterBal = IERC20(asset).balanceOf(address(this));
        require(afterBal >= totalOwed, "insufficient funds to repay");

        IERC20(asset).approve(address(POOL), totalOwed);

        emit FlashLoanExecuted(asset, amount, premium, pnl, params);
        return true;
    }

    function requestFlashLoan(
        address asset,
        uint256 amount,
        bytes calldata params
    ) external onlyOwner {
        require(amount > 0, "amount=0");
        require(amount <= maxFlashAmount, "amount>maxFlashAmount");

        emit FlashLoanRequested(asset, amount, params);

        POOL.flashLoanSimple(
            address(this),
            asset,
            amount,
            params,
            0
        );
    }

    // ========= MOCK ERC20 TEST CYCLE =========

    function testMockCycle(
        address asset,
        uint256 amount,
        bytes calldata params
    ) external onlyOwner {
        require(amount > 0, "amount=0");

        uint256 beforeOwner = IERC20(asset).balanceOf(owner);
        uint256 beforeExec = IERC20(asset).balanceOf(address(this));

        emit MockCycleStarted(asset, amount, params);

        IERC20(asset).transferFrom(owner, address(this), amount);

        int256 pnl = _strategy(asset, amount, params);

        IERC20(asset).transfer(owner, amount);

        uint256 afterOwner = IERC20(asset).balanceOf(owner);
        uint256 afterExec = IERC20(asset).balanceOf(address(this));

        int256 execDelta = int256(afterExec) - int256(beforeExec);
        int256 ownerDelta = int256(afterOwner) - int256(beforeOwner);

        int256 reportedPnl = execDelta;

        emit MockCycleCompleted(asset, amount, reportedPnl, params);

        ownerDelta; // currently unused
        pnl;
    }

    // ========= INTERNAL STRATEGY HOOK =========

    /**
     * @dev Strategy entry point.
     *
     * params (when non-empty):
     *   (address router, address tokenIn, address tokenOut, uint256 minOutBps)
     *
     * For now we only decode and sanity-check; no Uniswap calls are made here.
     */
    function _strategy(
        address asset,
        uint256 amount,
        bytes memory params
    ) internal returns (int256 pnl) {
        // Neutral path for empty params (backwards compatible).
        if (params.length == 0) {
            pnl = 0;
            emit StrategyExecuted(asset, amount, pnl, params);
            return pnl;
        }

        (
            address router,
            address tokenIn,
            address tokenOut,
            uint256 minOutBps
        ) = abi.decode(params, (address, address, address, uint256));

        require(minOutBps <= 10_000, "minOutBps>100%");
        require(tokenIn == asset, "tokenIn!=asset");

        // Currently we don't act on router/tokenOut/minOutBps; they are logged only.
        router;
        tokenOut;
        amount;

        pnl = 0;

        emit StrategyExecuted(asset, amount, pnl, params);
        return pnl;
    }
}
