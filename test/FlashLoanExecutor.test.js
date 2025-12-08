import { expect } from "chai";
import hre from "hardhat";

describe("FlashLoanExecutor", function () {
  let executor;
  let owner;
  let addr1;
  
  const AAVE_POOL_PROVIDER = "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e";
  const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const UNISWAP_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
  const SUSHISWAP_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";

  beforeEach(async function () {
    [owner, addr1] = await hre.ethers.getSigners();
    
    const FlashLoanExecutor = await hre.ethers.getContractFactory("FlashLoanExecutor");
    executor = await FlashLoanExecutor.deploy(AAVE_POOL_PROVIDER);
    await executor.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await executor.owner()).to.equal(owner.address);
    });

    it("Should set default max flash amount", async function () {
      expect(await executor.maxFlashAmount()).to.equal(1_000_000_000000n);
    });

    it("Should set the Aave pool address correctly", async function () {
      const poolAddress = await executor.POOL();
      expect(poolAddress).to.not.equal(hre.ethers.ZeroAddress);
    });
  });

  describe("Access Control", function () {
    it("Should allow owner to set max flash amount", async function () {
      const newMax = hre.ethers.parseUnits("500000", 6);
      await executor.setMaxFlashAmount(newMax);
      expect(await executor.maxFlashAmount()).to.equal(newMax);
    });

    it("Should reject non-owner setting max flash amount", async function () {
      const newMax = hre.ethers.parseUnits("500000", 6);
      await expect(
        executor.connect(addr1).setMaxFlashAmount(newMax)
      ).to.be.revertedWith("Not owner");
    });

    it("Should reject non-owner flash loan requests", async function () {
      const amount = hre.ethers.parseUnits("1000", 6);
      const path1 = [USDC_ADDRESS, WETH_ADDRESS];
      const path2 = [WETH_ADDRESS, USDC_ADDRESS];
      
      await expect(
        executor.connect(addr1).requestFlashLoan(
          USDC_ADDRESS,
          amount,
          UNISWAP_ROUTER,
          SUSHISWAP_ROUTER,
          path1,
          path2
        )
      ).to.be.revertedWith("Not owner");
    });
  });

  describe("Flash Loan Request Validation", function () {
    it("Should reject flash loan amount exceeding max", async function () {
      const amount = hre.ethers.parseUnits("2000000", 6);
      const path1 = [USDC_ADDRESS, WETH_ADDRESS];
      const path2 = [WETH_ADDRESS, USDC_ADDRESS];
      
      await expect(
        executor.requestFlashLoan(
          USDC_ADDRESS,
          amount,
          UNISWAP_ROUTER,
          SUSHISWAP_ROUTER,
          path1,
          path2
        )
      ).to.be.revertedWith("Amount exceeds max");
    });

    it("Should reject invalid path (wrong start token)", async function () {
      const amount = hre.ethers.parseUnits("1000", 6);
      const path1 = [WETH_ADDRESS, USDC_ADDRESS];
      const path2 = [WETH_ADDRESS, USDC_ADDRESS];
      
      await expect(
        executor.requestFlashLoan(
          USDC_ADDRESS,
          amount,
          UNISWAP_ROUTER,
          SUSHISWAP_ROUTER,
          path1,
          path2
        )
      ).to.be.revertedWith("Invalid paths");
    });

    it("Should reject invalid path (wrong end token)", async function () {
      const amount = hre.ethers.parseUnits("1000", 6);
      const path1 = [USDC_ADDRESS, WETH_ADDRESS];
      const path2 = [WETH_ADDRESS, WETH_ADDRESS];
      
      await expect(
        executor.requestFlashLoan(
          USDC_ADDRESS,
          amount,
          UNISWAP_ROUTER,
          SUSHISWAP_ROUTER,
          path1,
          path2
        )
      ).to.be.revertedWith("Invalid paths");
    });
  });

  describe("Token Withdrawal", function () {
    it("Should allow owner to withdraw ETH", async function () {
      await owner.sendTransaction({
        to: await executor.getAddress(),
        value: hre.ethers.parseEther("1")
      });

      const contractAddress = await executor.getAddress();
      const initialBalance = await hre.ethers.provider.getBalance(contractAddress);
      expect(initialBalance).to.equal(hre.ethers.parseEther("1"));

      await executor.withdrawETH();
      
      const finalBalance = await hre.ethers.provider.getBalance(contractAddress);
      expect(finalBalance).to.equal(0);
    });

    it("Should reject non-owner ETH withdrawal", async function () {
      await expect(
        executor.connect(addr1).withdrawETH()
      ).to.be.revertedWith("Not owner");
    });

    it("Should reject non-owner token withdrawal", async function () {
      await expect(
        executor.connect(addr1).withdrawToken(USDC_ADDRESS, 1000)
      ).to.be.revertedWith("Not owner");
    });
  });

  describe("Contract State", function () {
    it("Should maintain correct owner after deployment", async function () {
      expect(await executor.owner()).to.equal(owner.address);
    });

    it("Should update max flash amount correctly", async function () {
      const amounts = [
        hre.ethers.parseUnits("100000", 6),
        hre.ethers.parseUnits("500000", 6),
        hre.ethers.parseUnits("1000000", 6)
      ];

      for (const amount of amounts) {
        await executor.setMaxFlashAmount(amount);
        expect(await executor.maxFlashAmount()).to.equal(amount);
      }
    });
  });

  describe("Edge Cases", function () {
    it("Should handle zero ETH withdrawal gracefully", async function () {
      const contractBalance = await hre.ethers.provider.getBalance(await executor.getAddress());
      expect(contractBalance).to.equal(0);
      
      await expect(executor.withdrawETH()).to.not.be.reverted;
    });

    it("Should maintain state consistency after failed operations", async function () {
      const initialMax = await executor.maxFlashAmount();
      
      await expect(
        executor.connect(addr1).setMaxFlashAmount(hre.ethers.parseUnits("500000", 6))
      ).to.be.revertedWith("Not owner");
      
      expect(await executor.maxFlashAmount()).to.equal(initialMax);
      expect(await executor.owner()).to.equal(owner.address);
    });
  });
});
