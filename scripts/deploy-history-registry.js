const { ethers } = require('hardhat');
const { guardMainnet } = require('./guard-mainnet');

async function main() {
  await guardMainnet(ethers);
  const miningProxy = process.env.MINING_PROXY_ADDRESS;
  if (!miningProxy || !ethers.isAddress(miningProxy)) {
    throw new Error('MINING_PROXY_ADDRESS must be the deployed mining proxy');
  }

  const History = await ethers.getContractFactory('GpcHistoryRegistry');
  const history = await History.deploy();
  await history.waitForDeployment();
  const deploymentTx = history.deploymentTransaction();

  const writerTx = await history.setWriter(miningProxy);
  await writerTx.wait();

  console.log('History registry:', history.target);
  console.log('Registry deployment transaction:', deploymentTx.hash);
  console.log('Writer transaction:', writerTx.hash);
  console.log('Tracking started at:', await history.trackingStartedAt());
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
