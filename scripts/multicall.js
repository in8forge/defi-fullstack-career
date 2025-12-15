import { ethers } from 'ethers';

// Multicall3 is deployed at same address on all chains
const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

const MULTICALL3_ABI = [
  'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) view returns (tuple(bool success, bytes returnData)[])',
];

export async function multicallCheck(provider, poolAddress, poolAbi, users) {
  const multicall = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const pool = new ethers.Interface(poolAbi);
  
  // Build calls
  const calls = users.map(user => ({
    target: poolAddress,
    allowFailure: true,
    callData: pool.encodeFunctionData('getUserAccountData', [user]),
  }));
  
  // Execute single multicall
  const results = await multicall.aggregate3(calls);
  
  // Decode results
  return results.map((result, i) => {
    if (!result.success) return null;
    
    try {
      const decoded = pool.decodeFunctionResult('getUserAccountData', result.returnData);
      const debt = Number(decoded[1]) / 1e8;
      const hf = Number(decoded[5]) / 1e18;
      
      return {
        user: users[i],
        debt,
        hf,
        liquidatable: hf < 1.0 && hf > 0,
      };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

export async function multicallCompound(provider, cometAddress, cometAbi, users) {
  const multicall = new ethers.Contract(MULTICALL3_ADDRESS, MULTICALL3_ABI, provider);
  const comet = new ethers.Interface(cometAbi);
  
  // Build calls - 2 per user (isLiquidatable + borrowBalanceOf)
  const calls = users.flatMap(user => [
    {
      target: cometAddress,
      allowFailure: true,
      callData: comet.encodeFunctionData('isLiquidatable', [user]),
    },
    {
      target: cometAddress,
      allowFailure: true,
      callData: comet.encodeFunctionData('borrowBalanceOf', [user]),
    },
  ]);
  
  const results = await multicall.aggregate3(calls);
  
  // Decode results (2 per user)
  const decoded = [];
  for (let i = 0; i < users.length; i++) {
    const liqResult = results[i * 2];
    const debtResult = results[i * 2 + 1];
    
    if (!liqResult.success || !debtResult.success) continue;
    
    try {
      const isLiq = comet.decodeFunctionResult('isLiquidatable', liqResult.returnData)[0];
      const debt = Number(comet.decodeFunctionResult('borrowBalanceOf', debtResult.returnData)[0]) / 1e6;
      
      decoded.push({
        user: users[i],
        debt,
        liquidatable: isLiq,
        hf: isLiq ? 0.99 : 1.5,
      });
    } catch {}
  }
  
  return decoded;
}
