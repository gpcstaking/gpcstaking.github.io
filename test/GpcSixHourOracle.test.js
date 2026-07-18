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

    const Oracle = await ethers.getContractFactory('GpcRollingSixHourOracleHarness');
    const oracle = await upgrades.deployProxy(
      Oracle,
      [router.target, gpc.target, wbnb.target, usdt.target],
      { kind: 'transparent', initializer: 'initialize' }
    );
    await oracle.waitForDeployment();
    return { oracle, router, gpc, wbnb, usdt, gpcPair, usdtPair };
  }

  async function recordIntervals(oracle, count) {
    for (let index = 0; index < count; index += 1) {
      await time.increase(5 * 60);
      await oracle.update();
    }
  }

  it('records five-minute points and publishes a live rolling six-hour TWAP', async function () {
    const { oracle } = await loadFixture(deployFixture);
    expect(await oracle.isReady()).to.equal(true);
    expect(await oracle.price()).to.be.closeTo(ethers.parseEther('0.5'), 1_000n);
    let [mode, windowSeconds] = await oracle.priceStatus();
    expect(mode).to.equal(0);
    expect(windowSeconds).to.equal(0);
    await expect(oracle.update()).to.be.revertedWithCustomError(oracle, 'ObservationTooYoung');

    await recordIntervals(oracle, 1);
    [mode, windowSeconds] = await oracle.priceStatus();
    expect(mode).to.equal(1);
    expect(windowSeconds).to.be.greaterThanOrEqual(300);

    await recordIntervals(oracle, 71);
    expect(await oracle.isReady()).to.equal(true);
    expect(await oracle.observationCount()).to.equal(73);
    expect(await oracle.nextUpdateAt()).to.equal((await oracle.lastObservationTimestamp()) + 300n);
    [mode, windowSeconds] = await oracle.priceStatus();
    expect(mode).to.equal(2);
    expect(windowSeconds).to.equal(6 * 60 * 60);
    expect(await oracle.price()).to.be.closeTo(ethers.parseEther('0.5'), 1_000n);
    expect(await oracle.bnbPrice()).to.be.closeTo(ethers.parseEther('500'), 1_000n);
  });

  it('uses the current cumulative price as the live final point between keeper updates', async function () {
    const { oracle, gpcPair } = await loadFixture(deployFixture);
    await recordIntervals(oracle, 72);
    const firstPrice = await oracle.price();

    await gpcPair.setReserves(ethers.parseEther('10000'), ethers.parseEther('20'));
    await time.increase(2 * 60);
    const nextPrice = await oracle.price();

    expect(nextPrice).to.be.greaterThan(firstPrice);
    expect(nextPrice).to.be.lessThan(ethers.parseEther('1'));
  });

  it('tolerates a short keeper delay and expires after thirty minutes', async function () {
    const { oracle } = await loadFixture(deployFixture);
    await recordIntervals(oracle, 72);
    await time.increase(10 * 60 + 1);

    expect(await oracle.isReady()).to.equal(true);
    expect(await oracle.price()).to.be.greaterThan(0);

    await time.increase(20 * 60);

    await expect(oracle.price()).to.be.revertedWithCustomError(oracle, 'PriceStale');
    expect(await oracle.isReady()).to.equal(false);
  });

  it('starts a clean rolling observation window during a legacy upgrade', async function () {
    const Token = await ethers.getContractFactory('MockERC20');
    const gpc = await Token.deploy('GPC', 'GPC');
    const wbnb = await Token.deploy('WBNB', 'WBNB');
    const usdt = await Token.deploy('USDT', 'USDT');
    const Pair = await ethers.getContractFactory('MockPair');
    const gpcPair = await Pair.deploy(gpc.target, wbnb.target, ethers.parseEther('10000'), ethers.parseEther('10'));
    const usdtPair = await Pair.deploy(wbnb.target, usdt.target, ethers.parseEther('100'), ethers.parseEther('50000'));
    const Factory = await ethers.getContractFactory('MockFactory');
    const factory = await Factory.deploy();
    await factory.setPair(gpc.target, wbnb.target, gpcPair.target);
    await factory.setPair(wbnb.target, usdt.target, usdtPair.target);
    const Router = await ethers.getContractFactory('MockOracleRouter');
    const router = await Router.deploy(factory.target);

    const Legacy = await ethers.getContractFactory('GpcSixHourOracleHarness');
    const oracle = await upgrades.deployProxy(
      Legacy,
      [router.target, gpc.target, wbnb.target, usdt.target],
      { kind: 'transparent', initializer: 'initialize' }
    );
    await oracle.waitForDeployment();

    const cumulativeBefore = await oracle.lastGpcWbnbCumulative();
    const observationBefore = await oracle.lastObservationTimestamp();
    const implementationBefore = await upgrades.erc1967.getImplementationAddress(oracle.target);
    await time.increase(60 * 60);

    const Rolling = await ethers.getContractFactory('GpcRollingSixHourOracleHarness');
    const upgraded = await upgrades.upgradeProxy(oracle.target, Rolling, {
      kind: 'transparent',
      call: { fn: 'initializeRollingOracle' }
    });
    await upgraded.waitForDeployment();

    expect(await upgraded.rollingInitialized()).to.equal(true);
    expect(await upgraded.observationCount()).to.equal(1);
    expect(await upgraded.lastGpcWbnbCumulative()).to.be.greaterThan(cumulativeBefore);
    expect(await upgraded.lastObservationTimestamp()).to.be.greaterThan(observationBefore);
    const firstObservation = await upgraded.observationAt(0);
    expect(firstObservation.timestamp).to.equal(await upgraded.lastObservationTimestamp());
    expect(firstObservation.gpcWbnbCumulative).to.equal(await upgraded.lastGpcWbnbCumulative());
    expect(await upgraded.isReady()).to.equal(true);
    const [mode, windowSeconds] = await upgraded.priceStatus();
    expect(mode).to.equal(0);
    expect(windowSeconds).to.equal(0);
    expect(await upgrades.erc1967.getImplementationAddress(oracle.target)).to.not.equal(implementationBefore);
  });

  it('passes OpenZeppelin validation for the mainnet oracle implementation', async function () {
    const Oracle = await ethers.getContractFactory('GpcMainnetOracle');
    await upgrades.validateImplementation(Oracle, { kind: 'transparent' });
  });
});
