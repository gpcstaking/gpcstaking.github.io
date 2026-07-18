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

    const History = await ethers.getContractFactory('GpcHistoryRegistry');
    const history = await upgrades.deployProxy(
      History,
      [mining.target, deployer.address],
      { kind: 'transparent', initializer: 'initialize' }
    );
    await history.waitForDeployment();
    await mining.initializeHistoryTracking(history.target);

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
      history,
      bindAndOrder
    };
  }

  it('splits a 1 USDT test order, adds GPC/WBNB LP and credits power', async function () {
    const { operation, alice, bob, usdt, router, mining, bindAndOrder } = await loadFixture(deployFixture);

    await bindAndOrder(alice, operation);

    const aliceInfo = await mining.users(alice.address);
    expect(aliceInfo.power).to.equal(e('2'));
    expect(aliceInfo.totalPowerPurchased).to.equal(e('2'));
    expect(aliceInfo.promotionQuota).to.equal(e('1'));
    expect(await mining.totalPower()).to.equal(e('2'));
    expect(await mining.miningPoolGpc()).to.equal(e('6.5'));
    expect(await usdt.balanceOf(operation.address)).to.equal(e('0.25'));
    expect(await router.lpToken().then(address => ethers.getContractAt('MockERC20', address)).then(lp => lp.balanceOf(operation.address))).to.equal(e('0.0001'));

    await bindAndOrder(bob, alice);
    expect(await usdt.balanceOf(alice.address)).to.equal(e('19999.2')); // 20,000 - 1 + 0.2
    expect((await mining.users(alice.address)).promotionQuota).to.equal(e('0.8'));
    expect(await mining.miningPoolGpc()).to.equal(e('13'));
  });

  it('allows the referral-root node to order based on topology and keeps its sponsorless share in operations', async function () {
    const { operation, usdt, mining } = await loadFixture(deployFixture);

    await usdt.mint(operation.address, e('10'));
    await usdt.connect(operation).approve(mining.target, e('1'));

    await expect(
      mining.connect(operation).placeOrder(...orderArgs((await time.latest()) + 300))
    ).to.emit(mining, 'OrderPlaced')
      .withArgs(
        operation.address,
        mining.target,
        operation.address,
        e('7'),
        e('6.5'),
        e('0.5'),
        e('0.0001'),
        e('0.0001')
      );

    const rootInfo = await mining.users(operation.address);
    expect(rootInfo.power).to.equal(e('2'));
    expect(rootInfo.promotionQuota).to.equal(e('1'));
    expect(await usdt.balanceOf(operation.address)).to.equal(e('9.25'));
    expect(await mining.totalPower()).to.equal(e('2'));
    expect(await mining.teamPower(operation.address)).to.equal(0);
    expect(await mining.expiryQueueSize()).to.equal(1);
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
      .withArgs(alice.address, operation.address, operation.address, e('7'), e('6.5'), e('0.5'), e('0.0001'), e('0.0001'));
    expect(await usdt.balanceOf(operation.address)).to.equal(e('0.25'));
  });

  it('calculates test-stage fixed static and small-area rewards without level differences', async function () {
    const { operation, alice, bob, carol, gpc, oracle, mining, history, bindAndOrder } = await loadFixture(deployFixture);

    await bindAndOrder(alice, operation);
    await bindAndOrder(bob, alice);
    await bindAndOrder(carol, alice);
    await oracle.setPrices(e('0.1'), e('500'));

    const community = await mining.communityPower(alice.address);
    expect(community.total).to.equal(e('4'));
    expect(community.largestBranchPower).to.equal(e('2'));
    expect(community.smallArea).to.equal(e('2'));
    expect(community.effectiveSmallArea).to.equal(e('2'));

    const quote = await mining.quoteRewards(alice.address);
    expect(quote.poolLimitedMode).to.equal(false);
    expect(quote.staticRewardUsdt).to.equal(e('0.005'));
    expect(quote.communityRewardUsdt).to.equal(e('0.00025'));
    expect(quote.totalRewardUsdt).to.equal(e('0.00525'));
    expect(quote.grossGpc).to.equal(e('0.0525'));

    await time.increase(24 * 60 * 60);
    await expect(mining.connect(alice).withdraw()).to.emit(mining, 'Withdrawn');
    expect(await gpc.balanceOf(alice.address)).to.equal(e('0.04725'));
    expect(await gpc.balanceOf(operation.address)).to.equal(e('0.00525'));
    expect((await mining.users(alice.address)).power).to.equal(e('1.99475'));
    expect(await mining.communityClaimedToday(alice.address)).to.equal(e('0.00025'));
    const storedCommunityEarnings = await mining.dailyCommunityEarnings(alice.address);
    expect(storedCommunityEarnings.rewardUsdt).to.equal(e('0.00025'));
    expect(storedCommunityEarnings.day).to.be.greaterThan(0);

    const [powerHistory, powerHistoryTotal] = await history.powerHistory(alice.address, 0, 30);
    expect(powerHistoryTotal).to.equal(2);
    expect(powerHistory[0].kind).to.equal(await history.POWER_HISTORY_WITHDRAW());
    expect(powerHistory[0].amount).to.equal(e('0.00525'));
    expect(powerHistory[1].kind).to.equal(await history.POWER_HISTORY_ORDER());
    expect(powerHistory[1].amount).to.equal(e('2'));

    const [quotaHistory, quotaHistoryTotal] = await history.promotionQuotaHistory(alice.address, 0, 30);
    expect(quotaHistoryTotal).to.equal(3);
    expect(quotaHistory.map(record => record.kind)).to.deep.equal([2n, 2n, 1n]);
    expect(quotaHistory.map(record => record.amount)).to.deep.equal([e('0.2'), e('0.2'), e('1')]);

    await time.increase(24 * 60 * 60);
    expect(await mining.communityClaimedToday(alice.address)).to.equal(0);
  });

  it('migrates pre-upgrade histories once and serves them newest first', async function () {
    const { deployer, alice, history } = await loadFixture(deployFixture);
    const startedAt = await history.trackingStartedAt();
    const firstTimestamp = startedAt - 2n;
    const secondTimestamp = startedAt - 1n;

    await expect(history.connect(deployer).migrateHistories(
      alice.address,
      [[e('2'), firstTimestamp, 1]],
      [[e('1'), firstTimestamp, 1], [e('0.2'), secondTimestamp, 2]]
    )).to.emit(history, 'HistoryMigrated').withArgs(alice.address, 1, 2);

    const [powerRecords, powerTotal] = await history.powerHistory(alice.address, 0, 30);
    expect(powerTotal).to.equal(1);
    expect(powerRecords[0].amount).to.equal(e('2'));
    expect(powerRecords[0].timestamp).to.equal(firstTimestamp);

    const [quotaRecords, quotaTotal] = await history.promotionQuotaHistory(alice.address, 0, 30);
    expect(quotaTotal).to.equal(2);
    expect(quotaRecords[0].amount).to.equal(e('0.2'));
    expect(quotaRecords[1].amount).to.equal(e('1'));
    await expect(history.connect(deployer).migrateHistories(alice.address, [], []))
      .to.be.revertedWithCustomError(history, 'HistoryAlreadyMigrated');
  });

  it('keeps only the latest 30 packed history records', async function () {
    const { operation, alice, mining, history, bindAndOrder } = await loadFixture(deployFixture);
    await bindAndOrder(alice, operation);
    const firstOrder = (await history.powerHistory(alice.address, 0, 1))[0][0];

    for (let i = 1; i < 31; ++i) {
      await time.increase(61);
      await mining.connect(alice).placeOrder(...orderArgs((await time.latest()) + 300));
    }

    const [powerRecords, powerTotal] = await history.powerHistory(alice.address, 0, 30);
    const [quotaRecords, quotaTotal] = await history.promotionQuotaHistory(alice.address, 0, 30);
    expect(powerTotal).to.equal(30);
    expect(quotaTotal).to.equal(30);
    expect(powerRecords).to.have.length(30);
    expect(quotaRecords).to.have.length(30);
    expect(powerRecords[29].timestamp).to.be.greaterThan(firstOrder.timestamp);
    expect(powerRecords.every(record => record.kind === 1n)).to.equal(true);
    expect(quotaRecords.every(record => record.kind === 1n)).to.equal(true);
  });

  it('only lets the configured mining proxy append live history and preserves records across upgrades', async function () {
    const { deployer, operation, alice, history, bindAndOrder } = await loadFixture(deployFixture);
    await bindAndOrder(alice, operation);
    await expect(history.connect(alice).appendPower(alice.address, e('2'), 1))
      .to.be.revertedWithCustomError(history, 'UnauthorizedWriter');

    const implementationBefore = await upgrades.erc1967.getImplementationAddress(history.target);
    const HistoryV2 = await ethers.getContractFactory('GpcHistoryRegistryV2', deployer);
    const upgraded = await upgrades.upgradeProxy(history.target, HistoryV2, { kind: 'transparent' });
    await upgraded.waitForDeployment();

    expect(await upgraded.implementationVersion()).to.equal(2);
    expect(await upgrades.erc1967.getImplementationAddress(history.target)).to.not.equal(implementationBefore);
    expect(await upgraded.writer()).to.equal(await history.writer());
    expect((await upgraded.powerHistory(alice.address, 0, 30))[1]).to.equal(1);
  });

  it('passes OpenZeppelin validation for the history transparent-proxy implementation', async function () {
    const History = await ethers.getContractFactory('GpcHistoryRegistry');
    await upgrades.validateImplementation(History, { kind: 'transparent' });
  });

  it('burns the entire community reward when effective small-area power is below the small area', async function () {
    const { signers, operation, alice, oracle, mining, bindAndOrder } = await loadFixture(deployFixture);

    await bindAndOrder(alice, operation);
    for (const child of signers.slice(3, 10)) {
      await bindAndOrder(child, alice);
    }
    await oracle.setPrices(e('0.1'), e('500'));

    const community = await mining.communityPower(alice.address);
    expect(community.total).to.equal(e('14'));
    expect(community.largestBranchPower).to.equal(e('2'));
    expect(community.smallArea).to.equal(e('12'));
    expect(community.effectiveSmallArea).to.equal(e('10'));

    const quote = await mining.quoteRewards(alice.address);
    expect(quote.poolLimitedMode).to.equal(false);
    expect(quote.staticRewardUsdt).to.equal(e('0.005'));
    expect(quote.communityRewardUsdt).to.equal(0);
    expect(quote.totalRewardUsdt).to.equal(e('0.005'));
  });

  it('pays the community reward when effective small-area power covers the full small area', async function () {
    const { signers, operation, alice, oracle, mining, bindAndOrder } = await loadFixture(deployFixture);

    await bindAndOrder(alice, operation);
    for (const child of signers.slice(3, 9)) {
      await bindAndOrder(child, alice);
    }
    await oracle.setPrices(e('0.1'), e('500'));

    const community = await mining.communityPower(alice.address);
    expect(community.smallArea).to.equal(e('10'));
    expect(community.effectiveSmallArea).to.equal(e('10'));

    const quote = await mining.quoteRewards(alice.address);
    expect(quote.communityRewardUsdt).to.equal(e('0.00125'));
    expect(quote.totalRewardUsdt).to.equal(e('0.00625'));
  });

  it('uses the 1% pool formula below the threshold and allows exactly 1% of the pool', async function () {
    const { operation, alice, gpc, oracle, gpcPair, mining, bindAndOrder } = await loadFixture(deployFixture);

    await bindAndOrder(alice, operation);
    await oracle.setPrices(e('0.05'), e('500'));
    await gpcPair.setReserves(e('10000'), e('1'));
    const quote = await mining.quoteRewards(alice.address);
    expect(quote.poolLimitedMode).to.equal(true);
    expect(quote.staticRewardUsdt).to.equal(e('0.00325'));
    expect(quote.grossGpc).to.equal(e('0.065'));
    expect(quote.grossGpc * 100n).to.equal((await mining.miningPoolGpc()));

    await time.increase(24 * 60 * 60);
    await mining.connect(alice).withdraw();
    expect(await gpc.balanceOf(alice.address)).to.equal(e('0.0585'));
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
    expect((await mining.users(alice.address)).power).to.equal(e('4'));

    await time.increase(24 * 60 * 60);
    expect(await mining.isExpired(alice.address)).to.equal(true);
    await expect(mining.connect(alice).withdraw())
      .to.emit(mining, 'PowerExpired')
      .withArgs(alice.address, e('4'), anyValue);
    expect((await mining.users(alice.address)).power).to.equal(0);
  });

  it('registers order users and expires the due heap head without caller-supplied addresses', async function () {
    const { operation, alice, bob, mining, bindAndOrder } = await loadFixture(deployFixture);

    await bindAndOrder(alice, operation);
    const aliceStartedAt = (await mining.users(alice.address)).inactivityStartedAt;
    await time.increase(10 * 24 * 60 * 60);
    await bindAndOrder(bob, operation);
    const bobStartedAt = (await mining.users(bob.address)).inactivityStartedAt;

    expect(await mining.expiryQueueSize()).to.equal(2);
    expect(await mining.expiryQueueUser(0)).to.equal(alice.address);
    expect(await mining.nextExpiryAt()).to.equal(aliceStartedAt + 180n * 24n * 60n * 60n);

    await time.increase(170 * 24 * 60 * 60);
    await expect(mining.expireDueUsers())
      .to.emit(mining, 'PowerExpired')
      .withArgs(alice.address, e('2'), anyValue)
      .and.to.emit(mining, 'ExpiryBatchProcessed')
      .withArgs(1, 1, bobStartedAt + 180n * 24n * 60n * 60n);

    expect((await mining.users(alice.address)).power).to.equal(0);
    expect((await mining.users(bob.address)).power).to.equal(e('2'));
    expect(await mining.expiryQueueSize()).to.equal(1);
    expect(await mining.expiryQueueUser(0)).to.equal(bob.address);
  });

  it('moves a successful withdrawal to its new inactivity expiry', async function () {
    const { operation, alice, bob, oracle, mining, bindAndOrder } = await loadFixture(deployFixture);

    await bindAndOrder(alice, operation);
    await time.increase(24 * 60 * 60);
    await bindAndOrder(bob, operation);
    await oracle.setPrices(e('0.1'), e('500'));
    await mining.connect(alice).withdraw();

    const bobStartedAt = (await mining.users(bob.address)).inactivityStartedAt;
    expect(await mining.expiryQueueUser(0)).to.equal(bob.address);
    expect(await mining.nextExpiryAt()).to.equal(bobStartedAt + 180n * 24n * 60n * 60n);
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

  it('tracks direct and total descendant node counts through 30 referral levels', async function () {
    const { operation, alice, bob, carol, mining } = await loadFixture(deployFixture);

    await mining.connect(alice).bindReferral(operation.address);
    await mining.connect(bob).bindReferral(alice.address);
    await mining.connect(carol).bindReferral(bob.address);

    expect((await mining.directReferrals(operation.address)).length).to.equal(1);
    expect((await mining.directReferrals(alice.address)).length).to.equal(1);
    expect(await mining.teamNodeCount(operation.address)).to.equal(3);
    expect(await mining.teamNodeCount(alice.address)).to.equal(2);
    expect(await mining.teamNodeCount(bob.address)).to.equal(1);
    expect(await mining.teamNodeCount(carol.address)).to.equal(0);

    // Migration calls are idempotent for nodes already counted at bind time.
    await mining.registerTeamNodeCounts([alice.address, bob.address, carol.address]);
    expect(await mining.teamNodeCount(operation.address)).to.equal(3);
    expect(await mining.teamNodeCount(alice.address)).to.equal(2);
  });

  it('updates the largest branch when a branch is removed by inactivity expiry', async function () {
    const { operation, alice, bob, carol, mining, bindAndOrder } = await loadFixture(deployFixture);
    await bindAndOrder(alice, operation);
    await bindAndOrder(bob, alice);
    await time.increase(61);
    await mining.connect(bob).placeOrder(...orderArgs((await time.latest()) + 300));
    await bindAndOrder(carol, alice);

    let community = await mining.communityPower(alice.address);
    expect(community.total).to.equal(e('6'));
    expect(community.largestBranchPower).to.equal(e('4'));
    expect(community.smallArea).to.equal(e('2'));

    await time.increase(180 * 24 * 60 * 60);
    await mining.expireUsers([bob.address]);
    community = await mining.communityPower(alice.address);
    expect(community.total).to.equal(e('2'));
    expect(community.largestBranchPower).to.equal(e('2'));
    expect(community.smallArea).to.equal(0);
  });

  it('enforces a user minimum output above the public TWAP floor', async function () {
    const { operation, alice, mining } = await loadFixture(deployFixture);
    await mining.connect(alice).bindReferral(operation.address);

    const deadline = (await time.latest()) + 300;
    await expect(
      mining.connect(alice).placeOrder(...orderArgs(deadline, e('7.001')))
    ).to.be.revertedWith('INSUFFICIENT_OUTPUT');
  });

  it('accepts stricter user swap and LP minimums when execution satisfies them', async function () {
    const { operation, alice, mining } = await loadFixture(deployFixture);
    await mining.connect(alice).bindReferral(operation.address);

    await expect(
      mining.connect(alice).placeOrder(
        ...orderArgs((await time.latest()) + 300, e('6.999'), e('0.000099'), e('0.49'), e('0.000098'))
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
