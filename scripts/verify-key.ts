import * as dotenv from "dotenv";
dotenv.config();

import { ethers, fhevm, network } from "hardhat";
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/node";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { Marketplace } from "../typechain-types";
import {
  digestHalves,
  resolveMarketplaceAddress,
  requireEnv,
} from "./_keyHelpers";

/// Resolve the plaintext API key. Prefer the env CANDIDATE_KEY; fall back
/// to the .key-service-<id> file written by register-key.ts.
function resolveCandidateKey(serviceId: bigint): string {
  if (process.env.CANDIDATE_KEY) return process.env.CANDIDATE_KEY;
  const file = join(process.cwd(), `.key-service-${serviceId.toString()}`);
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  throw new Error(
    `No candidate key found. Set CANDIDATE_KEY in .env, or run ` +
      `\`npm run register:sepolia\` first (writes ${file}).`,
  );
}

async function main() {
  if (network.name !== "sepolia") {
    throw new Error(
      `verify-key.ts is for live deployments; run it on --network sepolia ` +
        `(got "${network.name}").`,
    );
  }

  await fhevm.initializeCLIApi();

  const serviceId = BigInt(requireEnv("SERVICE_ID"));
  const candidate = resolveCandidateKey(serviceId);
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

  const market = (await ethers.getContractAt(
    "Marketplace",
    marketAddr,
    signer,
  )) as unknown as Marketplace;

  // Pre-flight: confirm the subscription exists and isn't revoked.
  const sub = await market.getSubscription(serviceId, devAddr);
  if (!sub.exists) {
    throw new Error(
      `no subscription for developer ${devAddr} on service #${serviceId}. ` +
        `Run \`npm run register:sepolia\` first.`,
    );
  }
  if (sub.revoked) {
    throw new Error(`subscription for service #${serviceId} is REVOKED.`);
  }
  console.log("subscription found and active.");

  const { hi, lo } = digestHalves(candidate);
  const input = relayer.createEncryptedInput(marketAddr, devAddr);
  input.add128(hi);
  input.add128(lo);
  const enc = await input.encrypt();

  console.log("staticCall verify(...) — probing revert reason …");
  try {
    await market
      .connect(signer)
      .verify.staticCall(serviceId, enc.handles[0], enc.handles[1], enc.inputProof);
    console.log("staticCall succeeded — verify should also send cleanly");
  } catch (e) {
    const err = e as { shortMessage?: string; message?: string; data?: unknown };
    console.error("staticCall revert detail:", err.shortMessage ?? err.message, "data:", err.data);
    throw e;
  }

  console.log("submitting verify(...) ...");
  const tx = await market
    .connect(signer)
    .verify(serviceId, enc.handles[0], enc.handles[1], enc.inputProof);
  const rc = await tx.wait();
  if (!rc) throw new Error("no receipt");
  console.log(`mined in block ${rc.blockNumber}, tx ${tx.hash}`);

  // Pull result handle from the Verified event.
  let resultHandle: string | undefined;
  for (const log of rc.logs) {
    try {
      const parsed = market.interface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
      if (parsed?.name === "Verified") {
        resultHandle = parsed.args.resultHandle as string;
        break;
      }
    } catch {
      // not ours
    }
  }
  if (!resultHandle) throw new Error("Verified event not found");

  // User-decrypt via the Zama relayer SDK.
  const keypair = relayer.generateKeypair();
  const resultHex = ethers.hexlify(resultHandle) as `0x${string}`;
  const handleContractPairs = [{ handle: resultHex, contractAddress: marketAddr }];
  const startTimestamp = Math.floor(Date.now() / 1000);
  const durationDays = 7;
  const contractAddresses = [marketAddr];

  const eip712 = relayer.createEIP712(
    keypair.publicKey,
    contractAddresses,
    startTimestamp,
    durationDays,
  );

  const signature = await signer.signTypedData(
    eip712.domain,
    {
      UserDecryptRequestVerification: [
        ...eip712.types.UserDecryptRequestVerification,
      ],
    },
    eip712.message,
  );

  const res = await relayer.userDecrypt(
    handleContractPairs,
    keypair.privateKey,
    keypair.publicKey,
    signature.replace(/^0x/, ""),
    contractAddresses,
    devAddr,
    startTimestamp,
    durationDays,
  );

  const decrypted =
    res[resultHex] ??
    res[resultHex.toLowerCase() as `0x${string}`] ??
    Object.entries(res).find(
      ([k]) => k.toLowerCase() === resultHex.toLowerCase(),
    )?.[1];
  if (decrypted === undefined) {
    throw new Error(
      `Result handle ${resultHex} not found in decrypted record. ` +
        `Keys returned: ${Object.keys(res).join(", ")}`,
    );
  }

  const asBool =
    typeof decrypted === "boolean" ? decrypted : Boolean(Number(decrypted));
  console.log("");
  console.log(`API key valid for service #${serviceId}: ${asBool ? "YES" : "NO"}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
