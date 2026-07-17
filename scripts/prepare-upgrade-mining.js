const { ethers, upgrades } = require('hardhat');
const { guardMainnet } = require('./guard-mainnet');
const { validateTimelockOwner } = require('./admin-security');

async function main() {
  await guardMainnet(ethers);
  if (!process.env.MINING_PROXY_ADDRESS || !ethers.isAddress(process.env.MINING_PROXY_ADDRESS)) {
    throw new Error('MINING_PROXY_ADDRESS must be the deployed transparent proxy');
  }
  const upgradeCalldata = process.env.UPGRADE_CALLDATA || '0x';
  if (!ethers.isHexString(upgradeCalldata)) throw new Error('UPGRADE_CALLDATA must be hex calldata');

  const adminAddress = await upgrades.erc1967.getAdminAddress(process.env.MINING_PROXY_ADDRESS);
  const admin = new ethers.Contract(adminAddress, ['function owner() view returns (address)'], ethers.provider);
  const adminOwner = await admin.owner();
  await validateTimelockOwner(ethers, adminOwner, 'Mining ProxyAdmin owner');

  const Mining = await ethers.getContractFactory('GpcMining');
  const implementationAddress = await upgrades.prepareUpgrade(
    process.env.MINING_PROXY_ADDRESS,
    Mining,
    { kind: 'transparent' }
  );
  const proxyAdmin = new ethers.Interface([
    'function upgradeAndCall(address proxy,address implementation,bytes data) payable'
  ]);
  const upgradeData = proxyAdmin.encodeFunctionData('upgradeAndCall', [
    process.env.MINING_PROXY_ADDRESS,
    implementationAddress,
    upgradeCalldata
  ]);
  const predecessor = process.env.TIMELOCK_PREDECESSOR || ethers.ZeroHash;
  if (!ethers.isHexString(predecessor, 32)) throw new Error('TIMELOCK_PREDECESSOR must be bytes32');
  const salt = process.env.TIMELOCK_SALT || ethers.keccak256(
    ethers.solidityPacked(
      ['string', 'address', 'address'],
      ['GPC_MINING_UPGRADE', process.env.MINING_PROXY_ADDRESS, implementationAddress]
    )
  );
  if (!ethers.isHexString(salt, 32)) throw new Error('TIMELOCK_SALT must be bytes32');
  const timelock = new ethers.Contract(
    adminOwner,
    ['function getMinDelay() view returns (uint256)'],
    ethers.provider
  );
  const delay = await timelock.getMinDelay();
  const timelockInterface = new ethers.Interface([
    'function schedule(address target,uint256 value,bytes data,bytes32 predecessor,bytes32 salt,uint256 delay)',
    'function execute(address target,uint256 value,bytes payload,bytes32 predecessor,bytes32 salt) payable'
  ]);
  const scheduleData = timelockInterface.encodeFunctionData('schedule', [
    adminAddress,
    0,
    upgradeData,
    predecessor,
    salt,
    delay
  ]);
  const executeData = timelockInterface.encodeFunctionData('execute', [
    adminAddress,
    0,
    upgradeData,
    predecessor,
    salt
  ]);

  console.log('Proxy:', process.env.MINING_PROXY_ADDRESS);
  console.log('New implementation:', implementationAddress);
  console.log('ProxyAdmin:', adminAddress);
  console.log('Timelock owner:', adminOwner);
  console.log('Timelock delay:', String(delay));
  console.log('Timelock predecessor:', predecessor);
  console.log('Timelock salt:', salt);
  console.log('Schedule target:', adminOwner);
  console.log('Schedule value: 0');
  console.log('Schedule calldata:', scheduleData);
  console.log('Execute target:', adminOwner);
  console.log('Execute value: 0');
  console.log('Execute calldata:', executeData);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
