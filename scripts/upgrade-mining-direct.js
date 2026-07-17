const { ethers, upgrades } = require('hardhat');
const { guardMainnet } = require('./guard-mainnet');

async function main() {
  await guardMainnet(ethers);
  if (process.env.ALLOW_TEMPORARY_EOA_ADMIN !== 'yes') {
    throw new Error('Set ALLOW_TEMPORARY_EOA_ADMIN=yes to allow a direct EOA upgrade');
  }
  if (!process.env.MINING_PROXY_ADDRESS || !ethers.isAddress(process.env.MINING_PROXY_ADDRESS)) {
    throw new Error('MINING_PROXY_ADDRESS must be the deployed mining proxy');
  }
  const upgradeCalldata = process.env.UPGRADE_CALLDATA || '0x';
  if (!ethers.isHexString(upgradeCalldata)) throw new Error('UPGRADE_CALLDATA must be hex calldata');

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const adminAddress = await upgrades.erc1967.getAdminAddress(process.env.MINING_PROXY_ADDRESS);
  const admin = new ethers.Contract(
    adminAddress,
    [
      'function owner() view returns (address)',
      'function upgradeAndCall(address proxy,address implementation,bytes data) payable'
    ],
    deployer
  );
  if ((await admin.owner()).toLowerCase() !== deployerAddress.toLowerCase()) {
    throw new Error('Current deployer does not own the Mining ProxyAdmin');
  }

  const Mining = await ethers.getContractFactory('GpcMining', deployer);
  const implementationAddress = await upgrades.prepareUpgrade(
    process.env.MINING_PROXY_ADDRESS,
    Mining,
    { kind: 'transparent' }
  );
  const transaction = await admin.upgradeAndCall(
    process.env.MINING_PROXY_ADDRESS,
    implementationAddress,
    upgradeCalldata
  );
  await transaction.wait();

  console.log('Mining proxy:', process.env.MINING_PROXY_ADDRESS);
  console.log('New implementation:', implementationAddress);
  console.log('Upgrade transaction:', transaction.hash);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
