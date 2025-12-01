import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

async function main() {
  const block = await provider.getBlockNumber();
  console.log("Connected. Current block:", block);

  const accounts = await provider.listAccounts();
  console.log("Accounts:", accounts);
}

main();

