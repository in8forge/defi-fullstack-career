// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    uint8 private constant _DECIMALS = 6;

    constructor() ERC20("Mock USD Coin", "mUSDC") {
        // Optionally mint initial supply to deployer
        // _mint(msg.sender, 1_000_000 * 10 ** _DECIMALS);
    }

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    /// @notice Mint arbitrary amount of tokens for testing
    /// @dev Anyone can mint in this mock, do not use in production
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
