import { BrowserProvider, getAddress } from "ethers";

export type InjectedWallet = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

const BSC_CHAIN_ID = "0x38";

export function walletErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return;
  const details = error as { code?: number; data?: { originalError?: unknown }; error?: unknown };
  return typeof details.code === "number"
    ? details.code
    : walletErrorCode(details.data?.originalError ?? details.error);
}

function firstAccount(accounts: unknown): string | undefined {
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") return;
  return getAddress(accounts[0]);
}

export async function connectInjectedWallet(wallet: InjectedWallet) {
  let accounts = await wallet.request({ method: "eth_accounts" });
  if (!firstAccount(accounts)) {
    accounts = await wallet.request({ method: "eth_requestAccounts" });
  }
  if (!firstAccount(accounts)) throw new Error("No wallet account authorized");

  const switchToBsc = () => wallet.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: BSC_CHAIN_ID }],
  });
  if (await wallet.request({ method: "eth_chainId" }) !== BSC_CHAIN_ID) {
    try {
      await switchToBsc();
    } catch (error) {
      if (walletErrorCode(error) !== 4902) throw error;
      await wallet.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: BSC_CHAIN_ID,
          chainName: "BNB Smart Chain Mainnet",
          nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
          rpcUrls: ["https://bscrpc.pancakeswap.finance"],
          blockExplorerUrls: ["https://bscscan.com"],
        }],
      });
      await switchToBsc();
    }
  }
  if (await wallet.request({ method: "eth_chainId" }) !== BSC_CHAIN_ID) {
    throw new Error("Please switch your wallet to BSC Mainnet");
  }
  const account = firstAccount(await wallet.request({ method: "eth_accounts" }));
  if (!account) throw new Error("No wallet account authorized");
  return { provider: new BrowserProvider(wallet), account };
}

type WalletHost = {
  ethereum?: InjectedWallet;
  addEventListener: (event: string, listener: () => void) => void;
  removeEventListener: (event: string, listener: () => void) => void;
  setInterval: (callback: () => void, delay: number) => number;
  clearInterval: (timer: number) => void;
};

export function onInjectedWalletReady(
  onReady: (wallet: InjectedWallet) => void,
  host: WalletHost = window,
) {
  let timer: number | undefined;
  let stopped = false;
  let checks = 0;
  const cleanup = () => {
    stopped = true;
    if (timer !== undefined) host.clearInterval(timer);
    host.removeEventListener("ethereum#initialized", check);
  };
  const check = () => {
    if (stopped) return;
    if (host.ethereum) {
      cleanup();
      onReady(host.ethereum);
    }
  };
  host.addEventListener("ethereum#initialized", check);
  check();
  if (!stopped) {
    // Mobile wallet browsers may inject their provider after React mounts.
    timer = host.setInterval(() => {
      check();
      if (++checks >= 40 && timer !== undefined) host.clearInterval(timer);
    }, 250);
  }
  return cleanup;
}
