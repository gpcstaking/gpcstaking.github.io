"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BrowserProvider,
  Contract,
  formatEther,
  Interface,
  isAddress,
  JsonRpcProvider,
  type Log,
  zeroPadValue,
} from "ethers";

const viteEnv = import.meta.env as Record<string, string | undefined>;
const nodeEnv = typeof process === "undefined" ? undefined : process.env;
const MINING_ADDRESS = "0x7C7C849734ea94a590266F90B5fD63D555ed3ca3";
const configuredMiningAddress = viteEnv.VITE_MINING_ADDRESS ?? nodeEnv?.NEXT_PUBLIC_MINING_ADDRESS;
if (configuredMiningAddress && configuredMiningAddress.toLowerCase() !== MINING_ADDRESS.toLowerCase()) {
  throw new Error("Configured mining address does not match the audited BSC proxy");
}
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
const GPC_ADDRESS = "0xD3c304697f63B279cd314F92c19cDBE5E5b1631A";
const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const BSC_CHAIN_ID = "0x38";

const MINING_ABI = [
  "function parentOf(address) view returns (address)",
  "function users(address) view returns (uint256 power,uint256 totalPowerPurchased,uint256 promotionQuota,uint64 lastOrderAt,uint64 nextWithdrawAt,uint64 inactivityStartedAt)",
  "function totalPower() view returns (uint256)",
  "function miningPoolGpc() view returns (uint256)",
  "function communityPower(address) view returns (uint256 total,uint256 largestBranchPower,uint256 smallArea,uint256 effectiveSmallArea)",
  "function directReferralCount(address) view returns (uint256)",
  "function directReferralAt(address,uint256) view returns (address)",
  "function directReferrals(address) view returns (address[])",
  "function branchPower(address,address) view returns (uint256)",
  "function largestBranch(address) view returns (address branch,uint256 power)",
  "function teamNodeCount(address) view returns (uint256)",
  "function communityClaimedToday(address) view returns (uint256)",
  "function historyRegistry() view returns (address)",
  "function quoteRewards(address) view returns ((uint256 staticRewardUsdt,uint256 communityRewardUsdt,uint256 totalRewardUsdt,uint256 grossGpc,uint256 gpcPrice,uint256 poolValueUsdt,uint256 smallAreaPower,uint256 effectiveSmallAreaPower,bool poolLimitedMode))",
  "function oracle() view returns (address)",
  "function bindReferral(address parent)",
  "function router() view returns (address)",
  "function placeOrder(uint256 deadline,uint256 userMinGpcOut,uint256 userMinWbnbOut,uint256 userMinLpGpc,uint256 userMinLpWbnb)",
  "function placeOrderFor(address beneficiary,uint256 deadline,uint256 userMinGpcOut,uint256 userMinWbnbOut,uint256 userMinLpGpc,uint256 userMinLpWbnb)",
  "function withdraw()",
  "function withdrawFor(address beneficiary)",
  "event Withdrawn(address indexed user,uint256 staticRewardUsdt,uint256 communityRewardUsdt,uint256 powerBurned,uint256 grossGpc,uint256 feeGpc,uint256 netGpc,uint256 gpcPrice)",
  "error RootCannotOrder()",
  "error ReferralRequired()",
  "error OrderCooldownActive()",
  "error InvalidDeadline()",
  "error OraclePriceInvalid()",
  "error SpotTwapDeviationTooHigh(address asset,uint256 spotPrice,uint256 twapPrice)",
  "error SwapOutputTooLow()",
];

const HISTORY_ABI = [
  "function powerHistory(address account,uint256 offset,uint256 limit) view returns ((uint256 amount,uint64 timestamp,uint8 kind)[] records,uint256 total)",
  "function promotionQuotaHistory(address account,uint256 offset,uint256 limit) view returns ((uint256 amount,uint64 timestamp,uint8 kind)[] records,uint256 total)",
];

const ORACLE_ABI = [
  "function isReady() view returns (bool)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn,address[] path) view returns (uint256[] amounts)",
];

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ORDER_AMOUNT = 1n * 10n ** 18n;
const GPC_SWAP_AMOUNT = 7n * 10n ** 17n;
const WBNB_SWAP_AMOUNT = 5n * 10n ** 16n;
const BPS = 10_000n;
const MINING_DEPLOYMENT_BLOCK = 110_493_189;
const LOG_QUERY_BLOCK_SPAN = 50_000;
const HISTORY_PROVIDER = new JsonRpcProvider("https://bsc.rpc.blxrbdn.com", 56, { staticNetwork: true, batchMaxCount: 1 });
const USER_SWAP_SLIPPAGE_BPS = 30n; // 0.3% from the pre-signing router quote
const ORDER_DEADLINE_SECONDS = 60;
const DIRECT_REFERRAL_PAGE_SIZE = 20;
const LP_SLIPPAGE_BPS = 200n;
const TRANSACTION_GAS_HEADROOM_BPS = 3_000n; // BSC estimation can underfund nested contract calls

type Snapshot = {
  power: bigint;
  promotionQuota: bigint;
  nextWithdrawAt: number;
  inactivityStartedAt: number;
  parent: string;
  totalPower: bigint;
  poolGpc: bigint;
  burnedGpc: bigint;
  usdtBalance: bigint;
  allowance: bigint;
  staticReward: bigint;
  communityReward: bigint;
  communityClaimedToday: bigint;
  totalReward: bigint;
  grossGpc: bigint;
  claimedTodayGpc: bigint;
  claimedTodayUsdt: bigint;
  claimedTodayStaticGpc: bigint;
  claimedTodayDynamicGpc: bigint;
  smallArea: bigint;
  effectiveSmallArea: bigint;
  poolLimitedMode: boolean;
  oracleReady: boolean;
  largestBranch: string;
  teamNodeCount: bigint;
  directReferralCount: bigint;
  directReferrals: Array<{ address: string; branchPower: bigint }>;
};

type AppTab = "home" | "order" | "team" | "ecosystem";
type LedgerKind = "power" | "promotionQuota";
type LedgerEntry = {
  id: string;
  timestamp: number;
  direction: "increase" | "decrease";
  amount: bigint;
  label: LocalizedStatus;
};
type Language = "zh" | "en";
type LocalizedStatus = { zh: string; en: string };

const MINING_INTERFACE = new Interface(MINING_ABI);

const emptySnapshot: Snapshot = {
  power: 0n,
  promotionQuota: 0n,
  nextWithdrawAt: 0,
  inactivityStartedAt: 0,
  parent: ZERO_ADDRESS,
  totalPower: 0n,
  poolGpc: 0n,
  burnedGpc: 0n,
  usdtBalance: 0n,
  allowance: 0n,
  staticReward: 0n,
  communityReward: 0n,
  communityClaimedToday: 0n,
  totalReward: 0n,
  grossGpc: 0n,
  claimedTodayGpc: 0n,
  claimedTodayUsdt: 0n,
  claimedTodayStaticGpc: 0n,
  claimedTodayDynamicGpc: 0n,
  smallArea: 0n,
  effectiveSmallArea: 0n,
  poolLimitedMode: false,
  oracleReady: false,
  largestBranch: ZERO_ADDRESS,
  teamNodeCount: 0n,
  directReferralCount: 0n,
  directReferrals: [],
};

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    };
  }
}

function compact(value: bigint, language: Language, maximumFractionDigits = 2) {
  const number = Number(formatEther(value));
  return new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits }).format(number);
}

function gasLimitWithHeadroom(estimatedGas: bigint) {
  return estimatedGas * (BPS + TRANSACTION_GAS_HEADROOM_BPS) / BPS;
}

async function loadDirectReferralPage(mining: Contract, account: string, offset: number) {
  try {
    const total = await mining.directReferralCount(account) as bigint;
    const safeTotal = Number(total > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : total);
    const end = Math.min(offset + DIRECT_REFERRAL_PAGE_SIZE, safeTotal);
    const addresses = await Promise.all(
      Array.from({ length: Math.max(0, end - offset) }, (_, index) => mining.directReferralAt(account, offset + index) as Promise<string>),
    );
    return { total, addresses };
  } catch {
    // Transitional fallback for the previous implementation while the proxy upgrade propagates.
    const all = Array.from(await mining.directReferrals(account) as string[]);
    return { total: BigInt(all.length), addresses: all.slice(offset, offset + DIRECT_REFERRAL_PAGE_SIZE) };
  }
}

function formatCount(value: bigint, language: Language) {
  return new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en-US").format(value);
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatTime(timestamp: number, language: Language) {
  if (!timestamp) return language === "zh" ? "报单后开始计时" : "Starts after staking";
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

function formatLedgerTime(timestamp: number, language: Language) {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

async function getLogsInRanges(provider: JsonRpcProvider, topics: Array<string | null>, latestBlock: number, firstBlock = MINING_DEPLOYMENT_BLOCK) {
  const getRange = async (fromBlock: number, toBlock: number): Promise<Log[]> => {
    try {
      return await provider.getLogs({ address: MINING_ADDRESS, fromBlock, toBlock, topics });
    } catch (error) {
      if (fromBlock >= toBlock) throw error;
      const midpoint = Math.floor((fromBlock + toBlock) / 2);
      const [left, right] = await Promise.all([
        getRange(fromBlock, midpoint),
        getRange(midpoint + 1, toBlock),
      ]);
      return [...left, ...right];
    }
  };

  const logs: Log[] = [];
  for (let fromBlock = firstBlock; fromBlock <= latestBlock; fromBlock += LOG_QUERY_BLOCK_SPAN) {
    logs.push(...await getRange(fromBlock, Math.min(fromBlock + LOG_QUERY_BLOCK_SPAN - 1, latestBlock)));
  }
  return logs;
}

async function loadTodayClaims(account: string) {
  const empty = { gpc: 0n, usdt: 0n, staticGpc: 0n, dynamicGpc: 0n };
  const latestBlock = await HISTORY_PROVIDER.getBlock("latest");
  if (!latestBlock) return empty;

  const cstOffset = 8 * 60 * 60;
  const daySeconds = 24 * 60 * 60;
  const todayStart = Math.floor((latestBlock.timestamp + cstOffset) / daySeconds) * daySeconds - cstOffset;
  const todayEnd = todayStart + daySeconds;
  const firstBlock = Math.max(MINING_DEPLOYMENT_BLOCK, latestBlock.number - 200_000);
  const accountTopic = zeroPadValue(account, 32);
  const withdrawTopic = MINING_INTERFACE.getEvent("Withdrawn")!.topicHash;
  const logs = await getLogsInRanges(HISTORY_PROVIDER, [withdrawTopic, accountTopic], latestBlock.number, firstBlock);
  const blockNumbers = [...new Set(logs.map(log => log.blockNumber))];
  const blocks = await Promise.all(blockNumbers.map(blockNumber => HISTORY_PROVIDER.getBlock(blockNumber)));
  const timestamps = new Map(blocks.filter(Boolean).map(block => [block!.number, block!.timestamp]));

  return logs.reduce((total, log) => {
    const timestamp = timestamps.get(log.blockNumber) || 0;
    if (timestamp < todayStart || timestamp >= todayEnd) return total;
    const parsed = MINING_INTERFACE.parseLog(log);
    if (!parsed) return total;

    const staticUsdt = parsed.args.staticRewardUsdt as bigint;
    const dynamicUsdt = parsed.args.communityRewardUsdt as bigint;
    const netGpc = parsed.args.netGpc as bigint;
    const gpcPrice = parsed.args.gpcPrice as bigint;
    const rewardUsdt = staticUsdt + dynamicUsdt;
    const staticGpc = rewardUsdt === 0n ? 0n : netGpc * staticUsdt / rewardUsdt;
    const dynamicGpc = netGpc - staticGpc;

    return {
      gpc: total.gpc + netGpc,
      usdt: total.usdt + netGpc * gpcPrice / 10n ** 18n,
      staticGpc: total.staticGpc + staticGpc,
      dynamicGpc: total.dynamicGpc + dynamicGpc,
    };
  }, empty);
}

function errorDetails(error: unknown) {
  if (!error || typeof error !== "object") return String(error ?? "");
  const candidate = error as {
    errorName?: string;
    shortMessage?: string;
    reason?: string;
    message?: string;
    info?: { error?: { message?: string } };
  };
  return [candidate.errorName, candidate.shortMessage, candidate.reason, candidate.info?.error?.message, candidate.message]
    .filter(Boolean)
    .join(" | ");
}

function friendlyTransactionError(error: unknown, language: Language) {
  const details = errorDetails(error);
  const localized = (zh: string, en: string) => language === "zh" ? zh : en;
  const contractError = (name: string, selector: string) => details.toLowerCase().includes(name.toLowerCase()) || details.toLowerCase().includes(selector);

  if (/ACTION_REJECTED|user rejected|User denied/i.test(details)) return localized("已取消钱包确认", "Wallet confirmation cancelled");
  if (/insufficient funds/i.test(details)) return localized("钱包 BNB 不足，无法支付 Gas", "Not enough BNB to pay gas");
  if (contractError("ZeroAddress", "0xd92e233d")) return localized("钱包地址无效", "Invalid wallet address");
  if (contractError("AlreadyBound", "0x682a9065")) return localized("该钱包已经绑定过上级", "This wallet already has a sponsor");
  if (contractError("ParentNotBound", "0xe22eca65")) return localized("无效地址：该钱包不在 GPC 推荐网络中", "Invalid address: this wallet is not in the GPC referral network");
  if (contractError("ReferralDepthExceeded", "0xf9b08cf3")) return localized("推荐关系已达到 30 层上限", "The referral tree has reached its 30-level limit");
  if (contractError("RootCannotOrder", "0xf85bf639")) return localized("根节点钱包不能参与质押，请切换其他钱包", "The root wallet cannot stake. Switch to another wallet.");
  if (contractError("ReferralRequired", "0x23cf161d")) return localized("请先绑定有效上级", "Bind a valid sponsor first");
  if (contractError("OrderCooldownActive", "0xc2a5d56a")) return localized("两次质押需要间隔 1 分钟", "Wait 1 minute between stakes");
  if (contractError("InvalidDeadline", "0x769d11e4")) return localized("交易报价已过期，请重新质押", "The transaction quote expired. Try staking again.");
  if (contractError("SpotTwapDeviationTooHigh", "0x613f0ee7")) return localized("当前价格偏离 6 小时均价超过安全范围，本次质押未扣款，请稍后重试", "The live price is outside the safe 6-hour range. No funds were taken; try again later.");
  if (contractError("PriceStale", "0x28771d91") || contractError("PriceUnavailable", "0xcb08be81") || contractError("OraclePriceInvalid", "0xe5ea8c65")) return localized("价格服务正在更新，本次质押未扣款，请稍后刷新", "Price service is updating. No funds were taken; refresh shortly.");
  if (contractError("UnsupportedUsdtTransfer", "0xf6e15c81")) return localized("当前 USDT 转账方式不受支持，本次质押未扣款", "This USDT transfer method is unsupported. No funds were taken.");
  if (contractError("SwapOutputTooLow", "0x1eed8018") || /INSUFFICIENT_OUTPUT|slippage/i.test(details)) return localized("价格波动过大，本次质押未扣款，请刷新后重试", "Price moved too much. No funds were taken; refresh and retry.");
  if (contractError("NoPower", "0xab68ecfc")) return localized("当前没有可提现算力", "There is no mining power available to claim");
  if (contractError("WithdrawCooldownActive", "0x2c7d4316")) return localized("距离上次提现不足 24 小时", "Claims are limited to once every 24 hours");
  if (contractError("NoReward", "0x6e992686")) return localized("当前没有可领取收益", "There is currently no reward to claim");
  if (contractError("WithdrawExceedsPoolLimit", "0xe9260c57")) return localized("本次提现超过订单矿池 1% 限额", "This claim exceeds the 1% mining-pool limit");
  if (contractError("GlobalWithdrawLimitExceeded", "0x73c5a6b0")) return localized("当前 24 小时全网提现额度已用完，请稍后再试", "The global 24-hour claim limit has been reached. Try again later.");
  if (/TRANSFER_FROM_FAILED|transfer amount exceeds balance|SafeERC20|insufficient allowance/i.test(details)) return localized("USDT 余额或授权不足，本次质押未扣款", "Insufficient USDT balance or allowance. No funds were taken.");
  return details || localized("交易失败，请稍后重试", "Transaction failed. Try again shortly.");
}

type IconName = "home" | "order" | "team" | "user" | "wallet" | "withdraw" | "link" | "refresh" | "shield" | "chevron";

function DappIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    home: <><path d="m3 11 9-7 9 7" /><path d="M5.5 9.5V20h13V9.5" /><path d="M9.5 20v-6h5v6" /></>,
    order: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    team: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    wallet: <><path d="M4 6.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3v-11a3 3 0 0 1 3-3h12" /><path d="M16 12h6v4h-6a2 2 0 1 1 0-4Z" /></>,
    withdraw: <><path d="M12 3v13M7 11l5 5 5-5" /><path d="M5 21h14" /></>,
    link: <><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></>,
    refresh: <><path d="M20 6v5h-5" /><path d="M4 18v-5h5" /><path d="M18.5 9A7 7 0 0 0 6 6.5L4 11M5.5 15A7 7 0 0 0 18 17.5l2-4.5" /></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
  };

  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export default function Home() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [account, setAccount] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [parentInput, setParentInput] = useState("");
  const [status, setStatus] = useState<LocalizedStatus>({
    zh: "连接钱包后读取链上数据",
    en: "Connect your wallet to load on-chain data",
  });
  const [busy, setBusy] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [language, setLanguage] = useState<Language>("zh");
  const [ledgerKind, setLedgerKind] = useState<LedgerKind | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState<LocalizedStatus | null>(null);
  const [todayClaimsError, setTodayClaimsError] = useState(false);
  const [referralsLoading, setReferralsLoading] = useState(false);
  const [serviceMode, setServiceMode] = useState(false);
  const [serviceBeneficiary, setServiceBeneficiary] = useState("");
  const refreshSequence = useRef(0);

  const text = (zh: string, en: string) => language === "zh" ? zh : en;

  const isConfigured = isAddress(MINING_ADDRESS);
  const isBound = snapshot.parent !== ZERO_ADDRESS;
  const needsApproval = snapshot.allowance !== ORDER_AMOUNT;
  const hasEnoughUsdt = snapshot.usdtBalance >= ORDER_AMOUNT;
  const canWithdraw = snapshot.nextWithdrawAt !== 0 && currentTime >= snapshot.nextWithdrawAt;
  const bindingRequired = Boolean(account) && !isBound;
  const communityRewardBurned = snapshot.effectiveSmallArea < snapshot.smallArea;

  useEffect(() => {
    const restoreServiceMode = window.setTimeout(() => {
      setServiceMode(new URLSearchParams(window.location.search).get("service") === "operator");
    }, 0);
    const savedLanguage = window.localStorage.getItem("gpc-language");
    if (savedLanguage !== "zh" && savedLanguage !== "en") {
      return () => window.clearTimeout(restoreServiceMode);
    }
    const restoreLanguage = window.setTimeout(() => setLanguage(savedLanguage), 0);
    return () => {
      window.clearTimeout(restoreServiceMode);
      window.clearTimeout(restoreLanguage);
    };
  }, []);

  function toggleLanguage() {
    const nextLanguage: Language = language === "zh" ? "en" : "zh";
    setLanguage(nextLanguage);
    window.localStorage.setItem("gpc-language", nextLanguage);
  }

  async function openLedger(kind: LedgerKind) {
    setLedgerKind(kind);
    setLedgerEntries([]);
    setLedgerError(null);
    window.scrollTo({ top: 0, behavior: "auto" });

    if (!provider || !account) {
      setLedgerError({ zh: "请先连接钱包后查看链上明细", en: "Connect your wallet to view on-chain history" });
      return;
    }

    setLedgerLoading(true);
    try {
      const mining = new Contract(MINING_ADDRESS, MINING_ABI, provider);
      const registryAddress = String(await mining.historyRegistry());
      if (!isAddress(registryAddress) || registryAddress === ZERO_ADDRESS) throw new Error("History registry unavailable");

      const registry = new Contract(registryAddress, HISTORY_ABI, provider);
      const result = kind === "power"
        ? await registry.powerHistory(account, 0, 30)
        : await registry.promotionQuotaHistory(account, 0, 30);
      const records = result.records as Array<{ amount: bigint; timestamp: bigint; kind: bigint }>;
      const entries = records.map((record, index): LedgerEntry => {
        const recordKind = Number(record.kind);
        const powerLabels: Record<number, LocalizedStatus> = {
          1: { zh: "质押增加", en: "Added by staking" },
          2: { zh: "领取收益消耗", en: "Used to claim rewards" },
          3: { zh: "180 天未提现清零", en: "Expired after 180 days" },
        };
        const quotaLabels: Record<number, LocalizedStatus> = {
          1: { zh: "质押增加", en: "Added by staking" },
          2: { zh: "直推奖励消耗", en: "Used for direct referral reward" },
        };
        return {
          id: `${record.timestamp}-${recordKind}-${index}`,
          timestamp: Number(record.timestamp),
          direction: recordKind === 1 ? "increase" : "decrease",
          amount: record.amount,
          label: (kind === "power" ? powerLabels : quotaLabels)[recordKind] ?? { zh: "链上变更", en: "On-chain change" },
        };
      });
      setLedgerEntries(entries);
    } catch {
      setLedgerError({ zh: "链上明细读取失败，请稍后重试", en: "Unable to load on-chain history. Try again shortly." });
    } finally {
      setLedgerLoading(false);
    }
  }

  function closeLedger() {
    setLedgerKind(null);
    setLedgerError(null);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum?.on) return;

    const invalidateSession = () => {
      refreshSequence.current += 1;
      setProvider(null);
      setAccount("");
      setSnapshot(emptySnapshot);
      setCurrentTime(0);
      setLedgerKind(null);
      setLedgerEntries([]);
      setLedgerError(null);
      setTodayClaimsError(false);
      setReferralsLoading(false);
      setStatus({ zh: "钱包账户或网络已变更，请重新连接", en: "Wallet account or network changed. Please reconnect." });
    };
    ethereum.on("accountsChanged", invalidateSession);
    ethereum.on("chainChanged", invalidateSession);
    return () => {
      ethereum.removeListener?.("accountsChanged", invalidateSession);
      ethereum.removeListener?.("chainChanged", invalidateSession);
    };
  }, []);

  const refresh = useCallback(async (activeProvider: BrowserProvider, activeAccount: string) => {
    const refreshId = ++refreshSequence.current;
    if (!isConfigured) {
      setStatus({ zh: "等待配置已部署的挖矿合约地址", en: "Waiting for the deployed mining contract address" });
      return;
    }

    const mining = new Contract(MINING_ADDRESS, MINING_ABI, activeProvider);
    const usdt = new Contract(USDT_ADDRESS, ERC20_ABI, activeProvider);
    const gpc = new Contract(GPC_ADDRESS, ERC20_ABI, activeProvider);
    setTodayClaimsError(false);
    const todayClaimsPromise = loadTodayClaims(activeAccount);
    const [user, parent, totalPower, poolGpc, community, largestBranch, teamNodeCount, communityClaimedToday, usdtBalance, allowance, oracleAddress, burnedGpc] = await Promise.all([
      mining.users(activeAccount),
      mining.parentOf(activeAccount),
      mining.totalPower(),
      mining.miningPoolGpc(),
      mining.communityPower(activeAccount),
      mining.largestBranch(activeAccount),
      mining.teamNodeCount(activeAccount),
      mining.communityClaimedToday(activeAccount),
      usdt.balanceOf(activeAccount),
      usdt.allowance(activeAccount, MINING_ADDRESS),
      mining.oracle(),
      gpc.balanceOf(DEAD_ADDRESS),
    ]);
    const referralPage = await loadDirectReferralPage(mining, activeAccount, 0);
    const directReferralCount = referralPage.total;
    const directReferralAddresses = referralPage.addresses;
    const directReferrals = await Promise.all(
      Array.from(directReferralAddresses as string[]).map(async (address) => ({
        address,
        branchPower: await mining.branchPower(activeAccount, address),
      })),
    );
    const oracle = new Contract(oracleAddress, ORACLE_ABI, activeProvider);
    const oracleReady = await oracle.isReady();

    let reward = null;
    try {
      reward = await mining.quoteRewards(activeAccount);
    } catch {
      // A false result means the rolling oracle has not been initialized. Keeper delays use the
      // on-chain full-TWAP, available-history, and spot-price fallback chain instead of stopping.
    }

    setSnapshot({
      power: user.power,
      promotionQuota: user.promotionQuota,
      nextWithdrawAt: Number(user.nextWithdrawAt),
      inactivityStartedAt: Number(user.inactivityStartedAt),
      parent,
      totalPower,
      poolGpc,
      burnedGpc,
      usdtBalance,
      allowance,
      staticReward: reward?.staticRewardUsdt ?? 0n,
      communityReward: reward?.communityRewardUsdt ?? 0n,
      communityClaimedToday,
      totalReward: reward?.totalRewardUsdt ?? 0n,
      grossGpc: reward?.grossGpc ?? 0n,
      claimedTodayGpc: 0n,
      claimedTodayUsdt: 0n,
      claimedTodayStaticGpc: 0n,
      claimedTodayDynamicGpc: 0n,
      smallArea: community.smallArea,
      effectiveSmallArea: community.effectiveSmallArea,
      poolLimitedMode: reward?.poolLimitedMode ?? false,
      oracleReady,
      largestBranch: largestBranch.branch,
      teamNodeCount,
      directReferralCount,
      directReferrals,
    });
    void todayClaimsPromise.then(todayClaims => {
      if (refreshSequence.current !== refreshId) return;
      setSnapshot(current => ({
        ...current,
        claimedTodayGpc: todayClaims.gpc,
        claimedTodayUsdt: todayClaims.usdt,
        claimedTodayStaticGpc: todayClaims.staticGpc,
        claimedTodayDynamicGpc: todayClaims.dynamicGpc,
      }));
    }).catch(() => {
      if (refreshSequence.current !== refreshId) return;
      setTodayClaimsError(true);
    });
    setCurrentTime(Math.floor(Date.now() / 1000));
    setStatus(oracleReady
      ? { zh: "链上数据已更新", en: "On-chain data updated" }
      : { zh: "合约已部署，Oracle 暂未就绪", en: "Contract deployed; Oracle is not ready yet" });
  }, [isConfigured]);

  async function loadMoreReferrals() {
    if (!provider || !account || referralsLoading) return;
    const start = snapshot.directReferrals.length;
    if (BigInt(start) >= snapshot.directReferralCount) return;

    setReferralsLoading(true);
    try {
      const mining = new Contract(MINING_ADDRESS, MINING_ABI, provider);
      const referralPage = await loadDirectReferralPage(mining, account, start);
      const next = await Promise.all(referralPage.addresses.map(async address => ({
        address,
        branchPower: await mining.branchPower(account, address) as bigint,
      })));
      setSnapshot(current => ({
        ...current,
        directReferralCount: referralPage.total,
        directReferrals: [...current.directReferrals, ...next],
      }));
    } catch {
      setStatus({ zh: "直推列表读取失败，请稍后重试", en: "Unable to load referrals. Try again shortly." });
    } finally {
      setReferralsLoading(false);
    }
  }

  async function connectWallet() {
    if (!window.ethereum) {
      setStatus({ zh: "未检测到钱包，请安装 MetaMask 或兼容钱包", en: "No wallet detected. Install MetaMask or a compatible wallet." });
      return;
    }
    try {
      setBusy(true);
      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      if (chainId !== BSC_CHAIN_ID) {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: BSC_CHAIN_ID }],
          });
        } catch {
          await addBscNetwork();
        }
      }
      const nextProvider = new BrowserProvider(window.ethereum);
      await nextProvider.send("eth_requestAccounts", []);
      const signer = await nextProvider.getSigner();
      const nextAccount = await signer.getAddress();
      setProvider(nextProvider);
      setAccount(nextAccount);
      await refresh(nextProvider, nextAccount);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wallet connection failed";
      setStatus({ zh: message, en: message });
    } finally {
      setBusy(false);
    }
  }

  async function addBscNetwork() {
    if (!window.ethereum) throw new Error("未检测到兼容钱包");
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: BSC_CHAIN_ID,
        chainName: "BNB Smart Chain Mainnet",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        rpcUrls: ["https://bscrpc.pancakeswap.finance"],
        blockExplorerUrls: ["https://bscscan.com"],
      }],
    });
  }

  async function runTransaction(label: LocalizedStatus, action: (signer: Awaited<ReturnType<BrowserProvider["getSigner"]>>) => Promise<{ wait: () => Promise<unknown> }>) {
    if (!provider || !account) {
      await connectWallet();
      return false;
    }
    try {
      setBusy(true);
      const chainId = await window.ethereum?.request({ method: "eth_chainId" });
      if (chainId !== BSC_CHAIN_ID) throw new Error(text("当前网络不是 BSC Mainnet，请重新连接钱包", "Wrong network. Reconnect on BSC Mainnet."));
      setStatus({ zh: `${label.zh}：请在钱包中确认`, en: `${label.en}: confirm in your wallet` });
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      if (signerAddress.toLowerCase() !== account.toLowerCase()) {
        throw new Error(text("钱包账户已变更，请重新连接后再操作", "Wallet account changed. Reconnect before continuing."));
      }
      const transaction = await action(signer);
      setStatus({ zh: `${label.zh}：等待链上确认`, en: `${label.en}: waiting for confirmation` });
      await transaction.wait();
      await refresh(provider, account);
      setStatus({ zh: `${label.zh}成功`, en: `${label.en} successful` });
      return true;
    } catch (error) {
      const message = friendlyTransactionError(error, language);
      setStatus({ zh: message, en: message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function bindReferral() {
    if (!isAddress(parentInput)) {
      setStatus({ zh: "请输入有效的上级钱包地址", en: "Enter a valid sponsor wallet address" });
      return false;
    }
    const succeeded = await runTransaction({ zh: "绑定上级", en: "Bind sponsor" }, async signer => {
      const mining = new Contract(MINING_ADDRESS, MINING_ABI, signer);
      const sponsorParent = await mining.parentOf(parentInput);
      if (sponsorParent === ZERO_ADDRESS) {
        throw new Error(text("无效地址：该钱包不在 GPC 推荐网络中", "Invalid address: this wallet is not in the GPC referral network"));
      }
      const estimatedGas = await mining.bindReferral.estimateGas(parentInput);
      return mining.bindReferral(parentInput, { gasLimit: gasLimitWithHeadroom(estimatedGas) });
    });
    if (succeeded) {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      setParentInput("");
      window.setTimeout(() => {
        window.scrollTo({ top: 0, behavior: "auto" });
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }, 120);
    }
    return succeeded;
  }

  function approveUsdt() {
    return runTransaction({ zh: "授权 1 USDT", en: "Approve 1 USDT" }, async signer => {
      const usdt = new Contract(USDT_ADDRESS, ERC20_ABI, signer);
      const estimatedGas = await usdt.approve.estimateGas(MINING_ADDRESS, ORDER_AMOUNT);
      return usdt.approve(MINING_ADDRESS, ORDER_AMOUNT, { gasLimit: gasLimitWithHeadroom(estimatedGas) });
    });
  }

  async function protectedOrderArgs(mining: Contract) {
    if (!provider) throw new Error(text("请先连接钱包", "Connect your wallet first"));
    const routerAddress = await mining.router();
    const pancakeRouter = new Contract(routerAddress, ROUTER_ABI, provider);
    const [gpcAmounts, wbnbAmounts] = await Promise.all([
      pancakeRouter.getAmountsOut(GPC_SWAP_AMOUNT, [USDT_ADDRESS, WBNB_ADDRESS, GPC_ADDRESS]),
      pancakeRouter.getAmountsOut(WBNB_SWAP_AMOUNT, [USDT_ADDRESS, WBNB_ADDRESS]),
    ]);
    const quotedGpc = gpcAmounts[gpcAmounts.length - 1] as bigint;
    const quotedWbnb = wbnbAmounts[wbnbAmounts.length - 1] as bigint;
    const minGpcOut = quotedGpc * (BPS - USER_SWAP_SLIPPAGE_BPS) / BPS;
    const minWbnbOut = quotedWbnb * (BPS - USER_SWAP_SLIPPAGE_BPS) / BPS;
    const minLpGpc = (quotedGpc / 14n) * (BPS - LP_SLIPPAGE_BPS) / BPS;
    const minLpWbnb = quotedWbnb * (BPS - LP_SLIPPAGE_BPS) / BPS;
    const deadline = Math.floor(Date.now() / 1000) + ORDER_DEADLINE_SECONDS;
    return [deadline, minGpcOut, minWbnbOut, minLpGpc, minLpWbnb] as const;
  }

  function placeOrder() {
    return runTransaction({ zh: "GPC 质押", en: "GPC staking" }, async signer => {
      const mining = new Contract(MINING_ADDRESS, MINING_ABI, signer);
      const [deadline, minGpcOut, minWbnbOut, minLpGpc, minLpWbnb] = await protectedOrderArgs(mining);
      await mining.placeOrder.staticCall(deadline, minGpcOut, minWbnbOut, minLpGpc, minLpWbnb);
      const estimatedGas = await mining.placeOrder.estimateGas(deadline, minGpcOut, minWbnbOut, minLpGpc, minLpWbnb);
      return mining.placeOrder(deadline, minGpcOut, minWbnbOut, minLpGpc, minLpWbnb, { gasLimit: gasLimitWithHeadroom(estimatedGas) });
    });
  }

  async function servicePlaceOrder() {
    if (!isAddress(serviceBeneficiary)) {
      setStatus({ zh: "请输入有效的目标钱包地址", en: "Enter a valid beneficiary wallet address" });
      return false;
    }
    return runTransaction({ zh: "代报单", en: "Assisted staking" }, async signer => {
      const mining = new Contract(MINING_ADDRESS, MINING_ABI, signer);
      const parent = await mining.parentOf(serviceBeneficiary);
      if (parent === ZERO_ADDRESS) {
        throw new Error(text("目标钱包未绑定有效上级", "The beneficiary has not bound a valid sponsor"));
      }
      const [deadline, minGpcOut, minWbnbOut, minLpGpc, minLpWbnb] = await protectedOrderArgs(mining);
      await mining.placeOrderFor.staticCall(serviceBeneficiary, deadline, minGpcOut, minWbnbOut, minLpGpc, minLpWbnb);
      const estimatedGas = await mining.placeOrderFor.estimateGas(serviceBeneficiary, deadline, minGpcOut, minWbnbOut, minLpGpc, minLpWbnb);
      return mining.placeOrderFor(serviceBeneficiary, deadline, minGpcOut, minWbnbOut, minLpGpc, minLpWbnb, { gasLimit: gasLimitWithHeadroom(estimatedGas) });
    });
  }

  async function serviceWithdraw() {
    if (!isAddress(serviceBeneficiary)) {
      setStatus({ zh: "请输入有效的目标钱包地址", en: "Enter a valid beneficiary wallet address" });
      return false;
    }
    return runTransaction({ zh: "代提现", en: "Assisted claim" }, async signer => {
      const mining = new Contract(MINING_ADDRESS, MINING_ABI, signer);
      const estimatedGas = await mining.withdrawFor.estimateGas(serviceBeneficiary);
      return mining.withdrawFor(serviceBeneficiary, { gasLimit: gasLimitWithHeadroom(estimatedGas) });
    });
  }

  function withdraw() {
    return runTransaction({ zh: "提现", en: "Claim" }, async signer => {
      const mining = new Contract(MINING_ADDRESS, MINING_ABI, signer);
      const estimatedGas = await mining.withdraw.estimateGas();
      return mining.withdraw({ gasLimit: gasLimitWithHeadroom(estimatedGas) });
    });
  }

  function switchTab(tab: AppTab) {
    if (bindingRequired) {
      setStatus({ zh: "请先绑定有效的上级地址", en: "Bind a valid sponsor before continuing" });
      return;
    }
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="mobile-stage">
      <div className="dapp-shell" id="top">
        <header className="app-header">
          <a className="app-brand" href="#top" aria-label={text("GPC Protocol 首页", "GPC Protocol home")}>
            <span className="app-logo" aria-hidden="true" />
            <span><strong>GPC</strong><small>STAKING</small></span>
          </a>
          <div className="header-actions">
            <button className="language-toggle" onClick={toggleLanguage} aria-label={text("切换为英文", "Switch to Chinese")}>{language === "zh" ? "EN" : "中文"}</button>
            <button className="connect-pill" onClick={connectWallet} disabled={busy}>
              <DappIcon name="wallet" size={15} />
              {account ? shortAddress(account) : text("连接钱包", "Connect")}
            </button>
          </div>
        </header>

        <div className="status-strip" role="status">
          <span className="live-dot" />
          <span>{status[language]}</span>
          <button onClick={() => provider && account && refresh(provider, account)} disabled={!account || busy}><DappIcon name="refresh" size={14} /></button>
        </div>

        {serviceMode && (
          <section className="service-page" aria-labelledby="service-title">
            <div className="service-heading">
              <span>GPC OPERATIONS</span>
              <h1 id="service-title">{text("代操作工具", "Assisted Operations")}</h1>
              <p>{text("该入口不会出现在普通导航中。任何钱包均可为已绑定用户代报单或代提现。", "This page is not linked from public navigation. Any wallet can place an assisted stake or claim for an already-bound beneficiary.")}</p>
            </div>

            {!account ? (
              <article className="service-lock-card">
                <span className="service-lock-icon"><DappIcon name="shield" size={24} /></span>
                <strong>{text("连接支付钱包", "Connect payment wallet")}</strong>
                <p>{text("任何钱包均可支付 1 USDT，为已绑定用户代报单。", "Any wallet can pay 1 USDT to stake for an already-bound beneficiary.")}</p>
                <button onClick={connectWallet} disabled={busy}>{text("连接钱包", "Connect wallet")}</button>
              </article>
            ) : (
              <>
                <article className="service-target-card">
                  <div className="service-operator-row"><span>{text("当前支付钱包", "Current payer")}</span><strong>{shortAddress(account)}</strong></div>
                  <label htmlFor="service-beneficiary">{text("目标用户钱包地址", "Beneficiary wallet address")}</label>
                  <input id="service-beneficiary" value={serviceBeneficiary} onChange={event => setServiceBeneficiary(event.target.value.trim())} placeholder="0x..." autoComplete="off" autoCapitalize="none" inputMode="text" spellCheck={false} />
                  <small><DappIcon name="shield" size={13} />{text("算力和额度记入目标用户，代提现收益也只到目标钱包", "Power and quota are credited to the beneficiary; assisted claim proceeds also go only to it")}</small>
                </article>

                <article className="service-action-card">
                  <div className="service-action-title"><span className="heading-icon"><DappIcon name="order" size={17} /></span><div><strong>{text("代报单", "Assisted staking")}</strong><small>{text("当前钱包支付 1 USDT，目标用户获得 2 算力和 1 U 推广额度", "The current wallet pays 1 USDT; the beneficiary receives 2 power and 1 U referral quota")}</small></div></div>
                  <div className="wallet-row"><span>{text("当前钱包 USDT", "Current wallet USDT")}</span><strong>{compact(snapshot.usdtBalance, language)} USDT</strong></div>
                  {!hasEnoughUsdt ? (
                    <button className="service-action-button" disabled>{text("USDT 余额不足", "Insufficient USDT")}</button>
                  ) : needsApproval ? (
                    <button className="service-action-button" onClick={approveUsdt} disabled={busy}>{snapshot.allowance > ORDER_AMOUNT ? text("调整授权为 1 USDT", "Reset approval to 1 USDT") : text("授权 1 USDT", "Approve 1 USDT")}</button>
                  ) : !snapshot.oracleReady ? (
                    <button className="service-action-button" disabled>{text("价格服务更新中", "Price service updating")}</button>
                  ) : (
                    <button className="service-action-button" onClick={servicePlaceOrder} disabled={busy || !isAddress(serviceBeneficiary)}>{text("确认代报单", "Confirm assisted stake")}</button>
                  )}
                </article>

                <article className="service-action-card withdraw-card">
                  <div className="service-action-title"><span className="heading-icon"><DappIcon name="withdraw" size={17} /></span><div><strong>{text("代提现", "Assisted claim")}</strong><small>{text("90% 到目标钱包，5% 销毁，5% 到运营钱包", "90% goes to the beneficiary, 5% is burned, and 5% goes to operations")}</small></div></div>
                  <button className="service-action-button secondary" onClick={serviceWithdraw} disabled={busy || !isAddress(serviceBeneficiary)}>{text("确认代提现", "Confirm assisted claim")}</button>
                </article>
              </>
            )}
          </section>
        )}

        {ledgerKind && !serviceMode && (
          <section className="ledger-page" role="dialog" aria-modal="true" aria-labelledby="ledger-title">
            <header className="ledger-header">
              <button onClick={closeLedger} aria-label={text("返回质押页面", "Back to staking")}><DappIcon name="chevron" size={18} /></button>
              <div><small>ON-CHAIN RECORDS</small><h1 id="ledger-title">{ledgerKind === "power" ? text("个人算力明细", "Personal Power History") : text("推广额度明细", "Referral Quota History")}</h1></div>
            </header>
            <article className="ledger-balance-card">
              <span>{text("当前余额", "Current balance")}</span>
              <div><strong>{compact(ledgerKind === "power" ? snapshot.power : snapshot.promotionQuota, language)}</strong><small>{ledgerKind === "power" ? "POWER" : "U"}</small></div>
              <p>{ledgerKind === "power" ? text("记录质押增加、提现消耗和到期清零", "Staking additions, claim usage, and expirations") : text("记录质押增加和直推奖励消耗", "Staking additions and direct referral usage")}</p>
            </article>

            <div className="ledger-list-heading"><strong>{text("增减记录", "Transactions")}</strong><span>{ledgerEntries.length}</span></div>
            {ledgerLoading ? (
              <div className="ledger-state"><span className="ledger-spinner" />{text("正在读取链上记录…", "Loading on-chain records…")}</div>
            ) : ledgerError ? (
              <div className="ledger-state ledger-error"><span>{ledgerError[language]}</span><button onClick={() => openLedger(ledgerKind)}>{text("重新读取", "Retry")}</button></div>
            ) : ledgerEntries.length === 0 ? (
              <div className="ledger-state">{text("暂无增减记录", "No transactions yet")}</div>
            ) : (
              <div className="ledger-list">
                {ledgerEntries.map(entry => (
                  <article className="ledger-row" key={entry.id}>
                    <span className={`ledger-direction ${entry.direction}`}>{entry.direction === "increase" ? "+" : "−"}</span>
                    <div className="ledger-entry-info"><strong>{entry.label[language]}</strong><small>{entry.timestamp ? formatLedgerTime(entry.timestamp, language) : text("时间读取中", "Loading time")}</small><small>{text("链上存储记录", "On-chain stored record")}</small></div>
                    <div className={`ledger-amount ${entry.direction}`}><strong>{entry.direction === "increase" ? "+" : "−"}{compact(entry.amount, language, 4)}</strong><small>{ledgerKind === "power" ? "POWER" : "U"}</small></div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        <div className="tab-page" hidden={serviceMode || activeTab !== "home"}>
          <section className="balance-card" aria-label={text("今日已领取", "Claimed today")}>
            <div className="balance-topline">
              <span>{text("今日已领取", "Claimed today")}</span>
              <span className={`mode-chip ${todayClaimsError ? "error" : ""}`}>{todayClaimsError ? text("读取失败", "Read failed") : text("链上到账", "On-chain settled")}</span>
            </div>
            <div className="main-balance"><strong>{todayClaimsError ? "--" : compact(snapshot.claimedTodayGpc, language, 4)}</strong><span>GPC</span></div>
            <p>≈ {todayClaimsError ? "--" : compact(snapshot.claimedTodayUsdt, language, 4)} USDT</p>
            <div className="yield-split">
              <div><span>{text("静态收益", "Static reward")}</span><strong>{todayClaimsError ? "--" : compact(snapshot.claimedTodayStaticGpc, language, 4)} GPC</strong></div>
              <i />
              <div><span>{text("动态收益", "Dynamic reward")}</span><strong>{todayClaimsError ? "--" : compact(snapshot.claimedTodayDynamicGpc, language, 4)} GPC</strong></div>
            </div>
            <button className="claim-button" onClick={withdraw} disabled={busy || !account || !canWithdraw || snapshot.totalReward === 0n}>
              <DappIcon name="withdraw" size={18} />{text("领取收益", "Claim rewards")}
            </button>
            <div className="countdown-line"><span>{text("提现分配", "Claim allocation")}</span><strong>{text("90% 到账 · 5% 销毁 · 5% 运营", "90% net · 5% burn · 5% operations")}</strong></div>
            <div className="countdown-line"><span>{text("下次可领取", "Next claim")}</span><strong>{formatTime(snapshot.nextWithdrawAt, language)}</strong></div>
            <span className="card-glow" />
          </section>

          <section className="metrics-grid" aria-label={text("账户概览", "Account overview")}>
            <article><span>{text("个人算力", "Personal power")}</span><strong>{compact(snapshot.power, language)}</strong><small>POWER</small></article>
            <article><span>{text("GPC 销毁量", "GPC burned")}</span><strong>{compact(snapshot.burnedGpc, language, 2)}</strong><small>GPC</small></article>
            <article><span>{text("全网总算力", "Network power")}</span><strong>{compact(snapshot.totalPower, language)}</strong><small>POWER</small></article>
            <article><span>{text("订单矿池", "Mining pool")}</span><strong>{compact(snapshot.poolGpc, language)}</strong><small>GPC</small></article>
          </section>
        </div>

        <div className="tab-page" hidden={serviceMode || activeTab !== "order"}>
          <div className="page-heading"><span>STAKING</span><h1>{text("GPC质押挖矿", "GPC Staking Mining")}</h1><p>{text("测试阶段每次固定质押 1 USDT，链上自动完成分账并增加算力。", "During testing, stake a fixed 1 USDT. Allocation and mining power are handled on-chain.")}</p></div>
          <article className="order-card">
            <div className="order-value"><span>{text("质押金额", "Stake amount")}</span><div><strong>1</strong><b>USDT</b></div></div>
            <div className="order-receive"><span>{text("预计获得", "You receive")}</span><strong>{text("+2 算力", "+2 Power")}</strong><strong>{text("+1 U 推广额度", "+1 U Referral quota")}</strong></div>
            <div className="allocation" aria-label={text("质押资金分配", "Stake allocation")}>
              <div style={{ width: "10%" }} className="lp" />
              <div style={{ width: "20%" }} className="direct" />
              <div style={{ width: "70%" }} className="stake-pool" />
            </div>
            <div className="fund-legend"><span><i className="lp" />10% {text("筑 LP", "Build LP")}</span><span><i className="direct" />20% {text("直推", "Referral")}</span><span><i className="stake-pool" />70% {text("质押矿池", "Staking pool")}</span></div>
            <div className="wallet-row"><span>{text("USDT 余额", "USDT balance")}</span><strong>{compact(snapshot.usdtBalance, language)} USDT</strong></div>
            {!account ? (
              <button className="main-action" onClick={connectWallet} disabled={busy}>{text("连接钱包", "Connect wallet")}</button>
            ) : !isBound ? (
              <button className="main-action" disabled>{text("请先绑定上级", "Bind a sponsor first")}</button>
            ) : !hasEnoughUsdt ? (
              <button className="main-action" disabled>{text("USDT 余额不足（需要 1 USDT）", "Insufficient USDT (1 USDT required)")}</button>
            ) : needsApproval ? (
              <button className="main-action" onClick={approveUsdt} disabled={busy || !isConfigured}>{snapshot.allowance > ORDER_AMOUNT ? text("调整授权为 1 USDT", "Reset approval to 1 USDT") : text("授权 1 USDT", "Approve 1 USDT")}</button>
            ) : !snapshot.oracleReady ? (
              <button className="main-action" disabled>{text("价格服务更新中，请稍后刷新", "Price service updating; refresh shortly")}</button>
            ) : (
              <button className="main-action" onClick={placeOrder} disabled={busy || !isConfigured}>{text("确认质押", "Confirm staking")}</button>
            )}
            <div className="protect-note"><DappIcon name="shield" size={15} /><span>{text("5分钟观测 · 实时滚动6小时 · 不足6小时自动降级", "5-min observations · Live rolling 6H · Automatic fallback")}</span></div>
          </article>
          <article className="order-info-card">
            <div><span>{text("质押间隔", "Stake interval")}</span><strong>{text("1 分钟", "1 minute")}</strong></div>
            <button className="order-info-link" onClick={() => openLedger("power")} disabled={!account}><span>{text("个人算力", "Personal power")}</span><strong>{compact(snapshot.power, language)}</strong><DappIcon name="chevron" size={12} /></button>
            <button className="order-info-link" onClick={() => openLedger("promotionQuota")} disabled={!account}><span>{text("推广额度", "Referral quota")}</span><strong>{compact(snapshot.promotionQuota, language)} U</strong><DappIcon name="chevron" size={12} /></button>
          </article>
        </div>

        <div className="tab-page" hidden={serviceMode || activeTab !== "team"}>
          <div className="page-heading"><span>COMMUNITY</span><h1>{text("我的团队", "My Team")}</h1><p>{text("统计 30 层推荐关系，自动计算小区有效算力与社区奖励。", "Tracks 30 referral levels and calculates effective small-area power and community rewards.")}</p></div>
          <article className="community-hero">
            <span>{text("今日社区已收益", "Community earned today")}</span><strong>{compact(snapshot.communityClaimedToday, language, 4)} <small>USDT</small></strong><p>{snapshot.communityClaimedToday > 0n ? text("今日提现已结算的社区收益", "Community earnings settled in today's claim") : text("今日尚未领取社区收益", "No community earnings claimed today")}</p>
          </article>
          <article className="community-card">
            <div className="community-node-stats"><div><span>{text("直属节点数", "Direct nodes")}</span><strong>{formatCount(snapshot.directReferralCount, language)}</strong></div><div><span>{text("团队节点总数", "Total team nodes")}</span><strong>{formatCount(snapshot.teamNodeCount, language)}</strong></div></div>
            <div className="community-stats"><div><span>{text("小区总算力", "Total small-area power")}</span><strong>{compact(snapshot.smallArea, language)}</strong></div><div><span>{text("小区有效算力", "Effective small-area power")}</span><strong>{compact(snapshot.effectiveSmallArea, language)}</strong></div><div><span>{text("奖励状态", "Reward status")}</span><strong className={communityRewardBurned ? "burned" : "active"}>{snapshot.smallArea === 0n ? text("暂无", "None") : communityRewardBurned ? text("全部烧伤", "Burned") : text("已激活", "Active")}</strong></div></div>
            {isBound ? (
              <div className="parent-row"><span>{text("我的上级", "My sponsor")}</span><strong>{shortAddress(snapshot.parent)}</strong></div>
            ) : (
              <div className="team-connect-note">{text("连接钱包后查看团队信息", "Connect your wallet to view team data")}</div>
            )}
          </article>
          <article className="direct-list-card">
            <div className="direct-list-heading">
              <div><span className="heading-icon"><DappIcon name="team" size={17} /></span><strong>{text("直推下级", "Direct referrals")}</strong></div>
              <span>{formatCount(snapshot.directReferralCount, language)}</span>
            </div>
            {snapshot.directReferrals.length > 0 ? (
              <div className="direct-referral-list">
                {snapshot.directReferrals.map((referral, index) => {
                  const isLargestBranch = referral.branchPower > 0n && referral.address.toLowerCase() === snapshot.largestBranch.toLowerCase();
                  return (
                  <div className="direct-referral-row" key={referral.address}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div className="direct-referral-info"><strong>{shortAddress(referral.address)}</strong><small className={isLargestBranch ? "major" : "minor"}>{isLargestBranch ? text("大区", "Major area") : text("小区", "Small area")}</small></div>
                    <div className="direct-referral-power"><span>{text("伞下算力", "Branch power")}</span><strong>{compact(referral.branchPower, language)}</strong></div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div className="direct-empty">{account ? text("暂无直推下级，刷新后可查看最新链上关系", "No direct referrals yet. Refresh to load the latest on-chain relationships.") : text("连接钱包后查看直推下级", "Connect your wallet to view direct referrals")}</div>
            )}
            {BigInt(snapshot.directReferrals.length) < snapshot.directReferralCount && (
              <button className="direct-load-more" onClick={loadMoreReferrals} disabled={referralsLoading}>{referralsLoading ? text("读取中…", "Loading…") : text("加载更多", "Load more")}</button>
            )}
          </article>
          <div className="burn-note"><DappIcon name="shield" size={16} /><div><strong>{text("社区收益全额烧伤规则", "Full community reward burn")}</strong><span>{text("小区有效算力低于小区总算力时，社区收益为 0 并全部烧伤；只有有效算力覆盖全部小区总算力时，才获得 5% 小区奖励。", "If effective power is below total small-area power, the full community reward is burned to zero. The 5% reward is paid only when effective power covers the entire small area.")}</span></div></div>
        </div>

        <div className="tab-page" hidden={serviceMode || activeTab !== "ecosystem"}>
          <div className="page-heading"><span>ECOSYSTEM</span><h1>{text("GPC 传奇", "GPC Legend")}</h1><p>{text("探索由 GPC 通缩机制驱动的链游生态。", "Explore a blockchain gaming ecosystem powered by GPC tokenomics.")}</p></div>
          <article className="ecosystem-game-card">
            <span className="ecosystem-kicker">GPC LEGEND</span>
            <h2>{text("GPC首个链游—GPC传奇", "GPC's First Blockchain Game — GPC Legend")}</h2>
            <p className="ecosystem-intro">{text(
              "GPC传奇是全球首款道具交易一体化的区块链生态链游，底层基于去中心化代币 GPC 运行，让游戏资产真正进入链上价值体系。",
              "GPC Legend is the world's first blockchain ecosystem game with integrated item trading. Powered by the decentralized GPC token, it brings game assets into an on-chain value system."
            )}</p>

            <div className="ecosystem-rate-card">
              <span>{text("链上恒定充值规则", "PERMANENT ON-CHAIN RATE")}</span>
              <strong>1 GPC = 10 {text("元宝", "INGOTS")}</strong>
              <small>{text("协议永久固定，无法修改", "Fixed permanently by the protocol")}</small>
            </div>

            <div className="ecosystem-feature-list">
              <section className="ecosystem-feature-item">
                <span>01</span>
                <div><strong>{text("游戏资产自由流通", "TRADEABLE GAME ASSETS")}</strong><p>{text("账号、装备和道具共同构成游戏资产体系；游戏内道具支持直接出售并兑换 GPC。", "Accounts, equipment, and items form a connected game economy, with in-game items directly tradeable for GPC.")}</p></div>
              </section>
              <section className="ecosystem-feature-item">
                <span>02</span>
                <div><strong>{text("玩家充值全部销毁", "EVERY RECHARGE IS BURNED")}</strong><p>{text("所有用于充值的 GPC 都会进入黑洞地址，持续减少市场流通量。", "Every GPC used for recharge is sent to the burn address, continuously reducing circulating supply.")}</p></div>
              </section>
              <section className="ecosystem-feature-item">
                <span>03</span>
                <div><strong>{text("通缩机制持续赋能", "DEFLATION POWERS THE ECOSYSTEM")}</strong><p>{text("GPC 总量恒定，并在交易与充值过程中持续销毁，让代币、账号及装备道具形成长期价值联动。", "GPC has a fixed supply and is continuously burned through transactions and recharge, connecting the long-term value of the token, accounts, equipment, and items.")}</p></div>
              </section>
            </div>

            <p className="ecosystem-closing">{text(
              "通缩机制持续赋能生态，打造参与者共同受益的良性链游环境。点击下方进入游戏，即刻开启全新冒险之旅！",
              "This deflationary model supports a healthy game economy designed for shared ecosystem growth. Enter the game below and begin your new adventure."
            )}</p>
            <a className="enter-game-button" href="http://cq.opengpc.com" target="_blank" rel="noreferrer"><DappIcon name="link" size={18} />{text("进入游戏", "Enter Game")}</a>
          </article>
        </div>

        {!serviceMode && <nav className="bottom-nav" aria-label={text("主导航", "Main navigation")}>
          <button className={activeTab === "home" ? "active" : ""} onClick={() => switchTab("home")}><DappIcon name="home" /><span>{text("首页", "Home")}</span></button>
          <button className={activeTab === "order" ? "active" : ""} onClick={() => switchTab("order")}><DappIcon name="order" /><span>{text("质押", "Stake")}</span></button>
          <button className={activeTab === "team" ? "active" : ""} onClick={() => switchTab("team")}><DappIcon name="team" /><span>{text("团队", "Team")}</span></button>
          <button className={activeTab === "ecosystem" ? "active" : ""} onClick={() => switchTab("ecosystem")}><DappIcon name="link" /><span>{text("生态", "Ecosystem")}</span></button>
        </nav>}

        {bindingRequired && !serviceMode && (
          <div className="binding-gate" role="dialog" aria-modal="true" aria-labelledby="binding-title">
            <div className="binding-modal">
              <span className="binding-mark"><DappIcon name="link" size={24} /></span>
              <small>GPC REFERRAL</small>
              <h2 id="binding-title">{text("绑定上级", "Bind Your Sponsor")}</h2>
              <p>{text("首次进入必须绑定有效上级。关系写入链上后不可修改。", "A valid sponsor is required on first entry. This on-chain relationship cannot be changed.")}</p>
              <label htmlFor="binding-parent">{text("上级钱包地址", "Sponsor wallet address")}</label>
              <input id="binding-parent" value={parentInput} onFocus={event => event.currentTarget.scrollIntoView({ block: "center", behavior: "smooth" })} onChange={event => setParentInput(event.target.value.trim())} placeholder="0x..." autoComplete="off" autoCapitalize="none" inputMode="text" spellCheck={false} />
              <button onClick={bindReferral} disabled={busy || !isConfigured}>{busy ? text("验证并处理中…", "Validating…") : text("验证地址并绑定", "Validate and bind")}</button>
              <div className="binding-lock"><DappIcon name="shield" size={15} />{text("未完成绑定前无法进入其他页面", "Other pages remain locked until binding is complete")}</div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
