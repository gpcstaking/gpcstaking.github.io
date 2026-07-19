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

async function validateSafeOwner(ethers, address, label) {
  if (!address || !ethers.isAddress(address)) {
    throw new Error(`${label} must be a valid Safe address`);
  }
  if (await ethers.provider.getCode(address) === '0x') {
    throw new Error(`${label} must be a contract, not an EOA`);
  }
  const safe = new ethers.Contract(
    address,
    ['function getOwners() view returns (address[])', 'function getThreshold() view returns (uint256)'],
    ethers.provider
  );
  let owners;
  let threshold;
  try {
    [owners, threshold] = await Promise.all([safe.getOwners(), safe.getThreshold()]);
  } catch {
    throw new Error(`${label} must expose the Safe owner and threshold interface`);
  }
  if (owners.length < 2 || threshold < 2n || threshold > BigInt(owners.length)) {
    throw new Error(`${label} must require at least two valid owner signatures`);
  }
  return { address, owners, threshold };
}

module.exports = { MIN_ADMIN_DELAY, validateTimelockOwner, validateSafeOwner };
