const { ethers, upgrades } = require('hardhat');
const { guardMainnet } = require('./guard-mainnet');

async function main() {
  await guardMainnet(ethers);
  if (process.env.ALLOW_TEMPORARY_EOA_ADMIN !== 'yes') {
    throw new Error('Set ALLOW_TEMPORARY_EOA_ADMIN=yes to allow a direct EOA upgrade');
  }
  const historyProxy = process.env.HISTORY_REGISTRY_ADDRESS;
  if (!historyProxy || !ethers.isAddress(historyProxy)) {
    throw new Error('HISTORY_REGISTRY_ADDRESS must be the deployed history proxy');
  }
  const upgradeCalldata = process.env.UPGRADE_CALLDATA || '0x';
  if (!ethers.isHexString(upgradeCalldata)) throw new Error('UPGRADE_CALLDATA must be hex calldata');

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const adminAddress = await upgrades.erc1967.getAdminAddress(historyProxy);
  const admin = new ethers.Contract(
    adminAddress,
    [
      'function owner() view returns (address)',
      'function upgradeAndCall(address proxy,address implementation,bytes data) payable'
    ],
    deployer
  );
  if ((await admin.owner()).toLowerCase() !== deployerAddress.toLowerCase()) {
    throw new Error('Current deployer does not own the History ProxyAdmin');
  }

  const History = await ethers.getContractFactory('GpcHistoryRegistry', deployer);
  const implementationAddress = await upgrades.prepareUpgrade(historyProxy, History, { kind: 'transparent' });
  const transaction = await admin.upgradeAndCall(historyProxy, implementationAddress, upgradeCalldata);
  await transaction.wait();

  console.log('History proxy:', historyProxy);
  console.log('New implementation:', implementationAddress);
  console.log('Upgrade transaction:', transaction.hash);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
