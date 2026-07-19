const { ethers, upgrades } = require('hardhat');
const { guardMainnet } = require('./guard-mainnet');

const OLD_MINING_PROXY = '0x7C7C849734ea94a590266F90B5fD63D555ed3ca3';
const GPC = '0xD3c304697f63B279cd314F92c19cDBE5E5b1631A';
const RETIREMENT_RECIPIENT = '0xC34622e54f259304877A10A901caa332250A84f5';

async function main() {
  await guardMainnet(ethers);
  if (process.env.ALLOW_RETIRE_OLD_MINING !== 'yes') {
    throw new Error('Set ALLOW_RETIRE_OLD_MINING=yes after reviewing the fixed proxy and recipient');
  }

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const adminAddress = await upgrades.erc1967.getAdminAddress(OLD_MINING_PROXY);
  const admin = new ethers.Contract(
    adminAddress,
    [
      'function owner() view returns (address)',
      'function upgradeAndCall(address proxy,address implementation,bytes data) payable'
    ],
    deployer
  );
  const mining = await ethers.getContractAt(
    [
      'function owner() view returns (address)',
      'function paused() view returns (bool)',
      'function pause()',
      'function miningPoolGpc() view returns (uint256)'
    ],
    OLD_MINING_PROXY,
    deployer
  );
  const gpc = await ethers.getContractAt(
    ['function balanceOf(address) view returns (uint256)'],
    GPC,
    deployer
  );

  if ((await admin.owner()).toLowerCase() !== deployerAddress.toLowerCase()) {
    throw new Error('Current deployer does not own the legacy ProxyAdmin');
  }
  if ((await mining.owner()).toLowerCase() !== deployerAddress.toLowerCase()) {
    throw new Error('Current deployer does not own the legacy mining proxy');
  }

  const poolBefore = await mining.miningPoolGpc();
  const proxyBalanceBefore = await gpc.balanceOf(OLD_MINING_PROXY);
  const recipientBalanceBefore = await gpc.balanceOf(RETIREMENT_RECIPIENT);
  if (poolBefore !== proxyBalanceBefore || proxyBalanceBefore === 0n) {
    throw new Error('Legacy GPC balance does not exactly match its mining-pool accounting');
  }

  const Retirement = await ethers.getContractFactory('GpcMiningRetirement', deployer);
  const implementationAddress = await upgrades.prepareUpgrade(OLD_MINING_PROXY, Retirement, {
    kind: 'transparent'
  });

  let pauseTxHash = null;
  if (!(await mining.paused())) {
    const pauseTx = await mining.pause();
    await pauseTx.wait();
    pauseTxHash = pauseTx.hash;
  }

  const upgradeTx = await admin.upgradeAndCall(OLD_MINING_PROXY, implementationAddress, '0x');
  await upgradeTx.wait();

  const retired = await ethers.getContractAt('GpcMiningRetirement', OLD_MINING_PROXY, deployer);
  if ((await retired.RETIREMENT_RECIPIENT()).toLowerCase() !== RETIREMENT_RECIPIENT.toLowerCase()) {
    throw new Error('Retirement implementation recipient mismatch');
  }
  await retired.retireOldMiningPool.staticCall();
  const retireTx = await retired.retireOldMiningPool();
  await retireTx.wait();

  const proxyBalanceAfter = await gpc.balanceOf(OLD_MINING_PROXY);
  const recipientBalanceAfter = await gpc.balanceOf(RETIREMENT_RECIPIENT);
  if (
    proxyBalanceAfter !== 0n ||
    (await retired.miningPoolGpc()) !== 0n ||
    recipientBalanceAfter - recipientBalanceBefore !== proxyBalanceBefore ||
    !(await retired.paused())
  ) {
    throw new Error('Legacy mining retirement postconditions failed');
  }

  console.log('Legacy mining proxy:', OLD_MINING_PROXY);
  console.log('Retirement implementation:', implementationAddress);
  console.log('Pause transaction:', pauseTxHash || 'already paused');
  console.log('Upgrade transaction:', upgradeTx.hash);
  console.log('Retirement transaction:', retireTx.hash);
  console.log('Recipient:', RETIREMENT_RECIPIENT);
  console.log('Transferred GPC:', ethers.formatEther(proxyBalanceBefore));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
