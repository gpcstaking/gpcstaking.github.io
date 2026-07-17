const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');
const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');

const e = ethers.parseEther;
const orderArgs = (deadline, minGpc = 0n, minWbnb = 0n, minLpGpc = 0n, minLpWbnb = 0n) => [
  deadline,
  minGpc,
  minWbnb,
  minLpGpc,
  minLpWbnb
];

describe('GpcMiningCore', function () {
  async function deployFixture() {
    const signers = await ethers.getSigners();
    const [deployer, operation, alice, bob, carol] = signers;

    const Token = await ethers.getContractFactory('MockERC20');
    const usdt = await Token.deploy('USDT', 'USDT');
    const gpc = await Token.deploy('GPC', 'GPC');
    const wbnb = await Token.deploy('WBNB', 'WBNB');

    const Oracle = await ethers.getContractFactory('MockOracle');
    const oracle = await Oracle.deploy(e('0.1'), e('500'));

    const Pair = await ethers.getContractFactory('MockPair');
    const gpcPair = await Pair.deploy(gpc.target, wbnb.target, e('10000'), e('2'));
    const usdtPair = await Pair.deploy(usdt.target, wbnb.target, e('50000'), e('100'));
    const Factory = await ethers.getContractFactory('MockFactory');
    const factory = await Factory.deploy();
    await factory.setPair(gpc.target, wbnb.target, gpcPair.target);
    await factory.setPair(usdt.target, wbnb.target, usdtPair.target);

    const Router = await ethers.getContractFactory('MockRouter');
    const router = await Router.deploy(factory.target);
    await router.setRate(usdt.target, gpc.target, e('10'));
    await router.setRate(usdt.target, wbnb.target, e('0.002'));

    const Mining = await ethers.getContractFactory('GpcMiningHarness');
    const mining = await upgrades.deployProxy(
      Mining,
      [
        usdt.target,
        gpc.target,
        wbnb.target,
        router.target,
        oracle.target,
        operation.address,
        deployer.address
      ],
      { kind: 'transparent', initializer: 'initialize' }
    );
    await mining.waitForDeployment();

    for (const signer of signers.slice(2, 12)) {
      await usdt.mint(signer.address, e('20000'));
      await usdt.connect(signer).approve(mining.target, ethers.MaxUint256);
    }

    async function bindAndOrder(user, parent) {
      await mining.connect(user).bindReferral(parent.address);
      const deadline = (await time.latest()) + 300;
      return mining.connect(user).placeOrder(...orderArgs(deadline));
    }

    return {
      signers,
      deployer,
      operation,
      alice,
      bob,
      carol,
      usdt,
      gpc,
      wbnb,
      oracle,
      router,
      gpcPair,
      usdtPair,
      mining,
      bindAndOrder
    };
  }

  it('splits a 1,000 USDT order, adds GPC/WBNB LP and credits power', async function () {
    const { operation, alice, bob, usdt, router, mining, bindAndOrder } = await loadFixture(deployFixture);

    await bindAndOrder(alice, operation);

    const aliceInfo = await mining.users(alice.address);
    expect(aliceInfo.power).to.equal(e('2000'));
    expect(aliceInfo.totalPowerPurchased).to.equal(e('2000'));
    expect(aliceInfo.promotionQuota).to.equal(e('1000'));
    expect(await mining.totalPower()).to.equal(e('2000'));
    expect(await mining.miningPoolGpc()).to.equal(e('6500'));
    expect(await usdt.balanceOf(operation.address)).to.equal(e('250'));
    expect(await router.lpToken().then(address => ethers.getContractAt('MockERC20', address)).then(lp => lp.balanceOf(operation.address))).to.equal(e('0.1'));

    await bindAndOrder(bob, alice);
    expect(await usdt.balanceOf(alice.address)).to.equal(e('19200')); // 20,000 - 1,000 + 200
    expect((await mining.users(alice.address)).promotionQuota).to.equal(e('800'));
    expect(await mining.miningPoolGpc()).to.equal(e('13000'));
  });

  it('runs behind a transparent proxy and preserves state across an upgrade', async function () {
    const { deployer, operation, alice, usdt, gpc, wbnb, router, oracle, mining, bindAndOrder } = await loadFixture(deployFixture);

    const implementationBefore = await upgrades.erc1967.getImplementationAddress(mining.target);
    const proxyAdmin = await upgrades.erc1967.getAdminAddress(mining.target);
    expect(implementationBefore).to.not.equal(ethers.ZeroAddress);
    expect(proxyAdmin).to.not.equal(ethers.ZeroAddress);
    expect(await mining.owner()).to.equal(deployer.address);

    const implementation = await ethers.getContractAt('GpcMiningHarness', implementationBefore);
    await expect(implementation.initialize(
      usdt.target,
      gpc.target,
      wbnb.target,
      router.target,
      oracle.target,
      operation.address,
      deployer.address
    )).to.be.revertedWith('Initializable: contract is already initialized');

    await bindAndOrder(alice, operation);
    const userBefore = await mining.users(alice.address);

    const MiningV2 = await ethers.getContractFactory('GpcMiningHarnessV2', deployer);
    const upgraded = await upgrades.upgradeProxy(mining.target, MiningV2, { kind: 'transparent' });
    await upgraded.waitForDeployment();

    expect(await upgraded.implementationVersion()).to.equal(2);
    expect(await upgrades.erc1967.getImplementationAddress(mining.target)).to.not.equal(implementationBefore);
    expect((await upgraded.users(alice.address)).power).to.equal(userBefore.power);
    expect(await upgraded.parentOf(alice.address)).to.equal(operation.address);
    expect(await upgraded.owner()).to.equal(deployer.address);
  });

  it('passes OpenZeppelin validation for the mainnet transparent-proxy implementation', async function () {
    const Mining = await ethers.getContractFactory('GpcMining');
    await upgrades.validateImplementation(Mining, { kind: 'transparent' });
  });

  it('redirects the direct reward when the parent has no promotion quota', async function () {
    const { operation, alice, usdt, mining, bindAndOrder } = await loadFixture(deployFixture);

    await expect(bindAndOrder(alice, operation))
      .to.emit(mining, 'OrderPlaced')
      .withArgs(alice.address, operation.address, operation.address, e('7000'), e('6500'), e('500'), e('0.1'), e('0.1'));
    expect(await usdt.balanceOf(operation.address)).to.equal(e('250'));
  });

  it('calculates fixed static and small-area rewards without level differences', async function () {
    const { operation, alice, bob, carol, gpc, oracle, mining, bindAndOrder } = await loadFixture(deployFixture);

    await bindAndOrder(alice, operation);
    await bindAndOrder(bob, alice);
    await bindAndOrder(carol, alice);
    await oracle.setPrices(e('0.1'), e('500'));

    const community = await mining.communityPower(alice.address);
    expect(community.total).to.equal(e('4000'));
    expect(community.largestBranchPower).to.equal(e('2000'));
    expect(community.smallArea).to.equal(e('2000'));
    expect(community.effectiveSmallArea).to.equal(e('2000'));

    const quote = await mining.quoteRewards(alice.address);
    expect(quote.poolLimitedMode).to.equal(false);
    expect(quote.staticRewardUsdt).to.equal(e('5'));
    expect(quote.communityRewardUsdt).to.equal(e('0.25'));
    expect(quote.totalRewardUsdt).to.equal(e('5.25'));
    expect(quote.grossGpc).to.equal(e('52.5'));

    await time.increase(24 * 60 * 60);
    await expect(mining.connect(alice).withdraw()).to.emit(mining, 'Withdrawn');
    expect(await gpc.balanceOf(alice.address)).to.equal(e('47.25'));
    expect(await gpc.balanceOf(operation.address)).to.equal(e('5.25'));
    expect((await mining.users(alice.address)).power).to.equal(e('1994.75'));
  });

  it('uses the 1% pool formula below the threshold and allows exactly 1% of the pool', async function () {
    const { operation, alice, gpc, oracle, gpcPair, mining, bindAndOrder } = await loadFixture(deployFixture);

    await bindAndOrder(alice, operation);
    await oracle.setPrices(e('0.05'), e('500'));
    await gpcPair.setReserves(e('10000'), e('1'));
    const quote = await mining.quoteRewards(alice.address);
    expect(quote.poolLimitedMode).to.equal(true);
    expect(quote.staticRewardUsdt).to.equal(e('3.25'));
    expect(quote.grossGpc).to.equal(e('65'));
    expect(quote.grossGpc * 100n).to.equal((await mining.miningPoolGpc()));

    await time.increase(24 * 60 * 60);
    await mining.connect(alice).withdraw();
    expect(await gpc.balanceOf(alice.address)).to.equal(e('58.5'));
  });

  it('does not accrue missed days and resets the 24-hour timer after each order', async function () {
    const { operation, alice, oracle, mining, bindAndOrder } = await loadFixture(deployFixture);

    await bindAndOrder(alice, operation);
    await oracle.setPrices(e('1'), e('500'));
    const firstQuote = await mining.quoteRewards(alice.address);
    await time.increase(10 * 24 * 60 * 60);
    const lateQuote = await mining.quoteRewards(alice.address);
    expect(lateQuote.totalRewardUsdt).to.equal(firstQuote.totalRewardUsdt);

    await oracle.setPrices(e('0.1'), e('500'));
    await mining.connect(alice).placeOrder(...orderArgs((await time.latest()) + 300));
    await expect(mining.connect(alice).withdraw()).to.be.revertedWithCustomError(mining, 'WithdrawCooldownActive');
  });

  it('does not reset the 180-day inactivity clock when power is added', async function () {
    const { operation, alice, mining, bindAndOrder } = await loadFixture(deployFixture);

    await bindAndOrder(alice, operation);
    await time.increase(179 * 24 * 60 * 60);
    await mining.connect(alice).placeOrder(...orderArgs((await time.latest()) + 300));
    expect((await mining.users(alice.address)).power).to.equal(e('4000'));

    await time.increase(24 * 60 * 60);
    expect(await mining.isExpired(alice.address)).to.equal(true);
    await expect(mining.connect(alice).withdraw())
      .to.emit(mining, 'PowerExpired')
      .withArgs(alice.address, e('4000'), anyValue);
    expect((await mining.users(alice.address)).power).to.equal(0);
  });

  it('rejects unsafe swap output relative to the six-hour oracle', async function () {
    const { operation, alice, usdt, gpc, router, mining } = await loadFixture(deployFixture);
    await mining.connect(alice).bindReferral(operation.address);
    await router.setRate(usdt.target, gpc.target, e('9'));

    await expect(mining.connect(alice).placeOrder(...orderArgs((await time.latest()) + 300))).to.be.revertedWith('INSUFFICIENT_OUTPUT');
  });

  it('enforces a maximum referral depth of 30', async function () {
    const { signers, operation, mining } = await loadFixture(deployFixture);
    let parent = operation;
    for (const signer of signers.slice(2, 32)) {
      await mining.connect(signer).bindReferral(parent.address);
      parent = signer;
    }
    await expect(mining.connect(signers[32]).bindReferral(parent.address))
      .to.be.revertedWithCustomError(mining, 'ReferralDepthExceeded');
  });

  it('updates the largest branch when a branch is removed by inactivity expiry', async function () {
    const { operation, alice, bob, carol, mining, bindAndOrder } = await loadFixture(deployFixture);
    await bindAndOrder(alice, operation);
    await bindAndOrder(bob, alice);
    await time.increase(61);
    await mining.connect(bob).placeOrder(...orderArgs((await time.latest()) + 300));
    await bindAndOrder(carol, alice);

    let community = await mining.communityPower(alice.address);
    expect(community.total).to.equal(e('6000'));
    expect(community.largestBranchPower).to.equal(e('4000'));
    expect(community.smallArea).to.equal(e('2000'));

    await time.increase(180 * 24 * 60 * 60);
    await mining.expireUsers([bob.address]);
    community = await mining.communityPower(alice.address);
    expect(community.total).to.equal(e('2000'));
    expect(community.largestBranchPower).to.equal(e('2000'));
    expect(community.smallArea).to.equal(0);
  });

  it('enforces a user minimum output above the public TWAP floor', async function () {
    const { operation, alice, mining } = await loadFixture(deployFixture);
    await mining.connect(alice).bindReferral(operation.address);

    const deadline = (await time.latest()) + 300;
    await expect(
      mining.connect(alice).placeOrder(...orderArgs(deadline, e('7001')))
    ).to.be.revertedWith('INSUFFICIENT_OUTPUT');
  });

  it('accepts stricter user swap and LP minimums when execution satisfies them', async function () {
    const { operation, alice, mining } = await loadFixture(deployFixture);
    await mining.connect(alice).bindReferral(operation.address);

    await expect(
      mining.connect(alice).placeOrder(
        ...orderArgs((await time.latest()) + 300, e('6999'), e('0.099'), e('490'), e('0.098'))
      )
    ).to.emit(mining, 'OrderPlaced');
  });

  it('keeps a one-argument BscScan order entry with contract-level MEV bounds', async function () {
    const { operation, alice, mining } = await loadFixture(deployFixture);
    await mining.connect(alice).bindReferral(operation.address);

    await expect(
      mining.connect(alice)['placeOrder(uint256)']((await time.latest()) + 300)
    ).to.emit(mining, 'OrderPlaced');
  });

  it('rejects an order when the spot price deviates over 1% from the TWAP', async function () {
    const { operation, alice, gpcPair, gpc, mining } = await loadFixture(deployFixture);
    await mining.connect(alice).bindReferral(operation.address);
    await gpcPair.setReserves(e('10000'), e('2.2'));

    await expect(
      mining.connect(alice).placeOrder(...orderArgs((await time.latest()) + 300))
    ).to.be.revertedWithCustomError(mining, 'SpotTwapDeviationTooHigh')
      .withArgs(gpc.target, e('0.11'), e('0.1'));
  });

  it('also rejects a manipulated WBNB/USDT spot price', async function () {
    const { operation, alice, gpcPair, usdtPair, wbnb, mining } = await loadFixture(deployFixture);
    await mining.connect(alice).bindReferral(operation.address);
    await gpcPair.setReserves(e('10000'), e('1.960784313725490196'));
    await usdtPair.setReserves(e('51000'), e('100'));

    await expect(
      mining.connect(alice).placeOrder(...orderArgs((await time.latest()) + 300))
    ).to.be.revertedWithCustomError(mining, 'SpotTwapDeviationTooHigh')
      .withArgs(wbnb.target, e('510'), e('500'));
  });

  it('rejects withdrawal when the current spot price diverges from the TWAP', async function () {
    const { operation, alice, gpcPair, oracle, mining, bindAndOrder } = await loadFixture(deployFixture);
    await bindAndOrder(alice, operation);
    await time.increase(24 * 60 * 60);
    await oracle.setPrices(e('0.1'), e('500'));
    await gpcPair.setReserves(e('10000'), e('2.2'));

    await expect(mining.connect(alice).withdraw())
      .to.be.revertedWithCustomError(mining, 'SpotTwapDeviationTooHigh');
  });

  it('limits aggregate withdrawals to 5% of the window-opening pool', async function () {
    const { operation, alice, oracle, mining, bindAndOrder } = await loadFixture(deployFixture);
    await bindAndOrder(alice, operation);
    await oracle.setPrices(e('0.1'), e('500'));
    await time.increase(24 * 60 * 60);
    const poolBase = await mining.miningPoolGpc();
    const windowLimit = poolBase * 500n / 10_000n;
    await mining.setWithdrawWindowForTest(await time.latest(), poolBase, windowLimit);

    await expect(mining.connect(alice).withdraw())
      .to.be.revertedWithCustomError(mining, 'GlobalWithdrawLimitExceeded');
  });

  it('blocks expiry processing while the protocol is paused', async function () {
    const { deployer, operation, alice, mining, bindAndOrder } = await loadFixture(deployFixture);
    await bindAndOrder(alice, operation);
    await mining.connect(deployer).pause();
    await time.increase(180 * 24 * 60 * 60);

    await expect(mining.expireUsers([alice.address])).to.be.revertedWith('Pausable: paused');
  });
});

const anyValue = require('@nomicfoundation/hardhat-chai-matchers/withArgs').anyValue;
