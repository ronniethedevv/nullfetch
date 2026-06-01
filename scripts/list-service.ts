import * as dotenv from "dotenv";
dotenv.config();

import { ethers, network } from "hardhat";
import {
  resolveMarketplaceAddress,
  requireEnv,
  parseCategory,
} from "./_keyHelpers";

async function main() {
  if (network.name !== "sepolia") {
    throw new Error(
      `list-service.ts is for live deployments; run it on --network sepolia ` +
        `(got "${network.name}").`,
    );
  }

  // listService takes no encrypted inputs, so we deliberately skip
  // fhevm.initializeCLIApi() — it's only needed for FHE-aware calls
  // (registerForService, verify, etc.) and the precompile probe adds
  // an extra RPC hop that can time out on slow Sepolia endpoints.

  const name = requireEnv("SERVICE_NAME");
  const description = process.env.SERVICE_DESCRIPTION ?? "";
  const endpoint = requireEnv("SERVICE_ENDPOINT");
  const categoryLabel = requireEnv("SERVICE_CATEGORY");
  const category = parseCategory(categoryLabel);

  const marketAddr = resolveMarketplaceAddress(network.name);

  const [signer] = await ethers.getSigners();
  console.log(`network:     ${network.name}`);
  console.log(`marketplace: ${marketAddr}`);
  console.log(`provider:    ${await signer.getAddress()}`);
  console.log(`service:     ${name}  [${categoryLabel}]`);
  console.log(`endpoint:    ${endpoint}`);

  const market = await ethers.getContractAt("Marketplace", marketAddr, signer);
  const fee = await market.listingFee();
  console.log(`listingFee:  ${ethers.formatEther(fee)} ETH`);

  console.log("submitting listService(...) ...");
  const tx = await market.listService(name, description, endpoint, category, {
    value: fee,
  });
  const rc = await tx.wait();
  if (!rc) throw new Error("no receipt");

  // Pull the new serviceId from the ServiceListed event.
  let serviceId: bigint | undefined;
  for (const log of rc.logs) {
    try {
      const parsed = market.interface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
      if (parsed?.name === "ServiceListed") {
        serviceId = parsed.args.serviceId as bigint;
        break;
      }
    } catch {
      // not ours
    }
  }
  if (serviceId === undefined) throw new Error("ServiceListed event not found");

  console.log("");
  console.log(`mined in block ${rc.blockNumber}, tx ${tx.hash}`);
  console.log(`SERVICE_ID = ${serviceId.toString()}`);
  console.log("");
  console.log("Save this SERVICE_ID — developers will need it to register.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
