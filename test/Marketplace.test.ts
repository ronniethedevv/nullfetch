import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import type { ContractTransactionReceipt, Signer } from "ethers";
import type { Marketplace } from "../typechain-types";
import { digestHalves } from "../scripts/_keyHelpers";

// ── enum mirror for tests ──────────────────────────────────────────
const Category = {
  Other: 0,
  AI: 1,
  Finance: 2,
  Data: 3,
  Weather: 4,
  Utility: 5,
  Storage: 6,
  Communications: 7,
} as const;

const LISTING_FEE = ethers.parseEther("0.0003");
const REGISTRATION_FEE = ethers.parseEther("0.0003");

// ── helpers ────────────────────────────────────────────────────────
async function encryptHalves(
  contractAddr: string,
  caller: string,
  hi: bigint,
  lo: bigint,
) {
  const input = fhevm.createEncryptedInput(contractAddr, caller);
  input.add128(hi);
  input.add128(lo);
  return input.encrypt();
}

function extractEvent(
  contract: Marketplace,
  rc: ContractTransactionReceipt | null,
  name: string,
): Record<string, unknown> {
  if (!rc) throw new Error("missing receipt");
  for (const log of rc.logs) {
    try {
      const parsed = contract.interface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
      if (parsed?.name === name) {
        return parsed.args.toObject() as Record<string, unknown>;
      }
    } catch {
      // not ours
    }
  }
  throw new Error(`${name} event not found`);
}

async function listService(
  market: Marketplace,
  provider: Signer,
  name: string,
  description: string,
  endpoint: string,
  category: number,
): Promise<bigint> {
  const tx = await market
    .connect(provider)
    .listService(name, description, endpoint, category, { value: LISTING_FEE });
  const rc = await tx.wait();
  const ev = extractEvent(market, rc, "ServiceListed");
  return ev.serviceId as bigint;
}

async function registerForService(
  market: Marketplace,
  marketAddr: string,
  developer: Signer,
  serviceId: bigint,
  key: string,
) {
  const devAddr = await developer.getAddress();
  const { hi, lo } = digestHalves(key);
  const enc = await encryptHalves(marketAddr, devAddr, hi, lo);
  return market
    .connect(developer)
    .registerForService(serviceId, enc.handles[0], enc.handles[1], enc.inputProof, {
      value: REGISTRATION_FEE,
    });
}

async function runVerify(
  market: Marketplace,
  marketAddr: string,
  developer: Signer,
  serviceId: bigint,
  key: string,
): Promise<string> {
  const devAddr = await developer.getAddress();
  const { hi, lo } = digestHalves(key);
  const enc = await encryptHalves(marketAddr, devAddr, hi, lo);
  const tx = await market
    .connect(developer)
    .verify(serviceId, enc.handles[0], enc.handles[1], enc.inputProof);
  const rc = await tx.wait();
  const ev = extractEvent(market, rc, "Verified");
  return ev.resultHandle as string;
}

async function runAttestRound(
  market: Marketplace,
  marketAddr: string,
  developer: Signer,
  serviceId: bigint,
  key: string,
): Promise<string> {
  const devAddr = await developer.getAddress();
  const { hi, lo } = digestHalves(key);
  const enc = await encryptHalves(marketAddr, devAddr, hi, lo);

  const tx = await market
    .connect(developer)
    .verifyAndAttest(serviceId, enc.handles[0], enc.handles[1], enc.inputProof);
  const rc = await tx.wait();
  const ev = extractEvent(market, rc, "AttestationRequested");
  const handle = ev.handle as string;

  const dec = await fhevm.publicDecrypt([handle]);
  await market
    .connect(developer)
    .submitAttestation([handle], dec.abiEncodedClearValues, dec.decryptionProof);
  return handle;
}

// ── tests ──────────────────────────────────────────────────────────
describe("Marketplace", () => {
  let market: Marketplace;
  let marketAddr: string;
  let owner: Signer;
  let alice: Signer; // provider
  let bob: Signer;   // developer
  let carol: Signer; // other party
  let dave: Signer;  // treasury target

  const ACME_KEY = "sk_alice_42-the-real-key";
  const GLOBEX_KEY = "sk_alice_99-a-second-key";

  beforeEach(async () => {
    await fhevm.initializeCLIApi();
    [owner, alice, bob, carol, dave] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory("Marketplace", owner);
    market = (await Factory.deploy()) as unknown as Marketplace;
    await market.waitForDeployment();
    marketAddr = await market.getAddress();
  });

  // ── basic state ────────────────────────────────────────────────
  it("starts with sane defaults", async () => {
    expect(await market.owner()).to.equal(await owner.getAddress());
    expect(await market.treasury()).to.equal(await owner.getAddress());
    expect(await market.listingFee()).to.equal(LISTING_FEE);
    expect(await market.registrationFee()).to.equal(REGISTRATION_FEE);
    expect(await market.attestationTtl()).to.equal(3600n);
    expect(await market.totalServices()).to.equal(0n);
    expect(await market.nextServiceId()).to.equal(1n);
  });

  // ── listService ────────────────────────────────────────────────
  it("listService reverts on under-pay", async () => {
    await expect(
      market
        .connect(alice)
        .listService("Acme", "desc", "https://acme.dev", Category.AI, {
          value: LISTING_FEE - 1n,
        }),
    ).to.be.revertedWithCustomError(market, "InsufficientFee");
  });

  it("listService reverts on empty name", async () => {
    await expect(
      market
        .connect(alice)
        .listService("", "desc", "https://acme.dev", Category.AI, { value: LISTING_FEE }),
    ).to.be.revertedWithCustomError(market, "EmptyName");
  });

  it("listService reverts on invalid category", async () => {
    await expect(
      market
        .connect(alice)
        .listService("Acme", "desc", "https://acme.dev", 99, { value: LISTING_FEE }),
    ).to.be.reverted; // enum cast revert from Solidity
  });

  it("listService creates the service and emits ServiceListed", async () => {
    const id = await listService(market, alice, "Acme", "fun facts", "https://acme.dev", Category.AI);
    expect(id).to.equal(1n);

    const s = await market.getService(1);
    expect(s.provider).to.equal(await alice.getAddress());
    expect(s.name).to.equal("Acme");
    expect(s.description).to.equal("fun facts");
    expect(s.endpoint).to.equal("https://acme.dev");
    expect(Number(s.category)).to.equal(Category.AI);
    expect(s.active).to.equal(true);
    expect(s.subscriberCount).to.equal(0n);
    expect(await market.totalServices()).to.equal(1n);
  });

  it("listService accepts overpayment (no refund)", async () => {
    const tx = await market
      .connect(alice)
      .listService("Acme", "d", "https://acme.dev", Category.AI, { value: LISTING_FEE * 3n });
    await tx.wait();
    expect(await ethers.provider.getBalance(marketAddr)).to.equal(LISTING_FEE * 3n);
  });

  // ── service updates ─────────────────────────────────────────────
  it("setServiceEndpoint: provider-only, updates value, emits event", async () => {
    const id = await listService(market, alice, "Acme", "d", "https://acme.dev", Category.AI);
    await expect(
      market.connect(bob).setServiceEndpoint(id, "https://attacker.dev"),
    ).to.be.revertedWithCustomError(market, "NotProvider");

    await expect(market.connect(alice).setServiceEndpoint(id, "https://acme2.dev"))
      .to.emit(market, "ServiceEndpointUpdated")
      .withArgs(id, "https://acme2.dev");

    expect((await market.getService(id)).endpoint).to.equal("https://acme2.dev");
  });

  it("setServiceDescription: provider-only, updates value", async () => {
    const id = await listService(market, alice, "Acme", "old", "https://acme.dev", Category.AI);
    await market.connect(alice).setServiceDescription(id, "new copy");
    expect((await market.getService(id)).description).to.equal("new copy");
  });

  it("name and category cannot be changed after listing (no setters exist)", async () => {
    const id = await listService(market, alice, "Acme", "d", "https://acme.dev", Category.AI);
    // No setName or setCategory in the contract surface. Confirm fields
    // round-trip exactly as listed.
    const s = await market.getService(id);
    expect(s.name).to.equal("Acme");
    expect(Number(s.category)).to.equal(Category.AI);
  });

  it("setServiceActive: provider toggles active flag", async () => {
    const id = await listService(market, alice, "Acme", "d", "https://acme.dev", Category.AI);
    await market.connect(alice).setServiceActive(id, false);
    expect((await market.getService(id)).active).to.equal(false);
    await market.connect(alice).setServiceActive(id, true);
    expect((await market.getService(id)).active).to.equal(true);
  });

  // ── pagination + categories ─────────────────────────────────────
  it("pagination + category filtering work as advertised", async () => {
    await listService(market, alice, "AcmeAI", "d", "u", Category.AI);
    await listService(market, alice, "AcmeFin", "d", "u", Category.Finance);
    await listService(market, alice, "AcmeAI2", "d", "u", Category.AI);
    await listService(market, carol, "Globex", "d", "u", Category.Data);

    expect(await market.totalServices()).to.equal(4n);
    expect(await market.categoryCount(Category.AI)).to.equal(2n);
    expect(await market.categoryCount(Category.Finance)).to.equal(1n);
    expect(await market.categoryCount(Category.Other)).to.equal(0n);

    const [allIds] = await market.getServicesPage(0, 10);
    expect(allIds.map(Number)).to.deep.equal([1, 2, 3, 4]);

    const [page] = await market.getServicesPage(1, 2);
    expect(page.map(Number)).to.deep.equal([2, 3]);

    const [aiIds, aiServices] = await market.getServicesByCategory(Category.AI, 0, 10);
    expect(aiIds.map(Number)).to.deep.equal([1, 3]);
    expect(aiServices.map((s) => s.name)).to.deep.equal(["AcmeAI", "AcmeAI2"]);

    const [empty] = await market.getServicesPage(99, 10);
    expect(empty.length).to.equal(0);
  });

  // ── subscriptions ───────────────────────────────────────────────
  it("registerForService reverts on under-pay", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    const { hi, lo } = digestHalves(ACME_KEY);
    const enc = await encryptHalves(marketAddr, await bob.getAddress(), hi, lo);
    await expect(
      market
        .connect(bob)
        .registerForService(id, enc.handles[0], enc.handles[1], enc.inputProof, {
          value: REGISTRATION_FEE - 1n,
        }),
    ).to.be.revertedWithCustomError(market, "InsufficientFee");
  });

  it("registerForService reverts when service does not exist", async () => {
    const { hi, lo } = digestHalves(ACME_KEY);
    const enc = await encryptHalves(marketAddr, await bob.getAddress(), hi, lo);
    await expect(
      market
        .connect(bob)
        .registerForService(99n, enc.handles[0], enc.handles[1], enc.inputProof, {
          value: REGISTRATION_FEE,
        }),
    ).to.be.revertedWithCustomError(market, "ServiceNotFound");
  });

  it("registerForService reverts when service is inactive", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await market.connect(alice).setServiceActive(id, false);
    const { hi, lo } = digestHalves(ACME_KEY);
    const enc = await encryptHalves(marketAddr, await bob.getAddress(), hi, lo);
    await expect(
      market
        .connect(bob)
        .registerForService(id, enc.handles[0], enc.handles[1], enc.inputProof, {
          value: REGISTRATION_FEE,
        }),
    ).to.be.revertedWithCustomError(market, "ServiceInactive");
  });

  it("registerForService succeeds and increments subscriberCount", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await (await registerForService(market, marketAddr, bob, id, ACME_KEY)).wait();

    const sub = await market.getSubscription(id, await bob.getAddress());
    expect(sub.exists).to.equal(true);
    expect(sub.revoked).to.equal(false);
    expect(sub.callCount).to.equal(0n);

    expect((await market.getService(id)).subscriberCount).to.equal(1n);
  });

  it("re-registering for the same service reverts (single sub per dev)", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await (await registerForService(market, marketAddr, bob, id, ACME_KEY)).wait();
    await expect(registerForService(market, marketAddr, bob, id, "different")).to.be.revertedWithCustomError(
      market,
      "AlreadySubscribed",
    );
  });

  it("two developers can each subscribe to the same service", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await (await registerForService(market, marketAddr, bob, id, ACME_KEY)).wait();
    await (await registerForService(market, marketAddr, carol, id, "carols-key")).wait();
    expect((await market.getService(id)).subscriberCount).to.equal(2n);
  });

  // ── rotateKey ───────────────────────────────────────────────────
  it("rotateKey: requires existing subscription", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    const { hi, lo } = digestHalves("foo");
    const enc = await encryptHalves(marketAddr, await bob.getAddress(), hi, lo);
    await expect(
      market.connect(bob).rotateKey(id, enc.handles[0], enc.handles[1], enc.inputProof),
    ).to.be.revertedWithCustomError(market, "NotSubscribed");
  });

  it("rotateKey: invalidates the old key", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await (await registerForService(market, marketAddr, bob, id, ACME_KEY)).wait();

    // Original key matches.
    {
      const h = await runVerify(market, marketAddr, bob, id, ACME_KEY);
      expect(await fhevm.userDecryptEbool(h, marketAddr, bob)).to.equal(true);
    }

    // Rotate.
    {
      const { hi, lo } = digestHalves(GLOBEX_KEY);
      const enc = await encryptHalves(marketAddr, await bob.getAddress(), hi, lo);
      await (await market.connect(bob).rotateKey(id, enc.handles[0], enc.handles[1], enc.inputProof)).wait();
    }

    // Old key no longer matches.
    {
      const h = await runVerify(market, marketAddr, bob, id, ACME_KEY);
      expect(await fhevm.userDecryptEbool(h, marketAddr, bob)).to.equal(false);
    }
    // New key matches.
    {
      const h = await runVerify(market, marketAddr, bob, id, GLOBEX_KEY);
      expect(await fhevm.userDecryptEbool(h, marketAddr, bob)).to.equal(true);
    }
  });

  // ── verify (user-decrypt) ───────────────────────────────────────
  it("verify: matching key → true; wrong key → false", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await (await registerForService(market, marketAddr, bob, id, ACME_KEY)).wait();

    {
      const h = await runVerify(market, marketAddr, bob, id, ACME_KEY);
      expect(await fhevm.userDecryptEbool(h, marketAddr, bob)).to.equal(true);
    }
    {
      const h = await runVerify(market, marketAddr, bob, id, "nope");
      expect(await fhevm.userDecryptEbool(h, marketAddr, bob)).to.equal(false);
    }
  });

  it("verify: caller without subscription reverts", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    const { hi, lo } = digestHalves(ACME_KEY);
    const enc = await encryptHalves(marketAddr, await bob.getAddress(), hi, lo);
    await expect(
      market.connect(bob).verify(id, enc.handles[0], enc.handles[1], enc.inputProof),
    ).to.be.revertedWithCustomError(market, "NotSubscribed");
  });

  it("verify: cross-service isolation — bob's key for service A does not validate against service B", async () => {
    const idA = await listService(market, alice, "Acme", "d", "u", Category.AI);
    const idB = await listService(market, alice, "Globex", "d", "u", Category.Data);
    await (await registerForService(market, marketAddr, bob, idA, ACME_KEY)).wait();
    await (await registerForService(market, marketAddr, bob, idB, GLOBEX_KEY)).wait();

    // bob's GLOBEX key submitted to ACME slot → mismatch.
    const h = await runVerify(market, marketAddr, bob, idA, GLOBEX_KEY);
    expect(await fhevm.userDecryptEbool(h, marketAddr, bob)).to.equal(false);
  });

  it("verify: cross-caller isolation — carol cannot decrypt bob's result", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await (await registerForService(market, marketAddr, bob, id, ACME_KEY)).wait();
    const h = await runVerify(market, marketAddr, bob, id, ACME_KEY);
    expect(await fhevm.userDecryptEbool(h, marketAddr, bob)).to.equal(true);
    await expect(fhevm.userDecryptEbool(h, marketAddr, carol)).to.be.rejected;
  });

  // ── revocation ──────────────────────────────────────────────────
  it("revokeSubscription: provider-only", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await (await registerForService(market, marketAddr, bob, id, ACME_KEY)).wait();
    await expect(
      market.connect(carol).revokeSubscription(id, await bob.getAddress()),
    ).to.be.revertedWithCustomError(market, "NotProvider");
  });

  it("revokeSubscription: reverts when developer was not subscribed", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await expect(
      market.connect(alice).revokeSubscription(id, await bob.getAddress()),
    ).to.be.revertedWithCustomError(market, "NotSubscribed");
  });

  it("revoked sub: verify reverts, rotateKey reverts, status flag set", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await (await registerForService(market, marketAddr, bob, id, ACME_KEY)).wait();
    await (await market.connect(alice).revokeSubscription(id, await bob.getAddress())).wait();

    const sub = await market.getSubscription(id, await bob.getAddress());
    expect(sub.exists).to.equal(true);
    expect(sub.revoked).to.equal(true);

    const { hi, lo } = digestHalves(ACME_KEY);
    const enc = await encryptHalves(marketAddr, await bob.getAddress(), hi, lo);
    await expect(
      market.connect(bob).verify(id, enc.handles[0], enc.handles[1], enc.inputProof),
    ).to.be.revertedWithCustomError(market, "SubscriptionIsRevoked");
    await expect(
      market.connect(bob).rotateKey(id, enc.handles[0], enc.handles[1], enc.inputProof),
    ).to.be.revertedWithCustomError(market, "SubscriptionIsRevoked");
  });

  // ── attestation flow ────────────────────────────────────────────
  it("verifyAndAttest (match): getAttestation returns valid=true, fresh=true, correct serviceId", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await (await registerForService(market, marketAddr, bob, id, ACME_KEY)).wait();
    await runAttestRound(market, marketAddr, bob, id, ACME_KEY);

    const [valid, verifiedAt, fresh, serviceId] = await market.getAttestation(
      await bob.getAddress(),
    );
    expect(valid).to.equal(true);
    expect(fresh).to.equal(true);
    expect(serviceId).to.equal(id);
    expect(Number(verifiedAt)).to.be.greaterThan(0);
  });

  it("verifyAndAttest (mismatch): valid=false but serviceId still recorded", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await (await registerForService(market, marketAddr, bob, id, ACME_KEY)).wait();
    await runAttestRound(market, marketAddr, bob, id, "wrong-key");

    const [valid, , fresh, serviceId] = await market.getAttestation(await bob.getAddress());
    expect(valid).to.equal(false);
    expect(fresh).to.equal(true);
    expect(serviceId).to.equal(id);
  });

  it("attestation: serviceId reflects most-recent attestation", async () => {
    const idA = await listService(market, alice, "Acme", "d", "u", Category.AI);
    const idB = await listService(market, alice, "Globex", "d", "u", Category.Data);
    await (await registerForService(market, marketAddr, bob, idA, ACME_KEY)).wait();
    await (await registerForService(market, marketAddr, bob, idB, GLOBEX_KEY)).wait();

    await runAttestRound(market, marketAddr, bob, idA, ACME_KEY);
    let [, , , sid] = await market.getAttestation(await bob.getAddress());
    expect(sid).to.equal(idA);

    await runAttestRound(market, marketAddr, bob, idB, GLOBEX_KEY);
    [, , , sid] = await market.getAttestation(await bob.getAddress());
    expect(sid).to.equal(idB);
  });

  it("revoked sub: in-flight submitAttestation is cut off", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await (await registerForService(market, marketAddr, bob, id, ACME_KEY)).wait();

    // Stage the pending attestation.
    const { hi, lo } = digestHalves(ACME_KEY);
    const enc = await encryptHalves(marketAddr, await bob.getAddress(), hi, lo);
    const tx = await market
      .connect(bob)
      .verifyAndAttest(id, enc.handles[0], enc.handles[1], enc.inputProof);
    const rc = await tx.wait();
    const ev = extractEvent(market, rc, "AttestationRequested");
    const handle = ev.handle as string;

    // Provider revokes mid-flight.
    await (await market.connect(alice).revokeSubscription(id, await bob.getAddress())).wait();

    const dec = await fhevm.publicDecrypt([handle]);
    await expect(
      market
        .connect(bob)
        .submitAttestation([handle], dec.abiEncodedClearValues, dec.decryptionProof),
    ).to.be.revertedWithCustomError(market, "SubscriptionIsRevoked");
  });

  it("attestation staleness: after attestationTtl elapses, fresh flips to false", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await (await registerForService(market, marketAddr, bob, id, ACME_KEY)).wait();
    await runAttestRound(market, marketAddr, bob, id, ACME_KEY);

    await ethers.provider.send("evm_increaseTime", [3601]);
    await ethers.provider.send("evm_mine", []);

    const [valid, , fresh] = await market.getAttestation(await bob.getAddress());
    expect(valid).to.equal(true);
    expect(fresh).to.equal(false);
  });

  // ── usage recording ─────────────────────────────────────────────
  it("recordUse: provider-only, increments call counter", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await (await registerForService(market, marketAddr, bob, id, ACME_KEY)).wait();

    await expect(
      market.connect(carol).recordUse(id, await bob.getAddress()),
    ).to.be.revertedWithCustomError(market, "NotProvider");

    await market.connect(alice).recordUse(id, await bob.getAddress());
    await market.connect(alice).recordUse(id, await bob.getAddress());
    const sub = await market.getSubscription(id, await bob.getAddress());
    expect(sub.callCount).to.equal(2n);
  });

  it("recordUse: reverts when developer has no subscription", async () => {
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await expect(
      market.connect(alice).recordUse(id, await bob.getAddress()),
    ).to.be.revertedWithCustomError(market, "NotSubscribed");
  });

  // ── fees + treasury + withdraw ──────────────────────────────────
  it("setListingFee / setRegistrationFee: owner-only, takes effect on next call", async () => {
    await expect(market.connect(alice).setListingFee(0)).to.be.revertedWithCustomError(
      market,
      "NotOwner",
    );
    await market.connect(owner).setListingFee(0);
    // With fee=0 anyone can list without payment.
    const tx = await market
      .connect(alice)
      .listService("Free", "d", "u", Category.Other, { value: 0 });
    await tx.wait();
    expect(await market.totalServices()).to.equal(1n);
  });

  it("setTreasury: owner-only, rejects zero address", async () => {
    await expect(market.connect(alice).setTreasury(await dave.getAddress())).to.be.revertedWithCustomError(
      market,
      "NotOwner",
    );
    await expect(market.connect(owner).setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      market,
      "ZeroAddress",
    );
    await market.connect(owner).setTreasury(await dave.getAddress());
    expect(await market.treasury()).to.equal(await dave.getAddress());
  });

  it("withdraw: anyone can trigger, funds go to treasury", async () => {
    // Accumulate some balance: one listing + one registration.
    const id = await listService(market, alice, "Acme", "d", "u", Category.AI);
    await (await registerForService(market, marketAddr, bob, id, ACME_KEY)).wait();
    expect(await ethers.provider.getBalance(marketAddr)).to.equal(LISTING_FEE + REGISTRATION_FEE);

    await market.connect(owner).setTreasury(await dave.getAddress());
    const before = await ethers.provider.getBalance(await dave.getAddress());

    await (await market.connect(carol).withdraw()).wait();
    const after = await ethers.provider.getBalance(await dave.getAddress());

    expect(after - before).to.equal(LISTING_FEE + REGISTRATION_FEE);
    expect(await ethers.provider.getBalance(marketAddr)).to.equal(0n);
  });

  it("withdraw: zero-balance no-op does not revert", async () => {
    await (await market.connect(carol).withdraw()).wait();
  });

  // ── two-step ownership ──────────────────────────────────────────
  it("transferOwnership / acceptOwnership: two-step transfer", async () => {
    await market.connect(owner).transferOwnership(await alice.getAddress());
    expect(await market.owner()).to.equal(await owner.getAddress());
    expect(await market.pendingOwner()).to.equal(await alice.getAddress());

    await expect(market.connect(bob).acceptOwnership()).to.be.revertedWithCustomError(
      market,
      "NotPendingOwner",
    );

    await market.connect(alice).acceptOwnership();
    expect(await market.owner()).to.equal(await alice.getAddress());
    expect(await market.pendingOwner()).to.equal(ethers.ZeroAddress);

    // Old owner can no longer set fees.
    await expect(market.connect(owner).setListingFee(0)).to.be.revertedWithCustomError(
      market,
      "NotOwner",
    );
  });

  // ── TTL ─────────────────────────────────────────────────────────
  it("setAttestationTtl: owner-only, bounded", async () => {
    await expect(market.connect(alice).setAttestationTtl(120)).to.be.revertedWithCustomError(
      market,
      "NotOwner",
    );
    await expect(market.connect(owner).setAttestationTtl(0)).to.be.revertedWithCustomError(
      market,
      "TtlOutOfRange",
    );
    await expect(
      market.connect(owner).setAttestationTtl(25 * 60 * 60),
    ).to.be.revertedWithCustomError(market, "TtlOutOfRange");
    await market.connect(owner).setAttestationTtl(120);
    expect(await market.attestationTtl()).to.equal(120n);
  });
});
