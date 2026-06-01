// Human-readable ABI for the deployed Marketplace contract.
//
// externalEuint128 compiles to `bytes32`, input proofs to `bytes`,
// encrypted result handles come through events as `bytes32`. Strings
// and enums (uint8 for `Category`) are encoded as their natural Solidity
// types.
export const MARKETPLACE_ABI = [
  // ── ownership ────────────────────────────────────────────────────
  'function owner() view returns (address)',
  'function pendingOwner() view returns (address)',
  'function transferOwnership(address newOwner)',
  'function acceptOwnership()',

  // ── fees + treasury + TTL ────────────────────────────────────────
  'function treasury() view returns (address)',
  'function listingFee() view returns (uint256)',
  'function registrationFee() view returns (uint256)',
  'function attestationTtl() view returns (uint256)',
  'function setListingFee(uint256 newFee)',
  'function setRegistrationFee(uint256 newFee)',
  'function setTreasury(address newTreasury)',
  'function setAttestationTtl(uint256 newTtl)',
  'function withdraw()',

  // ── services (provider) ──────────────────────────────────────────
  'function listService(string name, string description, string endpoint, uint8 category) payable returns (uint256)',
  'function setServiceActive(uint256 serviceId, bool active)',
  'function setServiceEndpoint(uint256 serviceId, string endpoint)',
  'function setServiceDescription(uint256 serviceId, string description)',
  'function revokeSubscription(uint256 serviceId, address developer)',
  'function recordUse(uint256 serviceId, address developer)',

  // ── subscriptions (developer) ────────────────────────────────────
  'function registerForService(uint256 serviceId, bytes32 hiExt, bytes32 loExt, bytes proof) payable',
  'function rotateKey(uint256 serviceId, bytes32 hiExt, bytes32 loExt, bytes proof)',
  'function verify(uint256 serviceId, bytes32 hiExt, bytes32 loExt, bytes proof) returns (bool)',
  'function verifyAndAttest(uint256 serviceId, bytes32 hiExt, bytes32 loExt, bytes proof)',
  'function submitAttestation(bytes32[] handles, bytes cleartexts, bytes proof)',

  // ── views ────────────────────────────────────────────────────────
  'function totalServices() view returns (uint256)',
  'function categoryCount(uint8 category) view returns (uint256)',
  'function getService(uint256 serviceId) view returns (tuple(address provider, string name, string description, string endpoint, uint8 category, bool active, uint64 createdAt, uint64 subscriberCount))',
  'function getServicesPage(uint256 offset, uint256 limit) view returns (uint256[] ids, tuple(address provider, string name, string description, string endpoint, uint8 category, bool active, uint64 createdAt, uint64 subscriberCount)[] services)',
  'function getServicesByCategory(uint8 category, uint256 offset, uint256 limit) view returns (uint256[] ids, tuple(address provider, string name, string description, string endpoint, uint8 category, bool active, uint64 createdAt, uint64 subscriberCount)[] services)',
  'function getSubscription(uint256 serviceId, address developer) view returns (bool exists, bool revoked, uint64 registeredAt, uint64 callCount)',
  'function getAttestation(address user) view returns (bool valid, uint64 verifiedAt, bool fresh, uint256 serviceId)',
  'function pendingHandle(address) view returns (bytes32)',

  // ── events ───────────────────────────────────────────────────────
  'event ServiceListed(uint256 indexed serviceId, address indexed provider, uint8 indexed category, string name)',
  'event ServiceActiveSet(uint256 indexed serviceId, bool active)',
  'event ServiceEndpointUpdated(uint256 indexed serviceId, string endpoint)',
  'event ServiceDescriptionUpdated(uint256 indexed serviceId, string description)',
  'event Subscribed(uint256 indexed serviceId, address indexed developer)',
  'event SubscriptionRevoked(uint256 indexed serviceId, address indexed developer, address indexed by)',
  'event KeyRotated(uint256 indexed serviceId, address indexed developer)',
  'event Verified(uint256 indexed serviceId, address indexed developer, bytes32 resultHandle)',
  'event AttestationRequested(uint256 indexed serviceId, address indexed developer, bytes32 handle)',
  'event Attested(uint256 indexed serviceId, address indexed developer, bool valid, uint64 verifiedAt)',
  'event UsageRecorded(uint256 indexed serviceId, address indexed developer, uint64 callCount)',
  'event ListingFeeSet(uint256 oldFee, uint256 newFee)',
  'event RegistrationFeeSet(uint256 oldFee, uint256 newFee)',
  'event TreasurySet(address indexed oldTreasury, address indexed newTreasury)',
  'event FeesWithdrawn(address indexed to, uint256 amount)',
  'event AttestationTtlChanged(uint256 oldTtl, uint256 newTtl)',
  'event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner)',
  'event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)',
] as const;

/// Category enum mirror — keep in sync with Marketplace.sol.
export const CATEGORIES = [
  'Other',
  'AI',
  'Finance',
  'Data',
  'Weather',
  'Utility',
  'Storage',
  'Communications',
] as const;
export type CategoryName = (typeof CATEGORIES)[number];

/// Backwards-compat alias so the Phase 0 panels keep compiling until
/// Phase 2 rewrites them. They'll be runtime-broken against the
/// Marketplace surface (the old `verify(bytes32, bytes32, bytes)`
/// signature doesn't exist anymore) but the build stays green.
export const VERIFIER_ABI = MARKETPLACE_ABI;

export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_CHAIN_ID_HEX = '0xaa36a7';
