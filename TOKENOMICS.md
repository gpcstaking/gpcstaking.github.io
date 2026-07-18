# GPC Mining Rules

All USDT values and computing power use 18 decimals. One order is fixed at 1,000 USDT.

> Temporary testing override: the currently staged implementation uses a 1 USDT order with proportional 0.2 USDT direct, 0.05 USDT operation, 0.7 USDT GPC-swap, and 0.05 USDT WBNB-swap amounts. Each test order adds 2 personal power and 1 USDT promotion quota. Restore the production values above before launch.

## Order and distribution

Each successful order adds 2,000 personal power and 1,000 promotion quota. Orders require a bound parent and have a one-minute per-user cooldown.

The 1,000 USDT is distributed atomically:

- 200 USDT goes to the direct parent when their promotion quota is at least 200; 200 quota is consumed. Otherwise it goes to the fixed operation wallet.
- 50 USDT goes to the operation wallet.
- 700 USDT swaps through `USDT -> WBNB -> GPC`.
- 50 USDT swaps to WBNB.
- One fourteenth of purchased GPC and all purchased WBNB are added to the GPC/WBNB pool. LP tokens go to the operation wallet.
- The remaining purchased GPC enters the accounted mining pool.

Both swaps are bounded to 2% below the six-hour TWAP and expire within five minutes. Before signing, the DApp also reads the current Pancake quote and supplies a stricter 0.5% user floor; the contract uses the higher of the user and TWAP floors. Liquidity inputs use a 2% bound.

Before either swap, current GPC/USDT and WBNB/USDT reserve prices are compared with their six-hour TWAPs. If either absolute deviation exceeds 1%, the whole order reverts before funds are retained. These checks tightly bound sandwich loss but do not make public-mempool execution MEV-free. Configure a client-safe protected BSC RPC in the DApp and verify the selected wallet network. Direct BscScan users may call the one-argument `placeOrder(deadline)` entry, which keeps the contract TWAP and 1% spot guard but cannot add the DApp's stricter pre-signing quote.

## Daily rewards

`poolValue = miningPoolGpc × sixHourGpcPrice`

When `poolValue × 20 / totalPower < 5`:

- Static: `1% × poolValue × personalPower / totalPower`
- Community, only when `effectiveSmallArea >= smallArea`: `1% × poolValue × effectiveSmallArea / totalPower × 5%`

Otherwise:

- Static: `personalPower × 0.25%`
- Community, only when `effectiveSmallArea >= smallArea`: `effectiveSmallArea × 0.25% × 5%`

Static plus community rewards are capped at 0.5% of current personal power. The paid USDT-value reward is deducted from personal power and converted to GPC using the six-hour TWAP.

## Community and risk controls

For each user, the largest direct referral branch is removed. All other branch power is the small area. Effective small-area power is `min(smallArea, personalPower × 5)`. If effective small-area power is lower than the complete small area, the entire community reward is burned and the community reward is zero. A community reward is paid only when effective small-area power covers the complete small area. Referral depth is limited to 30.

Withdrawals are available once per 24 hours and never accrue missed days. A new order resets only the 24-hour timer. Gross GPC above 1% of the accounted mining pool reverts the entire withdrawal. Aggregate gross withdrawals are additionally capped at 5% of the mining-pool balance captured at the start of each 24-hour global window. A 10% GPC fee goes to the operation wallet.

Every withdrawal validates the fresh six-hour GPC and WBNB TWAPs against current Pancake reserve prices; either price deviating by more than 1% causes the withdrawal to revert. Oracle observations longer than 12 hours are never published as prices. Instead, the stale baseline is reset, prices become unavailable, and a new six-hour observation must complete.

If no successful withdrawal occurs for 180 days, all remaining personal power expires. Additional orders do not reset this inactivity clock. The contract maintains an ordered on-chain expiry queue after every order and successful withdrawal. A permissionless, address-free `expireDueUsers()` call burns up to 20 due accounts per transaction; the Cloudflare keeper checks the queue head every minute and calls only when it is due. Expired users are also cleared during their next action. Expiry processing is disabled while the protocol is paused.
