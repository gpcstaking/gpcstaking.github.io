const MIN_ADMIN_DELAY = 48 * 60 * 60;

async function validateTimelockOwner(ethers, address, label) {
  if (!address || !ethers.isAddress(address)) {
    throw new Error(`${label} must be a valid TimelockController address`);
  }
  if (await ethers.provider.getCode(address) === '0x') {
    throw new Error(`${label} must be a contract, not an EOA`);
  }

  const timelock = new ethers.Contract(
    address,
    ['function getMinDelay() view returns (uint256)'],
    ethers.provider
  );
  let delay;
  try {
    delay = await timelock.getMinDelay();
  } catch {
    throw new Error(`${label} must expose TimelockController.getMinDelay()`);
  }
  if (delay < MIN_ADMIN_DELAY) {
    throw new Error(`${label} delay must be at least 48 hours`);
  }
  return address;
}

module.exports = { MIN_ADMIN_DELAY, validateTimelockOwner };
