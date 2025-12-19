// Add this check to V6 before reporting liquidatable
// A position is only profitable if it has BOTH shortfall AND collateral

async function isRealLiquidation(address) {
  const [error, liquidity, shortfall] = await venusComptroller.getAccountLiquidity(address);
  if (shortfall === 0n) return false;
  
  // Check if has collateral
  for (const [symbol, config] of Object.entries(VENUS_VTOKENS)) {
    const vToken = new ethers.Contract(config.address, ['function balanceOf(address) view returns (uint256)'], venusProvider);
    const balance = await vToken.balanceOf(address);
    if (balance > 0n) return true; // Has collateral = real opportunity
  }
  
  return false; // No collateral = bad debt
}
