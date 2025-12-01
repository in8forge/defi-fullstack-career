// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ArbitrageBot {
    address public owner;
    address public factory;
    address public router;

    constructor(address _factory, address _router) {
        owner = msg.sender;
        factory = _factory;
        router = _router;
    }

    receive() external payable {}

    function withdraw(uint256 amount) external {
        require(msg.sender == owner, "not owner");
        require(address(this).balance >= amount, "insufficient balance");
        payable(owner).transfer(amount);
    }

    function activate() external {
        require(msg.sender == owner, "not owner");
        // hook for future arb logic
    }
}

