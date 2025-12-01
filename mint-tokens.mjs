import "dotenv/config";
import { ethers } from "ethers";

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!ALCHEMY_API_KEY || !PRIVATE_KEY) {
  console.error("Missing ALCHEMY_API_KEY or PRIVATE_KEY in .env");
  process.exit(1);
}

const rpcUrl = `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Existing token and your wallet
const TOKEN_ADDRESS = "0x07504b269183a79B71D00924FAcE41dEcCde21942";
const RECIPIENT = "0x61419Ca788292f87de4F971Bfed51e372C253Cc5";

// ERC20 with mint
const tokenAbi = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function mint(address to, uint256 amount) external"
];

async function main() {
  const me = await wallet.getAddress();
  console.log("Deployer/wallet:", me);

  const token = new ethers.Contract(TOKEN_ADDRESS, tokenAbi, wallet);

  const decimals = await token.decimals();
  const amount = ethers.parseUnits("1000", decimals); // mint 1000 tokens

  console.log(`Minting 1000 tokens to ${RECIPIENT}...`);
  const tx = await token.mint(RECIPIENT, amount);
  console.log("Mint tx:", tx.hash);

  const receipt = await tx.wait();
  console.log("Mint confirmed in block:", receipt.blockNumber);

  const bal = await token.balanceOf(RECIPIENT);
  console.log("New balance (raw units):", bal.toString());
}

main().catch((err) => {
  console.error("Mint failed:", err);
  process.exit(1);
});

