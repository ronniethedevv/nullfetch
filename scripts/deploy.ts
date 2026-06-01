import * as dotenv from "dotenv";
dotenv.config();

import { ethers, network, run } from "hardhat";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`network:  ${network.name} (chainId ${network.config.chainId})`);
  console.log(`deployer: ${await deployer.getAddress()}`);

  const Factory = await ethers.getContractFactory("Marketplace");
  const marketplace = await Factory.deploy();
  await marketplace.waitForDeployment();

  const addr = await marketplace.getAddress();
  console.log(`Marketplace deployed at: ${addr}`);

  // Record the address in deployments.json keyed by network name.
  const file = join(process.cwd(), "deployments.json");
  const prior = existsSync(file)
    ? JSON.parse(readFileSync(file, "utf8"))
    : {};
  prior[network.name] = { Marketplace: addr };
  writeFileSync(file, JSON.stringify(prior, null, 2));
  console.log(`wrote deployments.json`);

  // ── Etherscan source verification (optional) ──────────────────────
  if (network.name === "sepolia" && process.env.ETHERSCAN_API_KEY) {
    console.log("waiting 5 confirmations before Etherscan verification…");
    const tx = marketplace.deploymentTransaction();
    if (tx) await tx.wait(5);

    try {
      await run("verify:verify", { address: addr, constructorArguments: [] });
      console.log(`verified on Etherscan: https://sepolia.etherscan.io/address/${addr}#code`);
    } catch (e) {
      const msg = (e as Error).message;
      if (/already verified/i.test(msg)) {
        console.log("source already verified on Etherscan — nothing to do.");
      } else {
        console.warn(`Etherscan verification failed (non-fatal): ${msg}`);
      }
    }
  } else if (network.name === "sepolia") {
    console.log(
      "ETHERSCAN_API_KEY not set — skipping source verification. " +
        "Set it in .env to publish source on next deploy.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
