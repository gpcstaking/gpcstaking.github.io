# GPC Mining DApp

The production `GpcMining` proxy is pinned to `0xfA2121198a3ed0c0E2C316Fe3b8D36508AE00b03`. Optional local and GitHub environment values must match this audited address or the build fails.

```bash
npm install
npm run dev
npm test
npm run lint
```

The application targets BSC mainnet and reads the fixed USDT address from the production contract specification. Do not configure an unverified mining address.

Production DApp: `https://gpcstaking.github.io/`

Production mining proxy: `0xfA2121198a3ed0c0E2C316Fe3b8D36508AE00b03`
