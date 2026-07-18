const { ethers } = require('hardhat');
const { guardMainnet } = require('./guard-mainnet');

async function main() {
  await guardMainnet(ethers);
  const miningProxy = process.env.MINING_PROXY_ADDRESS;
  if (!miningProxy || !ethers.isAddress(miningProxy)) {
    throw new Error('MINING_PROXY_ADDRESS must be the deployed mining proxy');
  }
  if (process.env.PAUSE_MINING !== 'yes' && process.env.PAUSE_MINING !== 'no') {
    throw new Error('Set PAUSE_MINING=yes to pause or PAUSE_MINING=no to unpause');
  }

  const mining = await ethers.getContractAt(
    ['function paused() view returns (bool)', 'function pause()', 'function unpause()'],
    miningProxy
  );
  const shouldPause = process.env.PAUSE_MINING === 'yes';
  const alreadyPaused = await mining.paused();
  if (alreadyPaused === shouldPause) {
    console.log(`Mining is already ${shouldPause ? 'paused' : 'active'}`);
    return;
  }

  const tx = shouldPause ? await mining.pause() : await mining.unpause();
  await tx.wait();
  console.log(`Mining ${shouldPause ? 'paused' : 'unpaused'}:`, tx.hash);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
