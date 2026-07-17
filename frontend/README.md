# GPC Mining DApp

Set `NEXT_PUBLIC_MINING_ADDRESS` in `.env.local` to the verified `GpcMining` deployment.

```bash
npm install
npm run dev
npm test
npm run lint
```

The application targets BSC mainnet and reads the fixed USDT address from the production contract specification. Do not configure an unverified mining address.

Production DApp: `https://gpcstaking.github.io/`

Production mining proxy: `0x7C7C849734ea94a590266F90B5fD63D555ed3ca3`
