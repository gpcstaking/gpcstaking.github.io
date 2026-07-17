"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BrowserProvider,
  Contract,
  MaxUint256,
  formatEther,
  isAddress,
} from "ethers";

const viteEnv = import.meta.env as Record<string, string | undefined>;
const nodeEnv = typeof process === "undefined" ? undefined : process.env;
const MINING_ADDRESS = viteEnv.VITE_MINING_ADDRESS ?? nodeEnv?.NEXT_PUBLIC_MINING_ADDRESS ?? "";
const PRIVATE_BSC_RPC_URL = viteEnv.VITE_PRIVATE_BSC_RPC_URL ?? nodeEnv?.NEXT_PUBLIC_PRIVATE_BSC_RPC_URL ?? "";
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
  "function quoteRewards(address) view returns ((uint256 staticRewardUsdt,uint256 communityRewardUsdt,uint256 totalRewardUsdt,uint256 grossGpc,uint256 gpcPrice,uint256 poolValueUsdt,uint256 smallAreaPower,uint256 effectiveSmallAreaPower,bool poolLimitedMode))",
  "function oracle() view returns (address)",
  "function bindReferral(address parent)",
  "function router() view returns (address)",
  "function placeOrder(uint256 deadline,uint256 userMinGpcOut,uint256 userMinWbnbOut,uint256 userMinLpGpc,uint256 userMinLpWbnb)",
  "function withdraw()",
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
const ORDER_AMOUNT = 1000n * 10n ** 18n;
const GPC_SWAP_AMOUNT = 700n * 10n ** 18n;
const WBNB_SWAP_AMOUNT = 50n * 10n ** 18n;
const BPS = 10_000n;
const USER_SWAP_SLIPPAGE_BPS = 50n; // 0.5% from the pre-signing router quote
const LP_SLIPPAGE_BPS = 200n;

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
};

type AppTab = "home" | "order" | "team" | "profile";

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

function compact(value: bigint, maximumFractionDigits = 2) {
  const number = Number(formatEther(value));
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits }).format(number);
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatTime(timestamp: number) {
  if (!timestamp) return "报单后开始计时";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
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
  const [status, setStatus] = useState("连接钱包后读取链上数据");
  const [busy, setBusy] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeTab, setActiveTab] = useState<AppTab>("home");

  const isConfigured = isAddress(MINING_ADDRESS);
  const isBound = snapshot.parent !== ZERO_ADDRESS;
  const needsApproval = snapshot.allowance < ORDER_AMOUNT;
  const hasEnoughUsdt = snapshot.usdtBalance >= ORDER_AMOUNT;
  const canWithdraw = snapshot.nextWithdrawAt !== 0 && currentTime >= snapshot.nextWithdrawAt;

  const contractLink = useMemo(
    () => isConfigured ? `https://bscscan.com/address/${MINING_ADDRESS}` : "https://bscscan.com",
    [isConfigured],
  );

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum?.on) return;

    const invalidateSession = () => {
      setProvider(null);
      setAccount("");
      setSnapshot(emptySnapshot);
      setCurrentTime(0);
      setStatus("钱包账户或网络已变更，请重新连接");
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
      setStatus("等待配置已部署的挖矿合约地址");
      return;
    }

    const mining = new Contract(MINING_ADDRESS, MINING_ABI, activeProvider);
    const usdt = new Contract(USDT_ADDRESS, ERC20_ABI, activeProvider);
    const [user, parent, totalPower, poolGpc, community, usdtBalance, allowance, oracleAddress] = await Promise.all([
      mining.users(activeAccount),
      mining.parentOf(activeAccount),
      mining.totalPower(),
      mining.miningPoolGpc(),
      mining.communityPower(activeAccount),
      usdt.balanceOf(activeAccount),
      usdt.allowance(activeAccount, MINING_ADDRESS),
      mining.oracle(),
    ]);
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
    });
    setCurrentTime(Math.floor(Date.now() / 1000));
    setStatus(oracleReady ? "链上数据已更新" : "合约已部署，等待首次 6 小时均价发布");
  }, [isConfigured]);

  async function connectWallet() {
    if (!window.ethereum) {
      setStatus("未检测到钱包，请安装 MetaMask 或兼容钱包");
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
          await addBscNetwork(PRIVATE_BSC_RPC_URL || "https://bsc-dataseed.binance.org");
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
      setStatus(error instanceof Error ? error.message : "钱包连接失败");
    } finally {
      setBusy(false);
    }
  }

  async function addBscNetwork(rpcUrl: string) {
    if (!window.ethereum) throw new Error("未检测到兼容钱包");
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: BSC_CHAIN_ID,
        chainName: PRIVATE_BSC_RPC_URL ? "BSC Mainnet · Protected RPC" : "BNB Smart Chain Mainnet",
        nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
        rpcUrls: [rpcUrl],
        blockExplorerUrls: ["https://bscscan.com"],
      }],
    });
  }

  async function configureProtectedNetwork() {
    if (!PRIVATE_BSC_RPC_URL) {
      setStatus("部署方尚未配置公开可用的BSC私有交易RPC");
      return;
    }
    try {
      setBusy(true);
      await addBscNetwork(PRIVATE_BSC_RPC_URL);
      setStatus("已请求钱包添加保护RPC；请在钱包网络设置中确认当前RPC");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保护RPC配置失败");
    } finally {
      setBusy(false);
    }
  }

  async function runTransaction(label: string, action: (signer: Awaited<ReturnType<BrowserProvider["getSigner"]>>) => Promise<{ wait: () => Promise<unknown> }>) {
    if (!provider || !account) return connectWallet();
    try {
      setBusy(true);
      const chainId = await window.ethereum?.request({ method: "eth_chainId" });
      if (chainId !== BSC_CHAIN_ID) throw new Error("当前网络不是 BSC Mainnet，请重新连接钱包");
      setStatus(`${label}：请在钱包中确认`);
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();
      if (signerAddress.toLowerCase() !== account.toLowerCase()) {
        throw new Error("钱包账户已变更，请重新连接后再操作");
      }
      const transaction = await action(signer);
      setStatus(`${label}：等待链上确认`);
      await transaction.wait();
      await refresh(provider, account);
      setStatus(`${label}成功`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${label}失败`);
    } finally {
      setBusy(false);
    }
  }

  function bindReferral() {
    if (!isAddress(parentInput)) {
      setStatus("请输入有效的上级钱包地址");
      return;
    }
    return runTransaction("绑定上级", async signer => {
      const mining = new Contract(MINING_ADDRESS, MINING_ABI, signer);
      return mining.bindReferral(parentInput);
    });
  }

  function approveUsdt() {
    return runTransaction("授权 USDT", async signer => {
      const usdt = new Contract(USDT_ADDRESS, ERC20_ABI, signer);
      return usdt.approve(MINING_ADDRESS, MaxUint256);
    });
  }

  function placeOrder() {
    return runTransaction("报单", async signer => {
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
      return mining.placeOrder(deadline, minGpcOut, minWbnbOut, minLpGpc, minLpWbnb);
    });
  }

  function withdraw() {
    return runTransaction("提现", async signer => {
      const mining = new Contract(MINING_ADDRESS, MINING_ABI, signer);
      return mining.withdraw();
    });
  }

  function switchTab(tab: AppTab) {
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <main className="mobile-stage">
      <div className="dapp-shell" id="top">
        <header className="app-header">
          <a className="app-brand" href="#top" aria-label="GPC Protocol 首页">
            <span className="app-logo">G</span>
            <span><strong>GPC</strong><small>MINING</small></span>
          </a>
          <div className="header-actions">
            <span className="chain-chip"><i />BSC</span>
            <button className="connect-pill" onClick={connectWallet} disabled={busy}>
              <DappIcon name="wallet" size={15} />
              {account ? shortAddress(account) : "连接钱包"}
            </button>
          </div>
        </header>

        <div className="status-strip" role="status">
          <span className="live-dot" />
          <span>{status}</span>
          <button onClick={() => provider && account && refresh(provider, account)} disabled={!account || busy}><DappIcon name="refresh" size={14} /></button>
        </div>

        <div className="tab-page" hidden={activeTab !== "home"}>
          <section className="balance-card" aria-label="今日收益">
            <div className="balance-topline">
              <span>今日可领取</span>
              <span className="mode-chip">{snapshot.poolLimitedMode ? "矿池模式" : "固定模式"}</span>
            </div>
            <div className="main-balance"><strong>{compact(snapshot.grossGpc, 4)}</strong><span>GPC</span></div>
            <p>≈ {compact(snapshot.totalReward, 4)} USDT</p>
            <div className="yield-split">
              <div><span>静态收益</span><strong>{compact(snapshot.staticReward, 4)} U</strong></div>
              <i />
              <div><span>社区收益</span><strong>{compact(snapshot.communityReward, 4)} U</strong></div>
            </div>
            <button className="claim-button" onClick={withdraw} disabled={busy || !account || !canWithdraw || snapshot.totalReward === 0n}>
              <DappIcon name="withdraw" size={18} />领取收益
            </button>
            <div className="countdown-line"><span>下次可领取</span><strong>{formatTime(snapshot.nextWithdrawAt)}</strong></div>
            <span className="card-glow" />
          </section>

          <section className="quick-actions" aria-label="快捷操作">
            <button onClick={() => switchTab("order")}><span><DappIcon name="order" /></span><small>报单</small></button>
            <button onClick={withdraw} disabled={busy || !account || !canWithdraw || snapshot.totalReward === 0n}><span><DappIcon name="withdraw" /></span><small>提现</small></button>
            <button onClick={() => switchTab("team")}><span><DappIcon name="link" /></span><small>绑定</small></button>
            <button onClick={() => provider && account && refresh(provider, account)} disabled={!account || busy}><span><DappIcon name="refresh" /></span><small>刷新</small></button>
          </section>

          <section className="metrics-grid" aria-label="账户概览">
            <article><span>个人算力</span><strong>{compact(snapshot.power)}</strong><small>POWER</small></article>
            <article><span>今日预计</span><strong>{compact(snapshot.totalReward, 4)}</strong><small>USDT</small></article>
            <article><span>全网总算力</span><strong>{compact(snapshot.totalPower)}</strong><small>POWER</small></article>
            <article><span>订单矿池</span><strong>{compact(snapshot.poolGpc)}</strong><small>GPC</small></article>
          </section>
        </div>

        <div className="tab-page" hidden={activeTab !== "order"}>
          <div className="page-heading"><span>ORDER</span><h1>固定报单</h1><p>每单固定 1,000 USDT，链上自动完成分账并增加算力。</p></div>
          <article className="order-card">
            <div className="order-value"><span>报单金额</span><div><strong>1,000</strong><b>USDT</b></div></div>
            <div className="order-receive"><span>预计获得</span><strong>+2,000 算力</strong><strong>+1,000 U 推广额度</strong></div>
            <div className="allocation" aria-label="报单资金分配">
              <div style={{ width: "20%" }} className="direct" /><div style={{ width: "5%" }} className="operation" />
              <div style={{ width: "70%" }} className="buy" /><div style={{ width: "5%" }} className="lp" />
            </div>
            <div className="fund-legend"><span><i className="direct" />直推 20%</span><span><i className="operation" />运营 5%</span><span><i className="buy" />GPC 70%</span><span><i className="lp" />WBNB 5%</span></div>
            <div className="wallet-row"><span>USDT 余额</span><strong>{compact(snapshot.usdtBalance)} USDT</strong></div>
            {!account ? (
              <button className="main-action" onClick={connectWallet} disabled={busy}>连接钱包</button>
            ) : !isBound ? (
              <button className="main-action" onClick={() => switchTab("team")}>请先绑定上级</button>
            ) : needsApproval ? (
              <button className="main-action" onClick={approveUsdt} disabled={busy || !isConfigured}>授权 USDT</button>
            ) : (
              <button className="main-action" onClick={placeOrder} disabled={busy || !isConfigured || !snapshot.oracleReady || !hasEnoughUsdt}>确认报单</button>
            )}
            <div className="protect-note"><DappIcon name="shield" size={15} /><span>6H TWAP · 成交下限保护 0.5% · 偏差限制 1%</span></div>
          </article>
          <article className="order-info-card">
            <div><span>报单间隔</span><strong>1 分钟</strong></div><div><span>个人算力</span><strong>{compact(snapshot.power)}</strong></div><div><span>推广额度</span><strong>{compact(snapshot.promotionQuota)} U</strong></div>
          </article>
        </div>

        <div className="tab-page" hidden={activeTab !== "team"}>
          <div className="page-heading"><span>COMMUNITY</span><h1>我的团队</h1><p>统计 30 层推荐关系，自动计算小区有效算力与社区奖励。</p></div>
          <article className="community-hero">
            <span>今日社区收益</span><strong>{compact(snapshot.communityReward, 4)} <small>USDT</small></strong><p>小区有效算力日收益的 5%</p>
          </article>
          <article className="community-card">
            <div className="community-stats"><div><span>小区算力</span><strong>{compact(snapshot.smallArea)}</strong></div><div><span>有效小区</span><strong>{compact(snapshot.effectiveSmallArea)}</strong></div><div><span>奖励比例</span><strong>5%</strong></div></div>
            {isBound ? (
              <a className="parent-row" href={`https://bscscan.com/address/${snapshot.parent}`} target="_blank" rel="noreferrer"><span>我的上级</span><strong>{shortAddress(snapshot.parent)}</strong><DappIcon name="chevron" size={16} /></a>
            ) : (
              <div className="mobile-bind-form">
                <label htmlFor="parent">绑定上级地址</label>
                <div><input id="parent" value={parentInput} onChange={event => setParentInput(event.target.value)} placeholder="输入 0x 钱包地址" /><button onClick={bindReferral} disabled={busy || !account || !isConfigured}>绑定</button></div>
                <small>关系绑定后不可更改，上级须已在推荐网络中。</small>
              </div>
            )}
          </article>
          <div className="burn-note"><DappIcon name="shield" size={16} /><div><strong>社区收益烧伤规则</strong><span>有效小区算力最高为个人算力的 5 倍，超出部分不计入奖励。</span></div></div>
        </div>

        <div className="tab-page" hidden={activeTab !== "profile"}>
          <div className="page-heading"><span>ACCOUNT</span><h1>我的账户</h1><p>管理钱包资产、推广额度及协议安全设置。</p></div>
          <article className="profile-card">
            <div className="profile-wallet"><span><DappIcon name="wallet" size={20} /></span><div><small>当前钱包</small><strong>{account ? shortAddress(account) : "尚未连接"}</strong></div><button onClick={connectWallet} disabled={busy}>{account ? "切换" : "连接"}</button></div>
            <div className="profile-assets"><div><span>USDT 余额</span><strong>{compact(snapshot.usdtBalance)}</strong></div><div><span>推广额度</span><strong>{compact(snapshot.promotionQuota)}</strong></div><div><span>个人算力</span><strong>{compact(snapshot.power)}</strong></div><div><span>下次提现</span><strong>{snapshot.nextWithdrawAt ? formatTime(snapshot.nextWithdrawAt) : "未开始"}</strong></div></div>
          </article>
          <section className="security-card">
            <div className="security-title"><span><DappIcon name="shield" size={18} /></span><div><strong>安全与风控</strong><small>{isConfigured ? (snapshot.oracleReady ? "合约与 Oracle 已就绪" : "合约已配置 · Oracle 待更新") : "等待合约部署"}</small></div></div>
            <div className="security-items"><span><b>6H</b> TWAP 均价</span><span><b>24H</b> 提现间隔</span><span><b>1% / 5%</b> 单笔 / 全局</span></div>
            <div className="rpc-row"><span>{PRIVATE_BSC_RPC_URL ? "MEV 保护 RPC 已配置" : "MEV 保护 RPC 待配置"}</span><button onClick={configureProtectedNetwork} disabled={busy || !PRIVATE_BSC_RPC_URL}>配置</button></div>
          </section>
          <a className="contract-link" href={contractLink} target="_blank" rel="noreferrer">在 BscScan 查看合约 <DappIcon name="chevron" size={15} /></a>
        </div>

        <nav className="bottom-nav" aria-label="主导航">
          <button className={activeTab === "home" ? "active" : ""} onClick={() => switchTab("home")}><DappIcon name="home" /><span>首页</span></button>
          <button className={activeTab === "order" ? "active" : ""} onClick={() => switchTab("order")}><DappIcon name="order" /><span>报单</span></button>
          <button className={activeTab === "team" ? "active" : ""} onClick={() => switchTab("team")}><DappIcon name="team" /><span>团队</span></button>
          <button className={activeTab === "profile" ? "active" : ""} onClick={() => switchTab("profile")}><DappIcon name="user" /><span>我的</span></button>
        </nav>
      </div>
    </main>
  );
}
