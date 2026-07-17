const { ethers } = require('hardhat');
const { guardMainnet } = require('./guard-mainnet');

async function main() {
  await guardMainnet(ethers);
  if (!process.env.ORACLE_ADDRESS) throw new Error('ORACLE_ADDRESS is required');

  const oracle = await ethers.getContractAt('GpcSixHourOracle', process.env.ORACLE_ADDRESS);
  const transaction = await oracle.update();
  await transaction.wait();
  console.log('Oracle updated:', process.env.ORACLE_ADDRESS);
  console.log('GPC/USDT TWAP:', ethers.formatEther(await oracle.price()));
  console.log('WBNB/USDT TWAP:', ethers.formatEther(await oracle.bnbPrice()));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
