const { ethers, upgrades } = require('hardhat');
const { guardMainnet } = require('./guard-mainnet');

const USDT = '0x55d398326f99059fF775485246999027B3197955';
const GPC = '0xD3c304697f63B279cd314F92c19cDBE5E5b1631A';
const WBNB = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';

async function main() {
  await guardMainnet(ethers);
  if (!process.env.ORACLE_ADDRESS || !ethers.isAddress(process.env.ORACLE_ADDRESS)) {
    throw new Error('ORACLE_ADDRESS must be the deployed oracle proxy');
  }
  if (process.env.ALLOW_TEMPORARY_EOA_ADMIN !== 'yes') {
    throw new Error('Set ALLOW_TEMPORARY_EOA_ADMIN=yes to acknowledge temporary deployer-controlled upgrades');
  }
  const [deployer] = await ethers.getSigners();
  const adminOwner = await deployer.getAddress();

  const oracle = await ethers.getContractAt('GpcSixHourOracle', process.env.ORACLE_ADDRESS);
  const oracleReady = await oracle.isReady();
  if (!oracleReady) {
    const lastUpdatedAt = await oracle.lastUpdatedAt();
    const pendingFirstObservation = lastUpdatedAt === 0n;
    if (!pendingFirstObservation || process.env.ALLOW_PENDING_ORACLE_BOOTSTRAP !== 'yes') {
      throw new Error('Oracle is not initialized or its price is stale');
    }
    console.warn(
      `WARNING: mining will be deployed before the first TWAP publication; orders stay blocked until ${await oracle.nextUpdateAt()}`
    );
  }
  if ((await oracle.gpc()).toLowerCase() !== GPC.toLowerCase()) throw new Error('Oracle GPC mismatch');
  if ((await oracle.wbnb()).toLowerCase() !== WBNB.toLowerCase()) throw new Error('Oracle WBNB mismatch');
  if ((await oracle.usdt()).toLowerCase() !== USDT.toLowerCase()) throw new Error('Oracle USDT mismatch');

  const oracleAdminAddress = await upgrades.erc1967.getAdminAddress(process.env.ORACLE_ADDRESS);
  const oracleImplementation = await upgrades.erc1967.getImplementationAddress(process.env.ORACLE_ADDRESS);
  if (oracleAdminAddress === ethers.ZeroAddress || oracleImplementation === ethers.ZeroAddress) {
    throw new Error('ORACLE_ADDRESS is not a valid ERC-1967 proxy');
  }
  const oracleAdmin = new ethers.Contract(
    oracleAdminAddress,
    ['function owner() view returns (address)'],
    ethers.provider
  );
  const oracleAdminOwner = await oracleAdmin.owner();
  if (oracleAdminOwner.toLowerCase() !== adminOwner.toLowerCase()) {
    throw new Error('Oracle ProxyAdmin is not controlled by the current deployer');
  }

  const router = new ethers.Contract(
    ROUTER,
    ['function factory() view returns (address)'],
    ethers.provider
  );
  const factory = new ethers.Contract(
    await router.factory(),
    ['function getPair(address,address) view returns (address)'],
    ethers.provider
  );
  const expectedGpcPair = await factory.getPair(GPC, WBNB);
  const expectedUsdtPair = await factory.getPair(WBNB, USDT);
  if ((await oracle.gpcWbnbPair()).toLowerCase() !== expectedGpcPair.toLowerCase()) {
    throw new Error('Oracle GPC/WBNB pair mismatch');
  }
  if ((await oracle.wbnbUsdtPair()).toLowerCase() !== expectedUsdtPair.toLowerCase()) {
    throw new Error('Oracle WBNB/USDT pair mismatch');
  }

  const Mining = await ethers.getContractFactory('GpcMining');
  const mining = await upgrades.deployProxy(Mining, [process.env.ORACLE_ADDRESS, adminOwner], {
    kind: 'transparent',
    initializer: 'initialize',
    initialOwner: adminOwner
  });
  await mining.waitForDeployment();
  const proxyAddress = await mining.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  const adminAddress = await upgrades.erc1967.getAdminAddress(proxyAddress);

  console.log('GpcMining proxy:', proxyAddress);
  console.log('GpcMining implementation:', implementationAddress);
  console.log('ProxyAdmin:', adminAddress);
  console.log('ProxyAdmin owner:', adminOwner);
  console.log('WARNING: ProxyAdmin and business owner are temporarily controlled by the deployer EOA');
  console.log('Operation wallet:', await mining.operationWallet());
  console.log('Oracle:', await mining.oracle());
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
