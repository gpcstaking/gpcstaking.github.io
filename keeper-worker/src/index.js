import {
  createPublicClient,
  createWalletClient,
  fallback,
  formatEther,
  formatGwei,
  http,
  isAddress,
  parseAbi,
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
  "function update()",
]);

function rpcTransport(env) {
  const urls = (env.BSC_RPC_URLS || DEFAULT_BSC_RPC_URLS.join(","))
    .split(",")
    .map(url => url.trim())
    .filter(Boolean);

  if (urls.length === 0) throw new Error("No BSC RPC URLs configured");
  return fallback(urls.map(url => http(url, { retryCount: 2, timeout: 10_000 })));
}

export async function runKeeper(env) {
  if (env.KEEPER_ENABLED !== "true") {
    console.log(JSON.stringify({ result: "disabled" }));
    return { result: "disabled" };
  }
  if (!isAddress(env.ORACLE_ADDRESS)) throw new Error("Invalid ORACLE_ADDRESS");
  if (!/^0x[0-9a-fA-F]{64}$/.test(env.KEEPER_PRIVATE_KEY || "")) {
    throw new Error("KEEPER_PRIVATE_KEY secret is missing or invalid");
  }

  const account = privateKeyToAccount(env.KEEPER_PRIVATE_KEY);
  const transport = rpcTransport(env);
  const publicClient = createPublicClient({ chain: bsc, transport });
  const walletClient = createWalletClient({ account, chain: bsc, transport });

  const [block, nextUpdateAt, gasPrice, balance] = await Promise.all([
    publicClient.getBlock({ blockTag: "latest" }),
    publicClient.readContract({
      address: env.ORACLE_ADDRESS,
      abi: ORACLE_ABI,
      functionName: "nextUpdateAt",
    }),
    publicClient.getGasPrice(),
    publicClient.getBalance({ address: account.address }),
  ]);

  if (block.timestamp < nextUpdateAt) {
    console.log(JSON.stringify({
      result: "not_due",
      chainTimestamp: block.timestamp.toString(),
      nextUpdateAt: nextUpdateAt.toString(),
      keeper: account.address,
    }));
    return { result: "not_due", keeper: account.address };
  }

  const maxGasPrice = parseGwei(env.MAX_GAS_PRICE_GWEI || "1");
  if (gasPrice > maxGasPrice) {
    console.warn(JSON.stringify({
      result: "gas_price_too_high",
      gasPriceGwei: formatGwei(gasPrice),
      maxGasPriceGwei: formatGwei(maxGasPrice),
      keeper: account.address,
    }));
    return { result: "gas_price_too_high", keeper: account.address };
  }

  const { request } = await publicClient.simulateContract({
    account,
    address: env.ORACLE_ADDRESS,
    abi: ORACLE_ABI,
    functionName: "update",
  });
  const hash = await walletClient.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });

  console.log(JSON.stringify({
    result: "updated",
    hash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    keeper: account.address,
    keeperBalanceBnb: formatEther(balance),
  }));
  return { result: "updated", hash, keeper: account.address };
}

export default {
  async scheduled(_controller, env, context) {
    context.waitUntil(runKeeper(env));
  },
};
