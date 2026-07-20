# GPC Mining V2

This repository contains a new BSC mining system and six-hour PancakeSwap TWAP oracle. Both the mining contract and oracle are deployed behind separate OpenZeppelin Transparent Proxies; the mining system intentionally does not reuse the old staking proxy storage because the new system accepts fixed USDT orders rather than variable GPC stakes.

The proxy separates permissions:

- `GpcMining.owner()` controls pause/unpause and unsupported-token recovery and is separate from the operation wallet.
- Oracle, replacement mining, and history have separate `ProxyAdmin` contracts, all owned by the designated 2-of-3 Safe.
- Both implementation constructors disable initializers so the implementation contracts cannot be taken over directly.

## Mainnet constants

- GPC: `0xD3c304697f63B279cd314F92c19cDBE5E5b1631A`
- USDT: `0x55d398326f99059fF775485246999027B3197955`
- WBNB: `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`
- Pancake Router: `0x10ED43C718714eb63d5aA57B78B54704E256024E`
- Operation wallet: `0xC34622e54f259304877A10A901caa332250A84f5` (Safe 2-of-3)

## Current BSC deployment

- Deployer and mining business owner: `0xB7924467cEce8FD55dA013d8cFe2333173c9C236`
- Oracle proxy: `0x7c7CdA7C435776815606879390523c6486C0b0fB`
- Oracle implementation: `0x2FA0AA852e99B7fE647819381301bF51A725801E`
- Oracle ProxyAdmin: `0xcCbde183E2D5c945500CF19CFa3EFd31b877611C`
- Oracle ProxyAdmin owner: `0xA115A26023eF5072057DBF9Ef43C2f61F79F38b7` (Safe 2-of-3)
- Oracle keeper: `0x3bEacEd5Ad0806F3536cdCcA82625309D5CF6F4A`
- Oracle keeper service: Cloudflare Worker `gpc-oracle-keeper`, checking once per minute and writing only when the five-minute observation is due
- Rolling Oracle upgrade: `2026-07-17 18:07:31 CST`
- Mining proxy: `0xB78A5ed9166c894C3ca3C7acD102378bab6da89D`
- Mining implementation: `0xC7b7fD828ae96B704ece953A14607F5Ba9fDd2A1`
- Mining ProxyAdmin: `0x2202Cd78D61274c02F7BDB8A92Fb99489B24D97A`
- DApp: `https://gpcstaking.github.io/`

The Oracle, replacement mining, and history ProxyAdmin contracts are controlled by the designated Safe. The deployer remains the separate mining business owner for pause/unpause until a later explicit business-ownership handover.

## Local verification

```bash
npm install
npm run compile
npm test
npm run test:coverage
```

## Mainnet deployment sequence

Copy `.env.example` to an untracked `.env`. Set `PRIVATE_KEY`, `BSC_RPC_URL`, `BSCSCAN_API_KEY`, `ORACLE_TIMELOCK_OWNER`, and `MINING_TIMELOCK_OWNER`. The two timelocks must be different and should be controlled by separate Safe multisigs.

1. Review all fixed addresses, set `ORACLE_TIMELOCK_OWNER`, then run `ALLOW_MAINNET_DEPLOY=yes npm run deploy:oracle`.
2. Wait at least six hours.
3. Set `ORACLE_ADDRESS` to the oracle **proxy address**, then run `ALLOW_MAINNET_DEPLOY=yes npm run update:oracle`.
4. Set the separate `MINING_TIMELOCK_OWNER`, confirm the printed TWAPs, and run `ALLOW_MAINNET_DEPLOY=yes npm run deploy:mining`. The script validates the Oracle tokens, pairs, proxy, implementation, admin timelock, and admin separation.
5. Record and verify both proxies, both implementations, and both ProxyAdmin contracts on BscScan.
6. Configure the DApp with the **proxy address**, never the implementation address.

## Upgrade procedure

1. Make a storage-compatible implementation change and add a reinitializer only if the new version needs new state initialization. If used, set `UPGRADE_CALLDATA` to that encoded reinitializer call.
2. Run the full test suite and OpenZeppelin storage-layout validation.
3. For mining, set `MINING_PROXY_ADDRESS` and `MINING_PROXY_ADMIN_ADDRESS`, then run `ALLOW_MAINNET_DEPLOY=yes npm run prepare-upgrade:mining`.
4. For history, set `HISTORY_REGISTRY_ADDRESS` and `HISTORY_PROXY_ADMIN_ADDRESS`, then run `ALLOW_MAINNET_DEPLOY=yes npm run prepare-upgrade:history`.
5. For the oracle, set `ORACLE_ADDRESS` and `ORACLE_PROXY_ADMIN_ADDRESS`, then run `ALLOW_MAINNET_DEPLOY=yes npm run prepare-upgrade:oracle`.
6. Review the printed implementation and submit the generated ProxyAdmin call through the designated 2-of-3 Safe.

Never reorder, remove, or change the type of existing storage fields. New mining fields must consume slots from `GpcMiningCore.__gap`; new oracle fields must consume slots from `GpcSixHourOracle.__gap`.

The rolling oracle must receive a permissionless `update()` transaction once every five minutes. The Cloudflare Worker under `keeper-worker/` checks once per minute, reads `nextUpdateAt()`, and sends a transaction only when an observation is due. The same Worker reads the mining contract's `nextExpiryAt()` and calls the address-free `expireDueUsers()` only when the earliest registered user has reached 180 days without a successful withdrawal. The mining contract maintains this ordered expiry queue itself, updates it after orders and successful withdrawals, and burns at most 20 due users per keeper transaction. It uses the dedicated gas-only keeper wallet, a 1 gwei gas-price ceiling, RPC failover, and Cloudflare Secret storage. When a withdrawal sees the keeper below 0.1 BNB, mining-pool GPC is swapped for exactly 0.1 BNB and sent to the keeper after the normal spot/TWAP checks. GitHub Actions remains an Oracle backup. The oracle stores 74 cumulative-price observations. Every price read appends the current Pancake cumulative price in memory and calculates the TWAP for the six hours immediately preceding the current block, so a transaction is not held to the last five-minute keeper snapshot. During warm-up it uses all available history as a partial TWAP; when no elapsed observation exists yet, it falls back to the current two-pair spot price. A keeper delay beyond thirty minutes emits an operational alert but no longer stops staking or withdrawals: the Oracle continues with a full six-hour TWAP when possible, otherwise the most recent available cumulative-price window, and finally the current two-pair spot price. Mining still checks the returned prices against current Pancake reserve prices within the configured deviation. A single user's daily gross withdrawal is capped at 1% of the mining pool, and aggregate withdrawals across all users are capped at 2% of the window-opening mining pool per 24-hour window. See [TOKENOMICS.md](./TOKENOMICS.md) for the exact formulas and operational rules.

## Security status

Unit tests and TWAP manipulation bounds are present, but this code has not received an independent smart-contract audit. Do not fund or deploy it to mainnet until external review, fork-based integration testing, and operation-wallet key controls are complete.

## DApp

The mobile wallet interface is under `frontend/`. Its audited BSC proxy address is pinned in source and CI rejects a mismatched deployment variable. The interface supports BSC wallet switching with PancakeSwap MEV Guard as the add-network RPC, mandatory first-entry referral binding, exact 1,000 USDT approval (including reducing legacy oversized allowances), pre-signing Pancake quotes with a 0.3% user floor and 60-second deadline, GPC staking, reward quotes, community statistics, paginated direct-referral reads, and withdrawals. A non-navigable assisted-operations view lets any wallet pay for an order credited to a bound beneficiary or trigger that beneficiary's available withdrawal. Each withdrawal sends 90% of gross GPC to the beneficiary, burns 5%, and sends 5% to operations; the caller cannot redirect or receive any portion. Personal-power and promotion-quota details are read directly from the separate on-chain history registry, which keeps the latest 30 packed records for each ledger and avoids archive-event RPC scans.
