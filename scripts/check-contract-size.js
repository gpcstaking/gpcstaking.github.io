const fs = require('fs');
const path = require('path');

const EIP170_LIMIT = 24_576;
const MINIMUM_HEADROOM = 256;
const artifactPath = path.join(
  __dirname,
  '..',
  'artifacts',
  'contracts',
  'GpcMining.sol',
  'GpcMining.json'
);

if (!fs.existsSync(artifactPath)) {
  throw new Error('GpcMining artifact is missing; run npm run compile first');
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const deployedBytes = (artifact.deployedBytecode.length - 2) / 2;
const headroom = EIP170_LIMIT - deployedBytes;

console.log(`GpcMining runtime: ${deployedBytes} bytes (${headroom} bytes headroom)`);
if (deployedBytes > EIP170_LIMIT) throw new Error('GpcMining exceeds the EIP-170 runtime limit');
if (headroom < MINIMUM_HEADROOM) {
  throw new Error(`GpcMining must keep at least ${MINIMUM_HEADROOM} bytes of deployment headroom`);
}
