import fs from "fs";

const artifact = JSON.parse(fs.readFileSync('./artifacts/contracts/FlashLiquidator.sol/FlashLiquidator.json', 'utf8'));

console.log("Constructor ABI:");
const constructor = artifact.abi.find(x => x.type === "constructor");
console.log(JSON.stringify(constructor, null, 2));

console.log("\nBytecode length:", artifact.bytecode?.length || 0);
