const { ethers } = require('hardhat');
const { guardMainnet } = require('./guard-mainnet');

const MINING_DEPLOYMENT_BLOCK = 110_493_189;
const TEST_ORDER_UPGRADE_TX = '0xc61c985ee742e1fb23e6e984a029636ec384555a0cc223098b584f686981717a';
const LOG_SPAN = 50_000;

const miningEvents = new ethers.Interface([
  'event OrderPlaced(address indexed user,address indexed parent,address indexed directRewardRecipient,uint256 gpcBought,uint256 gpcAddedToPool,uint256 gpcAddedToLp,uint256 wbnbAddedToLp,uint256 liquidity)',
  'event Withdrawn(address indexed user,uint256 staticRewardUsdt,uint256 communityRewardUsdt,uint256 powerBurned,uint256 grossGpc,uint256 feeGpc,uint256 netGpc,uint256 gpcPrice)',
  'event PowerExpired(address indexed user,uint256 powerBurned,uint256 timestamp)'
]);

const historyAbi = [
  'function trackingStartedAt() view returns (uint64)',
  'function historyMigrated(address) view returns (bool)',
  'function migrateHistories(address account,(uint192 amount,uint64 timestamp,uint8 kind)[] powerRecords,(uint192 amount,uint64 timestamp,uint8 kind)[] quotaRecords)',
  'function powerHistory(address,uint256,uint256) view returns ((uint256 amount,uint64 timestamp,uint8 kind)[] records,uint256 total)',
  'function promotionQuotaHistory(address,uint256,uint256) view returns ((uint256 amount,uint64 timestamp,uint8 kind)[] records,uint256 total)'
];

async function getLogs(provider, address, topic, latestBlock) {
  async function range(fromBlock, toBlock) {
    try {
      return await provider.getLogs({ address, topics: [topic], fromBlock, toBlock });
    } catch (error) {
      if (fromBlock >= toBlock) throw error;
      const middle = Math.floor((fromBlock + toBlock) / 2);
      const left = await range(fromBlock, middle);
      const right = await range(middle + 1, toBlock);
      return [...left, ...right];
    }
  }

  const logs = [];
  for (let fromBlock = MINING_DEPLOYMENT_BLOCK; fromBlock <= latestBlock; fromBlock += LOG_SPAN) {
    logs.push(...await range(fromBlock, Math.min(fromBlock + LOG_SPAN - 1, latestBlock)));
  }
  return logs;
}

function addRecord(map, account, record) {
  const key = account.toLowerCase();
  const existing = map.get(key) || { account, power: [], quota: [] };
  existing[record.ledger].push(record.value);
  map.set(key, existing);
}

async function main() {
  await guardMainnet(ethers);
  const miningProxy = process.env.MINING_PROXY_ADDRESS;
  const registryAddress = process.env.HISTORY_REGISTRY_ADDRESS;
  if (!miningProxy || !ethers.isAddress(miningProxy)) throw new Error('MINING_PROXY_ADDRESS is invalid');
  if (!registryAddress || !ethers.isAddress(registryAddress)) throw new Error('HISTORY_REGISTRY_ADDRESS is invalid');

  const [owner] = await ethers.getSigners();
  const history = new ethers.Contract(registryAddress, historyAbi, owner);
  const trackingStartedAt = Number(await history.trackingStartedAt());
  const historyProvider = new ethers.JsonRpcProvider(
    process.env.HISTORY_RPC_URL || 'https://bsc.rpc.blxrbdn.com',
    56,
    { staticNetwork: true, batchMaxCount: 1 }
  );
  const testUpgradeReceipt = await ethers.provider.getTransactionReceipt(TEST_ORDER_UPGRADE_TX);
  if (!testUpgradeReceipt) throw new Error('Test-order upgrade transaction was not found');

  const latestBlock = await historyProvider.getBlockNumber();
  const eventNames = ['OrderPlaced', 'Withdrawn', 'PowerExpired'];
  const eventLogs = [];
  for (const name of eventNames) {
    const event = miningEvents.getEvent(name);
    eventLogs.push(...await getLogs(historyProvider, miningProxy, event.topicHash, latestBlock));
  }

  const blockNumbers = [...new Set(eventLogs.map(log => log.blockNumber))];
  const blocks = [];
  for (const number of blockNumbers) blocks.push(await historyProvider.getBlock(number));
  const timestamps = new Map(blocks.filter(Boolean).map(block => [block.number, block.timestamp]));
  const records = new Map();

  for (const log of eventLogs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index)) {
    const timestamp = timestamps.get(log.blockNumber);
    if (!timestamp || timestamp >= trackingStartedAt) continue;
    const parsed = miningEvents.parseLog(log);
    if (!parsed) continue;

    if (parsed.name === 'OrderPlaced') {
      const testOrder = log.blockNumber >= testUpgradeReceipt.blockNumber;
      const power = ethers.parseEther(testOrder ? '2' : '2000');
      const quota = ethers.parseEther(testOrder ? '1' : '1000');
      const directReward = ethers.parseEther(testOrder ? '0.2' : '200');
      addRecord(records, parsed.args.user, { ledger: 'power', value: [power, timestamp, 1] });
      addRecord(records, parsed.args.user, { ledger: 'quota', value: [quota, timestamp, 1] });
      if (String(parsed.args.parent).toLowerCase() === String(parsed.args.directRewardRecipient).toLowerCase()) {
        addRecord(records, parsed.args.parent, { ledger: 'quota', value: [directReward, timestamp, 2] });
      }
    } else if (parsed.name === 'Withdrawn') {
      addRecord(records, parsed.args.user, { ledger: 'power', value: [parsed.args.powerBurned, timestamp, 2] });
    } else if (parsed.name === 'PowerExpired') {
      addRecord(records, parsed.args.user, { ledger: 'power', value: [parsed.args.powerBurned, timestamp, 3] });
    }
  }

  const migrated = [];
  for (const entry of records.values()) {
    if (await history.historyMigrated(entry.account)) continue;
    const power = entry.power.slice(-30);
    const quota = entry.quota.slice(-30);
    const tx = await history.migrateHistories(entry.account, power, quota);
    await tx.wait();
    const [, powerTotal] = await history.powerHistory(entry.account, 0, 30);
    const [, quotaTotal] = await history.promotionQuotaHistory(entry.account, 0, 30);
    migrated.push({ account: entry.account, power: Number(powerTotal), quota: Number(quotaTotal), transaction: tx.hash });
  }

  console.log(JSON.stringify({ trackingStartedAt, scannedLogs: eventLogs.length, migrated }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
