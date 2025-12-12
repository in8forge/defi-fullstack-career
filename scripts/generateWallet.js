import { Wallet } from "ethers";

const wallet = Wallet.createRandom();

console.log("\n" + "=".repeat(80));
console.log("🔐 NEW SECURE WALLET GENERATED");
console.log("=".repeat(80));
console.log("\n⚠️  SAVE THESE SECURELY - NEVER SHARE OR COMMIT TO GIT!\n");
console.log("📍 Address:", wallet.address);
console.log("🔑 Private Key:", wallet.privateKey);
console.log("📝 Mnemonic:", wallet.mnemonic.phrase);
console.log("\n" + "=".repeat(80));
console.log("\n💡 Next steps:");
console.log("   1. SAVE the mnemonic phrase somewhere SAFE (paper, password manager)");
console.log("   2. Update .env with the new PRIVATE_KEY");
console.log("   3. Fund the new Address on Base");
console.log("   4. NEVER commit .env to git!");
console.log("   5. DELETE this terminal output after saving!\n");
