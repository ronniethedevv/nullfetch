import { ethers } from "ethers";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

/// Split keccak256(utf8(key)) into hi/lo 16-byte BigInts.
export function digestHalves(key: string): { hi: bigint; lo: bigint } {
  const hex = ethers.keccak256(ethers.toUtf8Bytes(key)).slice(2); // 64 hex chars
  const hi = BigInt("0x" + hex.slice(0, 32));
  const lo = BigInt("0x" + hex.slice(32, 64));
  return { hi, lo };
}

/// Resolve the marketplace address: prefer env, fall back to
/// deployments.json for the current network name. The key is
/// `Marketplace` (the contract name written by deploy.ts).
export function resolveMarketplaceAddress(networkName: string): string {
  if (process.env.MARKETPLACE_ADDRESS) return process.env.MARKETPLACE_ADDRESS;

  const file = join(process.cwd(), "deployments.json");
  if (existsSync(file)) {
    const data = JSON.parse(readFileSync(file, "utf8")) as Record<
      string,
      { Marketplace?: string }
    >;
    const a = data[networkName]?.Marketplace;
    if (a) return a;
  }
  throw new Error(
    "MARKETPLACE_ADDRESS is not set and deployments.json has no entry " +
      `for network "${networkName}". Run \`npm run deploy:sepolia\` first.`,
  );
}

/// Require a non-empty env var, with a helpful message on miss.
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. See .env.example.`,
    );
  }
  return v;
}

/// Category enum mirror — kept in sync with Marketplace.sol's `Category`.
export const Category = {
  Other: 0,
  AI: 1,
  Finance: 2,
  Data: 3,
  Weather: 4,
  Utility: 5,
  Storage: 6,
  Communications: 7,
} as const;
export type CategoryName = keyof typeof Category;

/// Parse a category string (case-insensitive) into the on-chain uint8.
export function parseCategory(label: string): number {
  const norm = label.trim();
  const key = (Object.keys(Category) as CategoryName[]).find(
    (k) => k.toLowerCase() === norm.toLowerCase(),
  );
  if (!key) {
    const valid = (Object.keys(Category) as CategoryName[]).join(", ");
    throw new Error(`Unknown category "${label}". Valid: ${valid}.`);
  }
  return Category[key];
}
