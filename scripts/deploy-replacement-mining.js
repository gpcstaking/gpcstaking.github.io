const { ethers, upgrades } = require('hardhat');
const { guardMainnet } = require('./guard-mainnet');

const USDT = '0x55d398326f99059fF775485246999027B3197955';
const GPC = '0xD3c304697f63B279cd314F92c19cDBE5E5b1631A';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const OPERATION_WALLET = '0xC34622e54f259304877A10A901caa332250A84f5';
const PROXY_ADMIN_OWNER = '0xA115A26023eF5072057DBF9Ef43C2f61F79F38b7';

async function assertSafe(address, label) {
  if ((await ethers.provider.getCode(address)) === '0x') throw new Error(`${label} has no contract code`);
  const safe = new ethers.Contract(
    address,
    ['function getOwners() view returns (address[])', 'function getThreshold() view returns (uint256)'],
    ethers.provider
  );
  const [owners, threshold] = await Promise.all([safe.getOwners(), safe.getThreshold()]);
  if (owners.length < 2 || threshold < 2n || threshold > BigInt(owners.length)) {
    throw new Error(`${label} is not a valid multi-owner Safe`);
  }
}

async function transferProxyAdmin(adminAddress, newOwner, signer) {
  const admin = new ethers.Contract(
    adminAddress,
    ['function owner() view returns (address)', 'function transferOwnership(address newOwner)'],
    signer
  );
  const tx = await admin.transferOwnership(newOwner);
  await tx.wait();
  if ((await admin.owner()).toLowerCase() !== newOwner.toLowerCase()) {
    throw new Error(`ProxyAdmin ${adminAddress} ownership transfer failed`);
  }
  return tx.hash;
}

async function main() {
  await guardMainnet(ethers);
  if (process.env.ALLOW_REPLACEMENT_MINING_DEPLOY !== 'yes') {
    throw new Error('Set ALLOW_REPLACEMENT_MINING_DEPLOY=yes after reviewing all fixed addresses');
  }
  if (!process.env.ORACLE_ADDRESS || !ethers.isAddress(process.env.ORACLE_ADDRESS)) {
    throw new Error('ORACLE_ADDRESS must be the deployed oracle proxy');
  }
  await assertSafe(PROXY_ADMIN_OWNER, 'Proxy admin owner');
  await assertSafe(OPERATION_WALLET, 'Operation wallet');

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const oracle = await ethers.getContractAt('GpcSixHourOracle', process.env.ORACLE_ADDRESS);
  if (!(await oracle.isReady())) throw new Error('Oracle is not ready');
  if ((await oracle.gpc()).toLowerCase() !== GPC.toLowerCase()) throw new Error('Oracle GPC mismatch');
  if ((await oracle.wbnb()).toLowerCase() !== WBNB.toLowerCase()) throw new Error('Oracle WBNB mismatch');
  if ((await oracle.usdt()).toLowerCase() !== USDT.toLowerCase()) throw new Error('Oracle USDT mismatch');

  const Mining = await ethers.getContractFactory('GpcMining', deployer);
  const mining = await upgrades.deployProxy(Mining, [process.env.ORACLE_ADDRESS, deployerAddress], {
    kind: 'transparent',
    initializer: 'initialize',
    initialOwner: deployerAddress
  });
  await mining.waitForDeployment();
  const miningProxy = await mining.getAddress();
  const miningDeploymentTx = mining.deploymentTransaction();
  const miningReceipt = await miningDeploymentTx.wait();
  const miningImplementation = await upgrades.erc1967.getImplementationAddress(miningProxy);
  const miningAdmin = await upgrades.erc1967.getAdminAddress(miningProxy);

  if ((await mining.operationWallet()).toLowerCase() !== OPERATION_WALLET.toLowerCase()) {
    throw new Error('Replacement operation wallet mismatch');
  }
  if ((await mining.parentOf(OPERATION_WALLET)).toLowerCase() !== miningProxy.toLowerCase()) {
    throw new Error('Replacement referral root was not initialized');
  }
  if ((await mining.name()) !== 'GPC STAKING') {
    throw new Error('Replacement ERC20-compatible name mismatch');
  }
  if ((await mining.symbol()) !== 'GS') {
    throw new Error('Replacement ERC20-compatible symbol mismatch');
  }
  if ((await mining.decimals()) !== 18n || (await mining.totalSupply()) !== 0n) {
    throw new Error('Replacement ERC20-compatible initial state mismatch');
  }

  const History = await ethers.getContractFactory('GpcHistoryRegistry', deployer);
  const history = await upgrades.deployProxy(History, [miningProxy, deployerAddress], {
    kind: 'transparent',
    initializer: 'initialize',
    initialOwner: deployerAddress
  });
  await history.waitForDeployment();
  const historyProxy = await history.getAddress();
  const historyDeploymentTx = history.deploymentTransaction();
  await historyDeploymentTx.wait();
  const historyImplementation = await upgrades.erc1967.getImplementationAddress(historyProxy);
  const historyAdmin = await upgrades.erc1967.getAdminAddress(historyProxy);

  const trackingTx = await mining.initializeHistoryTracking(historyProxy);
  await trackingTx.wait();
  if ((await mining.historyRegistry()).toLowerCase() !== historyProxy.toLowerCase()) {
    throw new Error('History registry initialization failed');
  }

  const miningAdminTransferTx = await transferProxyAdmin(miningAdmin, PROXY_ADMIN_OWNER, deployer);
  const historyAdminTransferTx = await transferProxyAdmin(historyAdmin, PROXY_ADMIN_OWNER, deployer);

  console.log('Replacement mining proxy:', miningProxy);
  console.log('Replacement mining implementation:', miningImplementation);
  console.log('Replacement mining ProxyAdmin:', miningAdmin);
  console.log('Replacement mining deployment tx:', miningDeploymentTx.hash);
  console.log('Replacement mining deployment block:', miningReceipt.blockNumber);
  console.log('Replacement history proxy:', historyProxy);
  console.log('Replacement history implementation:', historyImplementation);
  console.log('Replacement history ProxyAdmin:', historyAdmin);
  console.log('Replacement history deployment tx:', historyDeploymentTx.hash);
  console.log('History tracking tx:', trackingTx.hash);
  console.log('Mining ProxyAdmin ownership tx:', miningAdminTransferTx);
  console.log('History ProxyAdmin ownership tx:', historyAdminTransferTx);
  console.log('ProxyAdmin owner:', PROXY_ADMIN_OWNER);
  console.log('Business owner:', await mining.owner());
  console.log('Operation wallet:', await mining.operationWallet());
  console.log('Oracle:', await mining.oracle());
  console.log('Power token name:', await mining.name());
  console.log('Power token symbol:', await mining.symbol());
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
