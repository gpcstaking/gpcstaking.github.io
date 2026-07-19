const { ethers, upgrades } = require('hardhat');
const { guardMainnet } = require('./guard-mainnet');
const { validateSafeOwner } = require('./admin-security');

async function main() {
  await guardMainnet(ethers);
  const proxy = process.env.ORACLE_ADDRESS;
  const adminAddress = process.env.ORACLE_PROXY_ADMIN_ADDRESS;
  if (!proxy || !ethers.isAddress(proxy)) {
    throw new Error('ORACLE_ADDRESS must be the deployed oracle proxy');
  }
  if (!adminAddress || !ethers.isAddress(adminAddress)) {
    throw new Error('ORACLE_PROXY_ADMIN_ADDRESS must be the recorded ProxyAdmin');
  }
  const upgradeCalldata = process.env.UPGRADE_CALLDATA || '0x';
  if (!ethers.isHexString(upgradeCalldata)) throw new Error('UPGRADE_CALLDATA must be hex calldata');

  const admin = new ethers.Contract(adminAddress, ['function owner() view returns (address)'], ethers.provider);
  const adminOwner = await admin.owner();
  const safe = await validateSafeOwner(ethers, adminOwner, 'Oracle ProxyAdmin owner');

  const Oracle = await ethers.getContractFactory('GpcMainnetOracle');
  const implementationAddress = await upgrades.prepareUpgrade(proxy, Oracle, { kind: 'transparent' });
  const upgradeData = new ethers.Interface([
    'function upgradeAndCall(address proxy,address implementation,bytes data) payable'
  ]).encodeFunctionData('upgradeAndCall', [proxy, implementationAddress, upgradeCalldata]);

  console.log('Oracle proxy:', proxy);
  console.log('New implementation:', implementationAddress);
  console.log('Oracle ProxyAdmin:', adminAddress);
  console.log('Safe owner:', safe.address);
  console.log('Safe threshold:', String(safe.threshold));
  console.log('Safe transaction target:', adminAddress);
  console.log('Safe transaction value: 0');
  console.log('Safe transaction calldata:', upgradeData);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
