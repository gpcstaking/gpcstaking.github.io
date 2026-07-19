require('@nomicfoundation/hardhat-toolbox');
require('@openzeppelin/hardhat-upgrades');
require('solidity-coverage');
require('dotenv').config();

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

module.exports = {
  solidity: {
    version: '0.8.21',
    settings: {
      viaIR: true,
      optimizer: { enabled: true, runs: 100 },
      evmVersion: 'paris'
    }
  },
  networks: {
    hardhat: {
      accounts: { count: 40 }
    },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || 'https://data-seed-prebsc-1-s1.binance.org:8545/',
      accounts,
      chainId: 97
    },
    bsc: {
      url: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org',
      accounts,
      chainId: 56
    }
  },
  etherscan: {
    apiKey: process.env.BSCSCAN_API_KEY || ''
  }
};
