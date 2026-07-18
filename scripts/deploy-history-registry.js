const { ethers, upgrades } = require('hardhat');
const { guardMainnet } = require('./guard-mainnet');

async function main() {
  await guardMainnet(ethers);
  const miningProxy = process.env.MINING_PROXY_ADDRESS;
  if (!miningProxy || !ethers.isAddress(miningProxy)) {
    throw new Error('MINING_PROXY_ADDRESS must be the deployed mining proxy');
  }

  const History = await ethers.getContractFactory('GpcHistoryRegistry');
  const [deployer] = await ethers.getSigners();
  const owner = await deployer.getAddress();
  const history = await upgrades.deployProxy(History, [miningProxy, owner], {
    kind: 'transparent',
    initializer: 'initialize',
    initialOwner: owner
  });
  await history.waitForDeployment();
  const deploymentTx = history.deploymentTransaction();
  const implementation = await upgrades.erc1967.getImplementationAddress(history.target);
  const proxyAdmin = await upgrades.erc1967.getAdminAddress(history.target);

  console.log('History registry proxy:', history.target);
  console.log('History registry implementation:', implementation);
  console.log('History registry ProxyAdmin:', proxyAdmin);
  console.log('History registry ProxyAdmin owner:', owner);
  console.log('Registry proxy deployment transaction:', deploymentTx.hash);
  console.log('Tracking started at:', await history.trackingStartedAt());
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
