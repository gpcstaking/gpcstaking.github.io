import assert from 'node:assert/strict';
import test from 'node:test';
import { connectInjectedWallet, onInjectedWalletReady } from '../lib/wallet.ts';
const account = '0x1111111111111111111111111111111111111111';
function mock({ authorized = true, chain = '0x38', switchError } = {}) {
  const calls = [];
  return { calls, async request({ method }) {
    calls.push(method);
    if (method === 'eth_accounts') return authorized ? [account] : [];
    if (method === 'eth_requestAccounts') { authorized = true; return [account]; }
    if (method === 'eth_chainId') return chain;
    if (method === 'wallet_switchEthereumChain') {
      if (switchError) { const error = switchError; switchError = undefined; throw error; }
      chain = '0x38';
    }
  }};
}
test('authorized wallets reconnect without prompting', async () => {
  const wallet = mock();
  assert.equal((await connectInjectedWallet(wallet)).account, account);
  assert.ok(!wallet.calls.includes('eth_requestAccounts'));
});
test('first visit requests authorization once', async () => {
  const wallet = mock({ authorized: false });
  await connectInjectedWallet(wallet);
  assert.equal(wallet.calls.filter(m => m === 'eth_requestAccounts').length, 1);
});
test('unknown BSC network is added then switched', async () => {
  const wallet = mock({ chain: '0x1', switchError: { code: 4902 } });
  await connectInjectedWallet(wallet);
  assert.deepEqual(wallet.calls.filter(m => m.startsWith('wallet_')), ['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
});
test('rejected switch does not trigger another prompt', async () => {
  const wallet = mock({ chain: '0x1', switchError: { code: 4001 } });
  await assert.rejects(connectInjectedWallet(wallet), e => e.code === 4001);
  assert.ok(!wallet.calls.includes('wallet_addEthereumChain'));
});
function hostMock() {
  const listeners = new Map();
  const timers = new Map();
  return { listeners, timers,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
    setInterval: fn => { timers.set(1, fn); return 1; },
    clearInterval: id => timers.delete(id),
  };
}
test('late mobile injection connects once and cleans up', () => {
  const host = hostMock();
  let count = 0;
  const stop = onInjectedWalletReady(() => count++, host);
  host.ethereum = mock();
  const tick = host.timers.get(1);
  tick(); tick();
  assert.equal(count, 1);
  assert.equal(host.timers.size, 0);
  assert.equal(host.listeners.size, 0);
  stop();
});
test('unmount cancels wallet detection', () => {
  const host = hostMock();
  let count = 0;
  const stop = onInjectedWalletReady(() => count++, host);
  const tick = host.timers.get(1);
  stop();
  host.ethereum = mock(); tick();
  assert.equal(count, 0);
  assert.equal(host.timers.size, 0);
  assert.equal(host.listeners.size, 0);
});
