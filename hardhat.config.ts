import * as dotenv from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@fhevm/hardhat-plugin";

dotenv.config();

const MNEMONIC =
  process.env.MNEMONIC ??
  "test test test test test test test test test test test junk";
const INFURA_API_KEY = process.env.INFURA_API_KEY ?? "";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: { enabled: true, runs: 800 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      chainId: 11155111,
      url: INFURA_API_KEY
        ? `https://sepolia.infura.io/v3/${INFURA_API_KEY}`
        : "https://rpc.sepolia.org",
      accounts: { mnemonic: MNEMONIC },
    },
  },
  // Wired up by @nomicfoundation/hardhat-verify (bundled with the
  // Toolbox). `scripts/deploy.ts` calls `run("verify:verify", ...)` on
  // Sepolia when ETHERSCAN_API_KEY is set.
  etherscan: {
    apiKey: {
      sepolia: ETHERSCAN_API_KEY,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 120000,
  },
};

export default config;
