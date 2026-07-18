"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrowserProvider,
  Contract,
  formatEther,
  isAddress,
} from "ethers";

const viteEnv = import.meta.env as Record<string, string | undefined>;
const nodeEnv = typeof process === "undefined" ? undefined : process.env;
const MINING_ADDRESS = viteEnv.VITE_MINING_ADDRESS ?? nodeEnv?.NEXT_PUBLIC_MINING_ADDRESS ?? "";
const USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
const GPC_ADDRESS = "0xD3c304697f63B279cd314F92c19cDBE5E5b1631A";
const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const BSC_CHAIN_ID = "0x38";

const MINING_ABI = [
  "function parentOf(address) view returns (address)",
  "function users(address) view returns (uint256 power,uint256 totalPowerPurchased,uint256 promotionQuota,uint64 lastOrderAt,uint64 nextWithdrawAt,uint64 inactivityStartedAt)",
  "function totalPower() view returns (uint256)",
  "function miningPoolGpc() view returns (uint256)",
  "function communityPower(address) view returns (uint256 total,uint256 largestBranchPower,uint256 smallArea,uint256 effectiveSmallArea)",
  "function directReferrals(address) view returns (address[])",
  "function branchPower(address,address) view returns (uint256)",
  "function largestBranch(address) view returns (address branch,uint256 power)",
  "function teamNodeCount(address) view returns (uint256)",
  "function quoteRewards(address) view returns ((uint256 staticRewardUsdt,uint256 communityRewardUsdt,uint256 totalRewardUsdt,uint256 grossGpc,uint256 gpcPrice,uint256 poolValueUsdt,uint256 smallAreaPower,uint256 effectiveSmallAreaPower,bool poolLimitedMode))",
  "function oracle() view returns (address)",
  "function bindReferral(address parent)",
  "function router() view returns (address)",
  "function placeOrder(uint256 deadline,uint256 userMinGpcOut,uint256 userMinWbnbOut,uint256 userMinLpGpc,uint256 userMinLpWbnb)",
  "function withdraw()",
  "error RootCannotOrder()",
  "error ReferralRequired()",
  "error OrderCooldownActive()",
  "error InvalidDeadline()",
  "error OraclePriceInvalid()",
  "error SpotTwapDeviationTooHigh(address asset,uint256 spotPrice,uint256 twapPrice)",
  "error SwapOutputTooLow()",
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
const USER_SWAP_SLIPPAGE_BPS = 50n; // 0.5% from the pre-signing router quote
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
  usdtBalance: bigint;
  allowance: bigint;
  staticReward: bigint;
  communityReward: bigint;
  totalReward: bigint;
  grossGpc: bigint;
  smallArea: bigint;
  effectiveSmallArea: bigint;
  poolLimitedMode: boolean;
  oracleReady: boolean;
  largestBranch: string;
  teamNodeCount: bigint;
  directReferrals: Array<{ address: string; branchPower: bigint }>;
};

type AppTab = "home" | "order" | "team" | "profile";
type Language = "zh" | "en";
type LocalizedStatus = { zh: string; en: string };

const emptySnapshot: Snapshot = {
  power: 0n,
  promotionQuota: 0n,
  nextWithdrawAt: 0,
  inactivityStartedAt: 0,
  parent: ZERO_ADDRESS,
  totalPower: 0n,
  poolGpc: 0n,
  usdtBalance: 0n,
  allowance: 0n,
  staticReward: 0n,
  communityReward: 0n,
  totalReward: 0n,
  grossGpc: 0n,
  smallArea: 0n,
  effectiveSmallArea: 0n,
  poolLimitedMode: false,
  oracleReady: false,
  largestBranch: ZERO_ADDRESS,
  teamNodeCount: 0n,
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

  const text = (zh: string, en: string) => language === "zh" ? zh : en;

  const isConfigured = isAddress(MINING_ADDRESS);
  const isBound = snapshot.parent !== ZERO_ADDRESS;
  const needsApproval = snapshot.allowance < ORDER_AMOUNT;
  const hasEnoughUsdt = snapshot.usdtBalance >= ORDER_AMOUNT;
  const canWithdraw = snapshot.nextWithdrawAt !== 0 && currentTime >= snapshot.nextWithdrawAt;
  const bindingRequired = Boolean(account) && !isBound;
  const communityRewardBurned = snapshot.effectiveSmallArea < snapshot.smallArea;

  const contractLink = useMemo(
    () => `https://bscscan.com/token/${GPC_ADDRESS}`,
    [],
  );

  useEffect(() => {
    const savedLanguage = window.localStorage.getItem("gpc-language");
    if (savedLanguage !== "zh" && savedLanguage !== "en") return;
    const restoreLanguage = window.setTimeout(() => setLanguage(savedLanguage), 0);
    return () => window.clearTimeout(restoreLanguage);
  }, []);

  function toggleLanguage() {
    const nextLanguage: Language = language === "zh" ? "en" : "zh";
    setLanguage(nextLanguage);
    window.localStorage.setItem("gpc-language", nextLanguage);
  }

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum?.on) return;

    const invalidateSession = () => {
      setProvider(null);
      setAccount("");
      setSnapshot(emptySnapshot);
      setCurrentTime(0);
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
    if (!isConfigured) {
      setStatus({ zh: "等待配置已部署的挖矿合约地址", en: "Waiting for the deployed mining contract address" });
      return;
    }

    const mining = new Contract(MINING_ADDRESS, MINING_ABI, activeProvider);
    const usdt = new Contract(USDT_ADDRESS, ERC20_ABI, activeProvider);
    const [user, parent, totalPower, poolGpc, community, directReferralAddresses, largestBranch, teamNodeCount, usdtBalance, allowance, oracleAddress] = await Promise.all([
      mining.users(activeAccount),
      mining.parentOf(activeAccount),
      mining.totalPower(),
      mining.miningPoolGpc(),
      mining.communityPower(activeAccount),
      mining.directReferrals(activeAccount),
      mining.largestBranch(activeAccount),
      mining.teamNodeCount(activeAccount),
      usdt.balanceOf(activeAccount),
      usdt.allowance(activeAccount, MINING_ADDRESS),
      mining.oracle(),
    ]);
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
      // The oracle deliberately rejects quotes before its first six-hour update or while stale.
    }

    setSnapshot({
      power: user.power,
      promotionQuota: user.promotionQuota,
      nextWithdrawAt: Number(user.nextWithdrawAt),
      inactivityStartedAt: Number(user.inactivityStartedAt),
      parent,
      totalPower,
      poolGpc,
      usdtBalance,
      allowance,
      staticReward: reward?.staticRewardUsdt ?? 0n,
      communityReward: reward?.communityRewardUsdt ?? 0n,
      totalReward: reward?.totalRewardUsdt ?? 0n,
      grossGpc: reward?.grossGpc ?? 0n,
      smallArea: community.smallArea,
      effectiveSmallArea: community.effectiveSmallArea,
      poolLimitedMode: reward?.poolLimitedMode ?? false,
      oracleReady,
      largestBranch: largestBranch.branch,
      teamNodeCount,
      directReferrals,
    });
    setCurrentTime(Math.floor(Date.now() / 1000));
    setStatus(oracleReady
      ? { zh: "链上数据已更新", en: "On-chain data updated" }
      : { zh: "合约已部署，Oracle 暂未就绪", en: "Contract deployed; Oracle is not ready yet" });
  }, [isConfigured]);

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
        rpcUrls: ["https://bsc-dataseed.binance.org"],
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

  function placeOrder() {
    return runTransaction({ zh: "GPC 质押", en: "GPC staking" }, async signer => {
      const mining = new Contract(MINING_ADDRESS, MINING_ABI, signer);
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
      const deadline = Math.floor(Date.now() / 1000) + 300;
      await mining.placeOrder.staticCall(deadline, minGpcOut, minWbnbOut, minLpGpc, minLpWbnb);
      const estimatedGas = await mining.placeOrder.estimateGas(deadline, minGpcOut, minWbnbOut, minLpGpc, minLpWbnb);
      return mining.placeOrder(deadline, minGpcOut, minWbnbOut, minLpGpc, minLpWbnb, { gasLimit: gasLimitWithHeadroom(estimatedGas) });
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

        <div className="tab-page" hidden={activeTab !== "home"}>
          <section className="balance-card" aria-label={text("今日收益", "Today's rewards")}>
            <div className="balance-topline">
              <span>{text("今日可领取", "Claimable today")}</span>
              <span className="mode-chip">{snapshot.poolLimitedMode ? text("矿池模式", "Pool mode") : text("固定模式", "Fixed mode")}</span>
            </div>
            <div className="main-balance"><strong>{compact(snapshot.grossGpc, language, 4)}</strong><span>GPC</span></div>
            <p>≈ {compact(snapshot.totalReward, language, 4)} USDT</p>
            <div className="yield-split">
              <div><span>{text("静态收益", "Static reward")}</span><strong>{compact(snapshot.staticReward, language, 4)} U</strong></div>
              <i />
              <div><span>{text("社区收益", "Community reward")}</span><strong>{compact(snapshot.communityReward, language, 4)} U</strong></div>
            </div>
            <button className="claim-button" onClick={withdraw} disabled={busy || !account || !canWithdraw || snapshot.totalReward === 0n}>
              <DappIcon name="withdraw" size={18} />{text("领取收益", "Claim rewards")}
            </button>
            <div className="countdown-line"><span>{text("下次可领取", "Next claim")}</span><strong>{formatTime(snapshot.nextWithdrawAt, language)}</strong></div>
            <span className="card-glow" />
          </section>

          <section className="metrics-grid" aria-label={text("账户概览", "Account overview")}>
            <article><span>{text("个人算力", "Personal power")}</span><strong>{compact(snapshot.power, language)}</strong><small>POWER</small></article>
            <article><span>{text("今日预计", "Estimated today")}</span><strong>{compact(snapshot.totalReward, language, 4)}</strong><small>USDT</small></article>
            <article><span>{text("全网总算力", "Network power")}</span><strong>{compact(snapshot.totalPower, language)}</strong><small>POWER</small></article>
            <article><span>{text("订单矿池", "Mining pool")}</span><strong>{compact(snapshot.poolGpc, language)}</strong><small>GPC</small></article>
          </section>
        </div>

        <div className="tab-page" hidden={activeTab !== "order"}>
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
              <button className="main-action" onClick={approveUsdt} disabled={busy || !isConfigured}>{text("授权 1 USDT", "Approve 1 USDT")}</button>
            ) : !snapshot.oracleReady ? (
              <button className="main-action" disabled>{text("价格服务更新中，请稍后刷新", "Price service updating; refresh shortly")}</button>
            ) : (
              <button className="main-action" onClick={placeOrder} disabled={busy || !isConfigured}>{text("确认质押", "Confirm staking")}</button>
            )}
            <div className="protect-note"><DappIcon name="shield" size={15} /><span>{text("5分钟观测 · 实时滚动6小时 · 不足6小时自动降级", "5-min observations · Live rolling 6H · Automatic fallback")}</span></div>
          </article>
          <article className="order-info-card">
            <div><span>{text("质押间隔", "Stake interval")}</span><strong>{text("1 分钟", "1 minute")}</strong></div><div><span>{text("个人算力", "Personal power")}</span><strong>{compact(snapshot.power, language)}</strong></div><div><span>{text("推广额度", "Referral quota")}</span><strong>{compact(snapshot.promotionQuota, language)} U</strong></div>
          </article>
        </div>

        <div className="tab-page" hidden={activeTab !== "team"}>
          <div className="page-heading"><span>COMMUNITY</span><h1>{text("我的团队", "My Team")}</h1><p>{text("统计 30 层推荐关系，自动计算小区有效算力与社区奖励。", "Tracks 30 referral levels and calculates effective small-area power and community rewards.")}</p></div>
          <article className="community-hero">
            <span>{text("今日社区收益", "Community reward today")}</span><strong>{compact(snapshot.communityReward, language, 4)} <small>USDT</small></strong><p>{communityRewardBurned ? text("有效算力低于小区总算力，本次社区收益全部烧伤", "Effective power is below total small-area power; the community reward is fully burned") : text("有效算力覆盖小区总算力，获得小区日收益的 5%", "Effective power covers the total small area; earn 5% of its daily rewards")}</p>
          </article>
          <article className="community-card">
            <div className="community-node-stats"><div><span>{text("直属节点数", "Direct nodes")}</span><strong>{formatCount(BigInt(snapshot.directReferrals.length), language)}</strong></div><div><span>{text("团队节点总数", "Total team nodes")}</span><strong>{formatCount(snapshot.teamNodeCount, language)}</strong></div></div>
            <div className="community-stats"><div><span>{text("小区总算力", "Total small-area power")}</span><strong>{compact(snapshot.smallArea, language)}</strong></div><div><span>{text("小区有效算力", "Effective small-area power")}</span><strong>{compact(snapshot.effectiveSmallArea, language)}</strong></div><div><span>{text("奖励状态", "Reward status")}</span><strong className={communityRewardBurned ? "burned" : "active"}>{snapshot.smallArea === 0n ? text("暂无", "None") : communityRewardBurned ? text("全部烧伤", "Burned") : text("已激活", "Active")}</strong></div></div>
            {isBound ? (
              <a className="parent-row" href={`https://bscscan.com/address/${snapshot.parent}`} target="_blank" rel="noreferrer"><span>{text("我的上级", "My sponsor")}</span><strong>{shortAddress(snapshot.parent)}</strong><DappIcon name="chevron" size={16} /></a>
            ) : (
              <div className="team-connect-note">{text("连接钱包后查看团队信息", "Connect your wallet to view team data")}</div>
            )}
          </article>
          <article className="direct-list-card">
            <div className="direct-list-heading">
              <div><span className="heading-icon"><DappIcon name="team" size={17} /></span><strong>{text("直推下级", "Direct referrals")}</strong></div>
              <span>{snapshot.directReferrals.length}</span>
            </div>
            {snapshot.directReferrals.length > 0 ? (
              <div className="direct-referral-list">
                {snapshot.directReferrals.map((referral, index) => {
                  const isLargestBranch = referral.branchPower > 0n && referral.address.toLowerCase() === snapshot.largestBranch.toLowerCase();
                  return (
                  <a className="direct-referral-row" href={`https://bscscan.com/address/${referral.address}`} target="_blank" rel="noreferrer" key={referral.address}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div className="direct-referral-info"><strong>{shortAddress(referral.address)}</strong><small className={isLargestBranch ? "major" : "minor"}>{isLargestBranch ? text("大区", "Major area") : text("小区", "Small area")}</small></div>
                    <div className="direct-referral-power"><span>{text("伞下算力", "Branch power")}</span><strong>{compact(referral.branchPower, language)}</strong></div>
                    <DappIcon name="chevron" size={16} />
                  </a>
                  );
                })}
              </div>
            ) : (
              <div className="direct-empty">{account ? text("暂无直推下级，刷新后可查看最新链上关系", "No direct referrals yet. Refresh to load the latest on-chain relationships.") : text("连接钱包后查看直推下级", "Connect your wallet to view direct referrals")}</div>
            )}
          </article>
          <div className="burn-note"><DappIcon name="shield" size={16} /><div><strong>{text("社区收益全额烧伤规则", "Full community reward burn")}</strong><span>{text("小区有效算力低于小区总算力时，社区收益为 0 并全部烧伤；只有有效算力覆盖全部小区总算力时，才获得 5% 小区奖励。", "If effective power is below total small-area power, the full community reward is burned to zero. The 5% reward is paid only when effective power covers the entire small area.")}</span></div></div>
        </div>

        <div className="tab-page" hidden={activeTab !== "profile"}>
          <div className="page-heading"><span>ACCOUNT</span><h1>{text("我的账户", "My Account")}</h1><p>{text("查看钱包资产、推广额度和个人算力。", "View wallet assets, referral quota, and personal mining power.")}</p></div>
          <article className="profile-card">
            <div className="profile-wallet"><span><DappIcon name="wallet" size={20} /></span><div><small>{text("当前钱包", "Current wallet")}</small><strong>{account ? shortAddress(account) : text("尚未连接", "Not connected")}</strong></div><button onClick={connectWallet} disabled={busy}>{account ? text("切换", "Switch") : text("连接", "Connect")}</button></div>
            <div className="profile-assets"><div><span>{text("USDT 余额", "USDT balance")}</span><strong>{compact(snapshot.usdtBalance, language)}</strong></div><div><span>{text("推广额度", "Referral quota")}</span><strong>{compact(snapshot.promotionQuota, language)}</strong></div><div><span>{text("个人算力", "Personal power")}</span><strong>{compact(snapshot.power, language)}</strong></div><div><span>{text("下次提现", "Next claim")}</span><strong>{snapshot.nextWithdrawAt ? formatTime(snapshot.nextWithdrawAt, language) : text("未开始", "Not started")}</strong></div></div>
          </article>
          <a className="contract-link" href={contractLink} target="_blank" rel="noreferrer">{text("查看 GPC 代币合约", "View GPC token contract")} <DappIcon name="chevron" size={15} /></a>
        </div>

        <nav className="bottom-nav" aria-label={text("主导航", "Main navigation")}>
          <button className={activeTab === "home" ? "active" : ""} onClick={() => switchTab("home")}><DappIcon name="home" /><span>{text("首页", "Home")}</span></button>
          <button className={activeTab === "order" ? "active" : ""} onClick={() => switchTab("order")}><DappIcon name="order" /><span>{text("质押", "Stake")}</span></button>
          <button className={activeTab === "team" ? "active" : ""} onClick={() => switchTab("team")}><DappIcon name="team" /><span>{text("团队", "Team")}</span></button>
          <button className={activeTab === "profile" ? "active" : ""} onClick={() => switchTab("profile")}><DappIcon name="user" /><span>{text("我的", "Account")}</span></button>
        </nav>

        {bindingRequired && (
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
