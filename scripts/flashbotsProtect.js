// Flashbots Protect RPC endpoints
// Transactions sent here are private - MEV bots can't see them

export const FLASHBOTS_RPC = {
  base: 'https://rpc.flashbots.net/base',
  ethereum: 'https://rpc.flashbots.net',
  // Arbitrum and others don't have official Flashbots yet
};

export const STANDARD_RPC = {
  base: process.env.BASE_RPC_URL,
  polygon: process.env.POLYGON_RPC_URL,
  arbitrum: process.env.ARBITRUM_RPC_URL,
  avalanche: process.env.AVALANCHE_RPC_URL,
};

// Use Flashbots for sending, standard for reading
export function getProtectedRpc(chain) {
  return FLASHBOTS_RPC[chain] || null;
}

export function hasFlashbotsProtection(chain) {
  return !!FLASHBOTS_RPC[chain];
}
