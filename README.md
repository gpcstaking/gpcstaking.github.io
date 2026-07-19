# GPC Mining V2

This repository contains a new BSC mining system and six-hour PancakeSwap TWAP oracle. Both the mining contract and oracle are deployed behind separate OpenZeppelin Transparent Proxies; the mining system intentionally does not reuse the old staking proxy storage because the new system accepts fixed USDT orders rather than variable GPC stakes.

The proxy separates permissions:

- `GpcMining.owner()` controls pause/unpause and unsupported-token recovery and is initialized to the mining TimelockController, not the operation wallet.
- Each proxy has its own `ProxyAdmin`; the admins must be owned by separate TimelockController contracts with at least a 48-hour delay.
- Both implementation constructors disable initializers so the implementation contracts cannot be taken over directly.

## Mainnet constants

- GPC: `0xD3c304697f63B279cd314F92c19cDBE5E5b1631A`
- USDT: `0x55d398326f99059fF775485246999027B3197955`
- WBNB: `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`
- Pancake Router: `0x10ED43C718714eb63d5aA57B78B54704E256024E`
- Operation wallet: `0xA04509c94567B47E1F08CF81EbEDF09F663943c9`

## Current BSC deployment

- Deployer and temporary upgrade owner: `0xB7924467cEce8FD55dA013d8cFe2333173c9C236`
- Oracle proxy: `0x7c7CdA7C435776815606879390523c6486C0b0fB`
- Oracle implementation: `0x17C2DBa615C4e43074eeA98Ea6FFCeA62C599747`
- Oracle ProxyAdmin: `0xcCbde183E2D5c945500CF19CFa3EFd31b877611C`
- Oracle keeper: `0x3bEacEd5Ad0806F3536cdCcA82625309D5CF6F4A`
- Oracle keeper service: Cloudflare Worker `gpc-oracle-keeper`, checking once per minute and writing only when the five-minute observation is due
- Rolling Oracle upgrade: `2026-07-17 18:07:31 CST`
- Mining proxy: `0x7C7C849734ea94a590266F90B5fD63D555ed3ca3`
- Mining implementation: `0x2Cf9Bd18E7ED64F852E6652183961c219c74880b`
- On-chain history proxy: `0x7FA470657148AeB586113968B7A427C734293DD0`
- On-chain history implementation: `0xfc7D11563de08a97D5646664D8aF3491e5e4e4A8`
- On-chain history ProxyAdmin: `0x9Dabe9298FCF022BD9374ee75210065018E8a482`
- Mining ProxyAdmin: `0x22FA01523a7b681F09ed181fBB2A096d2Ca5Cb56`
- DApp: `https://gpcstaking.github.io/`

This testing deployment intentionally uses the deployer EOA as the temporary ProxyAdmin owner. Set both `ALLOW_MAINNET_DEPLOY=yes` and `ALLOW_TEMPORARY_EOA_ADMIN=yes` to use this mode. Before production operation, transfer both ProxyAdmin contracts and the mining business ownership to the approved multisig/Timelock setup.

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
3. For mining, set `MINING_PROXY_ADDRESS` and run `ALLOW_MAINNET_DEPLOY=yes npm run prepare-upgrade:mining`.
4. For the oracle, keep `ORACLE_ADDRESS` set to its proxy and run `ALLOW_MAINNET_DEPLOY=yes npm run prepare-upgrade:oracle`.
5. Review the printed new implementation, ProxyAdmin target, predecessor, salt, and delay. Submit the generated `schedule` calldata to the printed TimelockController address through its authorized proposer, wait for the delay, then submit the generated `execute` calldata to that same TimelockController. Never send `upgradeAndCall` directly from a multisig to ProxyAdmin.

Never reorder, remove, or change the type of existing storage fields. New mining fields must consume slots from `GpcMiningCore.__gap`; new oracle fields must consume slots from `GpcSixHourOracle.__gap`.

The rolling oracle must receive a permissionless `update()` transaction once every five minutes. The Cloudflare Worker under `keeper-worker/` checks once per minute, reads `nextUpdateAt()`, and sends a transaction only when an observation is due. The same Worker reads the mining contract's `nextExpiryAt()` and calls the address-free `expireDueUsers()` only when the earliest registered user has reached 180 days without a successful withdrawal. The mining contract maintains this ordered expiry queue itself, updates it after orders and successful withdrawals, and burns at most 20 due users per keeper transaction. It uses the dedicated gas-only keeper wallet, a 1 gwei gas-price ceiling, RPC failover, and Cloudflare Secret storage. GitHub Actions remains an Oracle backup. The oracle stores 74 cumulative-price observations. Every price read appends the current Pancake cumulative price in memory and calculates the TWAP for the six hours immediately preceding the current block, so a transaction is not held to the last five-minute keeper snapshot. During warm-up it uses all available history as a partial TWAP; when no elapsed observation exists yet, it falls back to the current two-pair spot price. The oracle tolerates short public-keeper scheduling delays and becomes stale after thirty minutes without a keeper point. Withdrawals require both a fresh Oracle price and current spot prices within the configured deviation. A single user's daily gross withdrawal is capped at 1% of the mining pool, and aggregate withdrawals across all users are capped at 2% of the window-opening mining pool per 24-hour window. See [TOKENOMICS.md](./TOKENOMICS.md) for the exact formulas and operational rules.

## Security status

Unit tests and TWAP manipulation bounds are present, but this code has not received an independent smart-contract audit. Do not fund or deploy it to mainnet until external review, fork-based integration testing, and operation-wallet key controls are complete.

## DApp

The mobile wallet interface is under `frontend/`. Copy `frontend/.env.example` to `frontend/.env.local` and set `NEXT_PUBLIC_MINING_ADDRESS` to the deployed **proxy address**. The interface supports BSC wallet switching, mandatory first-entry referral binding, exact test-stage 1 USDT approval, pre-signing Pancake quotes, user minimum outputs, GPC staking, reward quotes, community statistics, and withdrawals. Personal-power and promotion-quota details are read directly from the separate on-chain history registry, which keeps the latest 30 packed records for each ledger and avoids archive-event RPC scans.
