import { formatUnits, parseUnits, Wallet } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const UNISWAP_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const SUSHISWAP_ROUTER = "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F";
const FLASH_LOAN_EXECUTOR = "0x22FecD4E106a24B378e93099ed2ab69f26ED67C0";

const USDC_DECIMALS = 6;
const MIN_PROFIT_USDC = 10;

let executionCount = 0;

function log(level, message, data = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    executionCount,
    ...data
  };
  console.log(JSON.stringify(entry, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  ));
}

async function simulateExecution(executor, asset, amount, router1, router2, path1, path2, signer) {
  try {
    const tx = await executor.requestFlashLoan.staticCall(
      asset,
      amount,
      router1,
      router2,
      path1,
      path2,
      { from: signer.address }
    );
    
    log("info", "Simulation successful", { result: tx });
    return true;
  } catch (error) {
    log("error", "Simulation failed", { 
      error: error.message,
      reason: error.reason || "Unknown"
    });
    return false;
  }
}

async function executeArbitrage(opportunity, provider, signer) {
  executionCount++;
  
  log("info", "Attempting arbitrage execution", {
    path: opportunity.path,
    expectedProfit: opportunity.netPnL,
    roi: opportunity.roi
  });

  try {
    const executor = await ethers.getContractAt("FlashLoanExecutor", FLASH_LOAN_EXECUTOR, signer);
    
    const amount = parseUnits(opportunity.breakdown.amountIn, USDC_DECIMALS);
    const path1 = opportunity.execution.path1;
    const path2 = opportunity.execution.path2;
    const router1 = opportunity.execution.router1;
    const router2 = opportunity.execution.router2;

    log("info", "Simulating transaction before execution");
    const simSuccess = await simulateExecution(
      executor,
      USDC_ADDRESS,
      amount,
      router1,
      router2,
      path1,
      path2,
      signer
    );

    if (!simSuccess) {
      log("warn", "Simulation failed - aborting execution");
      return false;
    }

    log("info", "Simulation passed - sending transaction");
    
    const tx = await executor.requestFlashLoan(
      USDC_ADDRESS,
      amount,
      router1,
      router2,
      path1,
      path2,
      {
        gasLimit: 500000
      }
    );

    log("info", "Transaction sent", { 
      hash: tx.hash,
      nonce: tx.nonce
    });

    const receipt = await tx.wait();

    log("info", "Transaction confirmed", {
      hash: receipt.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status === 1 ? "success" : "failed"
    });

    const events = receipt.logs.map(l => {
      try {
        return executor.interface.parseLog(l);
      } catch {
        return null;
      }
    }).filter(Boolean);

    events.forEach(event => {
      log("info", "Contract event emitted", {
        event: event.name,
        args: Object.fromEntries(
          Object.entries(event.args).filter(([k]) => isNaN(k))
        )
      });
    });

    return receipt.status === 1;

  } catch (error) {
    log("error", "Execution failed", {
      error: error.message,
      code: error.code,
      reason: error.reason
    });
    return false;
  }
}

async function monitorForOpportunities(provider, signer) {
  log("info", "Starting arbitrage monitor", {
    executor: FLASH_LOAN_EXECUTOR,
    minProfit: MIN_PROFIT_USDC,
    wallet: signer.address
  });

  const arbEngine = await import('./arbGasAwarePlannerUSDC.js');
  
  log("info", "Monitor active - watching for profitable opportunities");
}

async function main() {
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  
  const privateKey = process.env.PRIVATE_KEY || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  const signer = new Wallet(privateKey, provider);

  const balance = await provider.getBalance(signer.address);
  log("info", "Wallet initialized", {
    address: signer.address,
    balance: formatUnits(balance, 18)
  });

  await monitorForOpportunities(provider, signer);
}

main().catch(error => {
  log("error", "Fatal error", { error: error.message });
  process.exit(1);
});
