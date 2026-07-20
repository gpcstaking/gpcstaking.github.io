# GPC Mining Rules

All USDT values and computing power use 18 decimals. One order is fixed at 1,000 USDT.

## Order and distribution

Each successful order adds 2,000 personal power and 1,000 promotion quota. Orders require a bound parent and have a one-minute per-user cooldown.

The 1,000 USDT is distributed atomically:

- 200 USDT goes to the direct parent when their promotion quota is at least 200; 200 quota is consumed. Otherwise it goes to the fixed operation wallet.
- 50 USDT goes to the operation wallet.
- 700 USDT swaps through `USDT -> WBNB -> GPC`.
- 50 USDT swaps to WBNB.
- One fourteenth of purchased GPC and all purchased WBNB are added to the GPC/WBNB pool. LP tokens go to the operation wallet.
- The remaining purchased GPC enters the accounted mining pool.

Both swaps are bounded to 2% below the six-hour TWAP and expire within one minute. Before signing, the DApp also reads the current Pancake quote and supplies a stricter 0.3% user floor; the contract uses the higher of the user and TWAP floors. Liquidity inputs use a 2% bound.

Before either swap, current GPC/USDT and WBNB/USDT reserve prices are compared with their six-hour TWAPs. If either absolute deviation exceeds 1%, the whole order reverts before funds are retained. These checks tightly bound sandwich loss but do not make public-mempool execution MEV-free. Configure a client-safe protected BSC RPC in the DApp and verify the selected wallet network. Direct BscScan users can call the five-argument `placeOrder` entry with their own swap and LP minimums.

Any wallet may place an assisted order for an already-bound beneficiary. USDT is collected from the caller, while power, purchased-power accounting, promotion quota, cooldowns, referral rewards, history, and inactivity scheduling are all applied to the beneficiary exactly as in a self-service order. Because adding power resets the beneficiary's withdrawal cooldown under the normal order rules, an assisted order resets it as well.

The production DApp pins the audited Mining proxy and uses bounded direct-referral index reads. History tracking can only be initialized by the Mining business owner; upgrades that introduce a new reinitializer must continue to execute it atomically through `upgradeAndCall`.

## Daily rewards

`poolValue = miningPoolGpc × sixHourGpcPrice`

When `poolValue × 20 / totalPower < 5`:

- Static: `1% × poolValue × personalPower / totalPower`
- Community, only when `effectiveSmallArea >= smallArea`: `1% × poolValue × effectiveSmallArea / totalPower × 10%`

Otherwise:

- Static: `personalPower × 0.25%`
- Community, only when `effectiveSmallArea >= smallArea`: `effectiveSmallArea × 0.25% × 10%`

Static plus community rewards are capped at 0.5% of current personal power. The paid USDT-value reward is deducted from personal power and converted to GPC using the six-hour TWAP.

## Community and risk controls

For each user, the largest direct referral branch is removed. All other branch power is the small area. Effective small-area power is `min(smallArea, personalPower × 10)`. If effective small-area power is lower than the complete small area, the entire community reward is burned and the community reward is zero. A community reward is paid only when effective small-area power covers the complete small area. Referral depth is limited to 30.

Withdrawals are available once per 24 hours and never accrue missed days. A new order resets only the 24-hour timer. A single user's gross daily GPC withdrawal above 1% of the accounted mining pool reverts the entire withdrawal. Aggregate gross withdrawals across all users are additionally capped at 2% of the mining-pool balance captured at the start of each 24-hour global window. Each gross GPC withdrawal sends 90% to the beneficiary, 5% to the burn address, and 5% to the operation wallet.

When a withdrawal finds the Oracle keeper's native BNB balance below 0.1 BNB, the contract quotes PancakeSwap and swaps mining-pool GPC for exactly 0.1 BNB sent directly to the keeper. The refill runs only after the same GPC and BNB spot/TWAP deviation checks used by withdrawals. If the mining pool cannot cover the quoted GPC input, the refill is skipped so the user's withdrawal is not blocked.

Any wallet may trigger an assisted withdrawal after the beneficiary's normal cooldown. Reward calculation, power burn, inactivity scheduling, individual and global pool limits, price checks, and the 90%/5%/5% split remain unchanged. Customer GPC is transferred only to the beneficiary, the burn share only to the burn address, and the operation share only to operations; the caller cannot redirect or receive any transfer. Because the action consumes the beneficiary's available reward and power under the normal withdrawal rules, third parties can choose when to trigger an otherwise eligible claim.

Every withdrawal validates the Oracle's GPC and WBNB prices against current Pancake reserve prices; either price deviating by more than 1% causes the withdrawal to revert. The rolling Oracle prefers a live-ended six-hour TWAP, falls back to the most recent available cumulative-price window when a complete window is unavailable, and uses the current two-pair spot price only when no elapsed observation exists. A keeper delay beyond thirty minutes is an operational alert and does not stop staking or withdrawals.

If no successful withdrawal occurs for 180 days, all remaining personal power expires. Additional orders do not reset this inactivity clock. The contract maintains an ordered on-chain expiry queue after every order and successful withdrawal. A permissionless, address-free `expireDueUsers()` call burns up to 20 due accounts per transaction; the Cloudflare keeper checks the queue head every minute and calls only when it is due. Expired users are also cleared during their next action. Expiry processing is disabled while the protocol is paused.

The referral-root node is the sole exception to the sponsor requirement and may place an order without an upstream address. Root status is determined by the referral topology's contract-sentinel parent, not by comparing the caller with the operation-wallet address. For a root order, the sponsorless 20% direct-referral share and the 5% operation share remain in the operation wallet. The root receives normal personal power and promotion quota, while its personal order does not create artificial upstream team power.

The contract permanently counts referral nodes separately from power. Each new binding increments the total descendant-node count of every upstream wallet, capped at the same 30 referral levels. Direct-node count is the direct-referral array length; total team-node count excludes the wallet itself and does not decrease when inactive power expires.
