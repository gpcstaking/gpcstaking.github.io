const { ethers, upgrades } = require('hardhat');
const { guardMainnet } = require('./guard-mainnet');

async function main() {
  await guardMainnet(ethers);
  if (process.env.ALLOW_TEMPORARY_EOA_ADMIN !== 'yes') {
    throw new Error('Set ALLOW_TEMPORARY_EOA_ADMIN=yes to acknowledge temporary deployer-controlled upgrades');
  }
  const [deployer] = await ethers.getSigners();
  const adminOwner = await deployer.getAddress();
  const Oracle = await ethers.getContractFactory('GpcMainnetOracle');
  const oracle = await upgrades.deployProxy(Oracle, [], {
    kind: 'transparent',
    initializer: 'initialize',
    initialOwner: adminOwner
  });
  await oracle.waitForDeployment();
  const proxyAddress = await oracle.getAddress();
  const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);
  const adminAddress = await upgrades.erc1967.getAdminAddress(proxyAddress);

  console.log('GpcMainnetOracle proxy:', proxyAddress);
  console.log('GpcMainnetOracle implementation:', implementationAddress);
  console.log('Oracle ProxyAdmin:', adminAddress);
  console.log('ProxyAdmin owner:', adminOwner);
  console.log('WARNING: ProxyAdmin is temporarily controlled by the deployer EOA');
  console.log('First update available at:', String(await oracle.nextUpdateAt()));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
