async function guardMainnet(ethers) {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 56n) {
    throw new Error(`Expected BSC mainnet (56), received chain ${network.chainId}`);
  }
  if (process.env.ALLOW_MAINNET_DEPLOY !== 'yes') {
    throw new Error('Set ALLOW_MAINNET_DEPLOY=yes after reviewing addresses and deployment arguments');
  }
}

module.exports = { guardMainnet };
