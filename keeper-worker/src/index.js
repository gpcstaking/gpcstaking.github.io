import {
  createPublicClient,
  createWalletClient,
  fallback,
  formatEther,
  formatGwei,
  http,
  isAddress,
  parseAbi,
  parseEther,
  parseGwei,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

const DEFAULT_BSC_RPC_URLS = [
  "https://bsc-dataseed.binance.org",
  "https://bsc-dataseed1.binance.org",
  "https://bsc-dataseed2.binance.org",
];

const ORACLE_ABI = parseAbi([
  "function nextUpdateAt() view returns (uint256)",
  "function lastObservationTimestamp() view returns (uint64)",
  "function MAX_PRICE_AGE() view returns (uint256)",
  "function update()",
]);

const MINING_ABI = parseAbi([
  "function nextExpiryAt() view returns (uint256)",
  "function expireDueUsers() returns (uint256 expired)",
]);

function rpcTransport(env) {
  const urls = (env.BSC_RPC_URLS || DEFAULT_BSC_RPC_URLS.join(","))
    .split(",")
    .map(url => url.trim())
    .filter(Boolean);

  if (urls.length === 0) throw new Error("No BSC RPC URLs configured");
  return fallback(urls.map(url => http(url, { retryCount: 2, timeout: 10_000 })));
}

async function updateOracleIfDue(env, account, publicClient, walletClient) {
  const [block, nextUpdateAt] = await Promise.all([
    publicClient.getBlock({ blockTag: "latest" }),
    publicClient.readContract({
      address: env.ORACLE_ADDRESS,
      abi: ORACLE_ABI,
      functionName: "nextUpdateAt",
    }),
  ]);
  if (block.timestamp < nextUpdateAt) {
    return {
      result: "not_due",
      chainTimestamp: block.timestamp.toString(),
      nextUpdateAt: nextUpdateAt.toString(),
    };
  }
  const { request } = await publicClient.simulateContract({
    account,
    address: env.ORACLE_ADDRESS,
    abi: ORACLE_ABI,
    functionName: "update",
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

  return {
    result: "updated",
    hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
  };
}

async function expireMiningUsersIfDue(env, account, publicClient, walletClient) {
  const [block, nextExpiryAt] = await Promise.all([
    publicClient.getBlock({ blockTag: "latest" }),
    publicClient.readContract({
      address: env.MINING_ADDRESS,
      abi: MINING_ABI,
      functionName: "nextExpiryAt",
    }),
  ]);
  if (nextExpiryAt === 0n) return { result: "queue_empty" };
  if (block.timestamp < nextExpiryAt) {
    return {
      result: "not_due",
      chainTimestamp: block.timestamp.toString(),
      nextExpiryAt: nextExpiryAt.toString(),
    };
  }

  const { request } = await publicClient.simulateContract({
    account,
    address: env.MINING_ADDRESS,
    abi: MINING_ABI,
    functionName: "expireDueUsers",
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

  return {
    result: "expired_due_users",
    hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
  };
}

export async function runKeeper(env) {
  if (env.KEEPER_ENABLED !== "true") {
    console.log(JSON.stringify({ result: "disabled" }));
    return { result: "disabled" };
  }
  if (!isAddress(env.ORACLE_ADDRESS)) throw new Error("Invalid ORACLE_ADDRESS");
  if (!isAddress(env.MINING_ADDRESS)) throw new Error("Invalid MINING_ADDRESS");
  if (!/^0x[0-9a-fA-F]{64}$/.test(env.KEEPER_PRIVATE_KEY || "")) {
    throw new Error("KEEPER_PRIVATE_KEY secret is missing or invalid");
  }

  const account = privateKeyToAccount(env.KEEPER_PRIVATE_KEY);
  const transport = rpcTransport(env);
  const publicClient = createPublicClient({ chain: bsc, transport });
  const walletClient = createWalletClient({ account, chain: bsc, transport });
  const [gasPrice, balance, latestBlock, lastObservationTimestamp, maxPriceAge] = await Promise.all([
    publicClient.getGasPrice(),
    publicClient.getBalance({ address: account.address }),
    publicClient.getBlock({ blockTag: "latest" }),
    publicClient.readContract({
      address: env.ORACLE_ADDRESS,
      abi: ORACLE_ABI,
      functionName: "lastObservationTimestamp",
    }),
    publicClient.readContract({
      address: env.ORACLE_ADDRESS,
      abi: ORACLE_ABI,
      functionName: "MAX_PRICE_AGE",
    }),
  ]);
  const maxGasPrice = parseGwei(env.MAX_GAS_PRICE_GWEI || "1");
  const minKeeperBalance = parseEther(env.MIN_KEEPER_BALANCE_BNB || "0.001");
  const oracleAgeSeconds = latestBlock.timestamp > lastObservationTimestamp
    ? latestBlock.timestamp - lastObservationTimestamp
    : 0n;
  const alerts = [];
  if (balance < minKeeperBalance) alerts.push("keeper_balance_low");
  if (oracleAgeSeconds + 5n * 60n >= maxPriceAge) alerts.push("oracle_near_stale");
  if (alerts.length !== 0) console.warn(JSON.stringify({ alerts, keeper: account.address }));
  if (gasPrice > maxGasPrice) {
    const result = {
      result: "gas_price_too_high",
      gasPriceGwei: formatGwei(gasPrice),
      maxGasPriceGwei: formatGwei(maxGasPrice),
      keeper: account.address,
      keeperBalanceBnb: formatEther(balance),
      oracleAgeSeconds: oracleAgeSeconds.toString(),
      alerts,
    };
    console.warn(JSON.stringify(result));
    return result;
  }

  let oracle;
  let miningExpiry;
  const errors = [];
  try {
    oracle = await updateOracleIfDue(env, account, publicClient, walletClient);
  } catch (error) {
    oracle = { result: "error", message: error.shortMessage || error.message };
    errors.push(`oracle: ${oracle.message}`);
  }
  try {
    miningExpiry = await expireMiningUsersIfDue(env, account, publicClient, walletClient);
  } catch (error) {
    miningExpiry = { result: "error", message: error.shortMessage || error.message };
    errors.push(`mining expiry: ${miningExpiry.message}`);
  }

  const result = {
    result: errors.length === 0 ? "checked" : "partial_failure",
    oracle,
    miningExpiry,
    keeper: account.address,
    keeperBalanceBnb: formatEther(balance),
    oracleAgeSeconds: oracleAgeSeconds.toString(),
    alerts,
  };
  console.log(JSON.stringify(result));
  if (errors.length !== 0) throw new Error(errors.join("; "));
  return result;
}

export default {
  async scheduled(_controller, env, context) {
    context.waitUntil(runKeeper(env));
  },
};
