# GPC Oracle and Mining Keeper Worker

This Cloudflare Worker checks the rolling Oracle and the mining inactivity queue every minute. It sends `update()` only when the five-minute Oracle observation is due, and calls the mining contract's address-free `expireDueUsers()` only when the queue head has reached 180 days without a successful withdrawal. The keeper key is stored only as a Cloudflare secret.

Required secrets:

- `KEEPER_PRIVATE_KEY`: dedicated gas-only BSC wallet private key.
- `BSC_RPC_URLS`: optional comma-separated BSC RPC failover list. Public defaults are included.

Deployment:

```bash
npm ci
npx wrangler secret put KEEPER_PRIVATE_KEY
npx wrangler secret put BSC_RPC_URLS
npm run deploy
```

The configured 1 gwei gas-price ceiling prevents unexpected spending during a fee spike. Fund the printed keeper address with BNB and monitor Worker logs and wallet balance.
