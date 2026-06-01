import * as dotenv from "dotenv";
dotenv.config();

import { ethers, fhevm, network } from "hardhat";
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/node";
import { writeFileSync } from "fs";
import { join } from "path";
import {
  digestHalves,
  resolveMarketplaceAddress,
  requireEnv,
} from "./_keyHelpers";

/// Generate a random 32-byte API key (0x-prefixed lowercase hex).
function generateApiKey(): string {
  const bytes = ethers.randomBytes(32);
  return ethers.hexlify(bytes);
}

async function main() {
  if (network.name !== "sepolia") {
    throw new Error(
      `register-key.ts is for live deployments; run it on --network sepolia ` +
        `(got "${network.name}").`,
    );
  }

  await fhevm.initializeCLIApi();

  const serviceId = BigInt(requireEnv("SERVICE_ID"));
  const marketAddr = resolveMarketplaceAddress(network.name);

  const [signer] = await ethers.getSigners();
  const devAddr = await signer.getAddress();
  console.log(`network:     ${network.name}`);
  console.log(`marketplace: ${marketAddr}`);
  console.log(`developer:   ${devAddr}`);
  console.log(`serviceId:   ${serviceId.toString()}`);

  const relayer = await createInstance({
    ...SepoliaConfig,
    network: `https://sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
  });

  const market = await ethers.getContractAt("Marketplace", marketAddr, signer);

  // Pre-flight checks so we surface a useful error before spending on the
  // Zama relayer round-trip.
  const service = await market.getService(serviceId);
  if (!service.active) {
    throw new Error(`service #${serviceId} is inactive`);
  }
  console.log(`service:     "${service.name}" by ${service.provider}`);

  const fee = await market.registrationFee();
  console.log(`fee:         ${ethers.formatEther(fee)} ETH`);

  // Generate the API key locally. The plaintext exists only on this
  // machine; only the keccak halves (encrypted) ever leave it.
  const apiKey = generateApiKey();
  const { hi, lo } = digestHalves(apiKey);

  const input = relayer.createEncryptedInput(marketAddr, devAddr);
  input.add128(hi);
  input.add128(lo);
  const enc = await input.encrypt();

  console.log("submitting registerForService(...) ...");
  const tx = await market.registerForService(
    serviceId,
    enc.handles[0],
    enc.handles[1],
    enc.inputProof,
    { value: fee },
  );
  const rc = await tx.wait();
  console.log(`mined in block ${rc?.blockNumber}, tx ${tx.hash}`);

  // Persist the plaintext locally so verify-key.ts can read it.
  // The file is named with the serviceId so multiple subscriptions don't
  // collide.
  const outFile = join(process.cwd(), `.key-service-${serviceId.toString()}`);
  writeFileSync(outFile, apiKey + "\n", { mode: 0o600 });

  console.log("");
  console.log(`API key generated and saved to ${outFile}`);
  console.log(`(Plaintext key: ${apiKey})`);
  console.log("");
  console.log("This is the ONLY copy of the plaintext. If you lose it, the");
  console.log("provider must revoke your subscription and you must re-register.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
