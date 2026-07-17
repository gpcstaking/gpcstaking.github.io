const { ethers } = require('hardhat');
const { guardMainnet } = require('./guard-mainnet');

async function main() {
  await guardMainnet(ethers);
  if (!process.env.ORACLE_ADDRESS) throw new Error('ORACLE_ADDRESS is required');

  const oracle = await ethers.getContractAt('GpcMainnetOracle', process.env.ORACLE_ADDRESS);
  const latestBlock = await ethers.provider.getBlock('latest');
  const nextUpdateAt = await oracle.nextUpdateAt();
  if (BigInt(latestBlock.timestamp) < nextUpdateAt) {
    console.log('Oracle update not due until:', String(nextUpdateAt));
    return;
  }
  const transaction = await oracle.update();
  await transaction.wait();
  console.log('Oracle updated:', process.env.ORACLE_ADDRESS);
  console.log('Transaction:', transaction.hash);
  if (await oracle.isReady()) {
    const [mode, windowSeconds] = await oracle.priceStatus();
    const labels = ['spot fallback', 'partial TWAP', 'full 6H TWAP'];
    console.log('Price mode:', labels[Number(mode)], 'window seconds:', String(windowSeconds));
    console.log('GPC/USDT price:', ethers.formatEther(await oracle.price()));
    console.log('WBNB/USDT price:', ethers.formatEther(await oracle.bnbPrice()));
  } else {
    console.log('Rolling TWAP is warming up; keep recording one point per minute.');
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
