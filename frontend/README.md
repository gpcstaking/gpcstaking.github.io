# GPC Mining DApp

The production `GpcMining` proxy is pinned to `0xB78A5ed9166c894C3ca3C7acD102378bab6da89D`. Optional local and GitHub environment values must match this audited address or the build fails.

```bash
npm install
npm run dev
npm test
npm run lint
```

The application targets BSC mainnet and reads the fixed USDT address from the production contract specification. Do not configure an unverified mining address.

Production DApp: `https://gpcstaking.github.io/`

Production mining proxy: `0xB78A5ed9166c894C3ca3C7acD102378bab6da89D`
