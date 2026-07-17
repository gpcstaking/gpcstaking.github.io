const { ethers, upgrades } = require('hardhat');
const { guardMainnet } = require('./guard-mainnet');

async function main() {
  await guardMainnet(ethers);
  if (process.env.ALLOW_TEMPORARY_EOA_ADMIN !== 'yes') {
    throw new Error('Set ALLOW_TEMPORARY_EOA_ADMIN=yes to allow a direct EOA upgrade');
  }
  if (!process.env.ORACLE_ADDRESS || !ethers.isAddress(process.env.ORACLE_ADDRESS)) {
    throw new Error('ORACLE_ADDRESS must be the deployed oracle proxy');
  }
  const upgradeCalldata = process.env.UPGRADE_CALLDATA || '0x';
  if (!ethers.isHexString(upgradeCalldata)) throw new Error('UPGRADE_CALLDATA must be hex calldata');

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const adminAddress = await upgrades.erc1967.getAdminAddress(process.env.ORACLE_ADDRESS);
  const admin = new ethers.Contract(
    adminAddress,
    [
      'function owner() view returns (address)',
      'function upgradeAndCall(address proxy,address implementation,bytes data) payable'
    ],
    deployer
  );
  if ((await admin.owner()).toLowerCase() !== deployerAddress.toLowerCase()) {
    throw new Error('Current deployer does not own the Oracle ProxyAdmin');
  }

  const Oracle = await ethers.getContractFactory('GpcMainnetOracle', deployer);
  const implementationAddress = await upgrades.prepareUpgrade(
    process.env.ORACLE_ADDRESS,
    Oracle,
    { kind: 'transparent' }
  );
  const transaction = await admin.upgradeAndCall(
    process.env.ORACLE_ADDRESS,
    implementationAddress,
    upgradeCalldata
  );
  await transaction.wait();

  console.log('Oracle proxy:', process.env.ORACLE_ADDRESS);
  console.log('New implementation:', implementationAddress);
  console.log('Upgrade transaction:', transaction.hash);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
