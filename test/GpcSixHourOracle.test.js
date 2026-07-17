const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');

describe('GpcSixHourOracle', function () {
  async function deployFixture() {
    const Token = await ethers.getContractFactory('MockERC20');
    const gpc = await Token.deploy('GPC', 'GPC');
    const wbnb = await Token.deploy('WBNB', 'WBNB');
    const usdt = await Token.deploy('USDT', 'USDT');

    const Pair = await ethers.getContractFactory('MockPair');
    // 10,000 GPC : 10 WBNB = 0.001 WBNB/GPC.
    const gpcPair = await Pair.deploy(gpc.target, wbnb.target, ethers.parseEther('10000'), ethers.parseEther('10'));
    // 100 WBNB : 50,000 USDT = 500 USDT/WBNB.
    const usdtPair = await Pair.deploy(wbnb.target, usdt.target, ethers.parseEther('100'), ethers.parseEther('50000'));

    const Factory = await ethers.getContractFactory('MockFactory');
    const factory = await Factory.deploy();
    await factory.setPair(gpc.target, wbnb.target, gpcPair.target);
    await factory.setPair(wbnb.target, usdt.target, usdtPair.target);

    const Router = await ethers.getContractFactory('MockOracleRouter');
    const router = await Router.deploy(factory.target);

    const Oracle = await ethers.getContractFactory('GpcSixHourOracleHarness');
    const oracle = await upgrades.deployProxy(
      Oracle,
      [router.target, gpc.target, wbnb.target, usdt.target],
      { kind: 'transparent', initializer: 'initialize' }
    );
    await oracle.waitForDeployment();
    return { oracle, router, gpc, wbnb, usdt };
  }

  it('publishes a six-hour cumulative TWAP and rejects early updates', async function () {
    const { oracle } = await loadFixture(deployFixture);
    await expect(oracle.price()).to.be.revertedWithCustomError(oracle, 'PriceUnavailable');
    await expect(oracle.update()).to.be.revertedWithCustomError(oracle, 'ObservationTooYoung');

    await time.increase(6 * 60 * 60);
    await expect(oracle.update()).to.emit(oracle, 'OracleUpdated');
    expect(await oracle.isReady()).to.equal(true);
    expect(await oracle.price()).to.be.closeTo(ethers.parseEther('0.5'), 1_000n);
    expect(await oracle.bnbPrice()).to.be.closeTo(ethers.parseEther('500'), 1_000n);
  });

  it('stops serving a stale price until a new cumulative period is finalized', async function () {
    const { oracle } = await loadFixture(deployFixture);
    await time.increase(6 * 60 * 60);
    await oracle.update();
    await time.increase(12 * 60 * 60 + 1);

    await expect(oracle.price()).to.be.revertedWithCustomError(oracle, 'PriceStale');
    await expect(oracle.update()).to.emit(oracle, 'ObservationReset');
    expect(await oracle.isReady()).to.equal(false);
    await expect(oracle.price()).to.be.revertedWithCustomError(oracle, 'PriceUnavailable');

    await time.increase(6 * 60 * 60);
    await oracle.update();
    expect(await oracle.isReady()).to.equal(true);
  });

  it('preserves cumulative observations and published prices across an upgrade', async function () {
    const { oracle, router, gpc, wbnb, usdt } = await loadFixture(deployFixture);
    await time.increase(6 * 60 * 60);
    await oracle.update();

    const cumulativeBefore = await oracle.lastGpcWbnbCumulative();
    const observationBefore = await oracle.lastObservationTimestamp();
    const updatedAtBefore = await oracle.lastUpdatedAt();
    const priceBefore = await oracle.price();
    const implementationBefore = await upgrades.erc1967.getImplementationAddress(oracle.target);

    const implementation = await ethers.getContractAt('GpcSixHourOracleHarness', implementationBefore);
    await expect(
      implementation.initialize(router.target, gpc.target, wbnb.target, usdt.target)
    ).to.be.revertedWith('Initializable: contract is already initialized');

    const OracleV2 = await ethers.getContractFactory('GpcSixHourOracleHarnessV2');
    const upgraded = await upgrades.upgradeProxy(oracle.target, OracleV2, { kind: 'transparent' });
    await upgraded.waitForDeployment();

    expect(await upgraded.implementationVersion()).to.equal(2);
    expect(await upgraded.lastGpcWbnbCumulative()).to.equal(cumulativeBefore);
    expect(await upgraded.lastObservationTimestamp()).to.equal(observationBefore);
    expect(await upgraded.lastUpdatedAt()).to.equal(updatedAtBefore);
    expect(await upgraded.price()).to.equal(priceBefore);
    expect(await upgrades.erc1967.getImplementationAddress(oracle.target)).to.not.equal(implementationBefore);
  });

  it('passes OpenZeppelin validation for the mainnet oracle implementation', async function () {
    const Oracle = await ethers.getContractFactory('GpcMainnetOracle');
    await upgrades.validateImplementation(Oracle, { kind: 'transparent' });
  });
});
