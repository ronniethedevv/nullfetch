// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint128, externalEuint128, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title Marketplace
/// @notice A multi-provider API marketplace where every API key is stored
///         as ciphertext under fhEVM and never visible to the contract,
///         the marketplace operator, or anyone except the developer who
///         generated it.
///
/// Flow:
///   1. A provider lists a service (pays `listingFee`). The service has
///      a public name + description + endpoint + category. No keys yet.
///   2. A developer registers for the service (pays `registrationFee`).
///      The frontend generates a random API key client-side, hashes it
///      with keccak256, splits the digest into two 16-byte halves, and
///      submits them as `externalEuint128 + proof`. The contract stores
///      the encrypted halves; the plaintext never leaves the developer.
///   3. To authenticate, the developer encrypts the same digest halves
///      again and calls `verify` (caller-only result) or
///      `verifyAndAttest` (publicly-decryptable result for off-chain
///      API gating). Provider can `revokeSubscription` at any time.
///
/// Privacy: the contract never sees plaintext keys. The marketplace
/// operator never sees plaintext keys. The provider never sees plaintext
/// keys. Only the developer holds the plaintext, locally.
contract Marketplace is ZamaEthereumConfig {
    // ── categories ─────────────────────────────────────────────────────
    /// Fixed enum so frontends can render friendly labels client-side
    /// and the contract stays compact. Extensible up to uint8.max.
    enum Category {
        Other,           // 0
        AI,              // 1
        Finance,         // 2
        Data,            // 3
        Weather,         // 4
        Utility,         // 5
        Storage,         // 6
        Communications   // 7
    }
    uint8 public constant MAX_CATEGORY = uint8(Category.Communications);

    // ── ownership (two-step) ───────────────────────────────────────────
    address public owner;
    address public pendingOwner;

    // ── treasury + fees ────────────────────────────────────────────────
    address public treasury;
    uint256 public listingFee = 0.0003 ether;
    uint256 public registrationFee = 0.0003 ether;

    // ── services ───────────────────────────────────────────────────────
    /// `name` and `category` are immutable after listing; `description`
    /// and `endpoint` are mutable by the provider (gated by `onlyServiceProvider`
    /// — a wallet signature is required by being `msg.sender`).
    struct Service {
        address provider;
        string name;
        string description;
        string endpoint;
        Category category;
        bool active;
        uint64 createdAt;
        uint64 subscriberCount;
    }

    /// 0 is reserved as "no service" (matches the default value of any
    /// uninitialized `uint256`), so service ids start at 1.
    uint256 public nextServiceId = 1;
    mapping(uint256 => Service) private _services;

    /// Per-category enumerable list of service ids, for paginated browse
    /// views without O(N) iteration. Append on `listService`; the slot
    /// stays in the list even if the service is deactivated, and the
    /// frontend filters by `active` at render time.
    mapping(uint8 => uint256[]) private _byCategory;

    // ── subscriptions ──────────────────────────────────────────────────
    /// Per `(serviceId, developer)`: the encrypted keccak halves of the
    /// developer's API key. Single subscription per pair — re-registering
    /// is blocked; use `rotateKey` to change the key.
    struct Subscription {
        euint128 keyHi;
        euint128 keyLo;
        bool exists;
        bool revoked;
        uint64 registeredAt;
        uint64 callCount;
    }
    mapping(uint256 => mapping(address => Subscription)) private _subs;

    // ── attestations (public-decrypt flow, for API gating) ─────────────
    struct Attestation {
        uint256 serviceId;
        uint64 verifiedAt;
        bool valid;
    }
    mapping(address => Attestation) private _attest;

    struct HandleMeta {
        address requester;
        uint256 serviceId;
    }
    mapping(bytes32 => HandleMeta) private _handleMeta;
    mapping(address => bytes32) public pendingHandle;

    // ── TTL ────────────────────────────────────────────────────────────
    uint256 public attestationTtl = 1 hours;
    uint256 public constant MIN_TTL = 1 minutes;
    uint256 public constant MAX_TTL = 24 hours;

    // ── events ─────────────────────────────────────────────────────────
    event ServiceListed(
        uint256 indexed serviceId,
        address indexed provider,
        Category indexed category,
        string name
    );
    event ServiceActiveSet(uint256 indexed serviceId, bool active);
    event ServiceEndpointUpdated(uint256 indexed serviceId, string endpoint);
    event ServiceDescriptionUpdated(uint256 indexed serviceId, string description);

    event Subscribed(uint256 indexed serviceId, address indexed developer);
    event SubscriptionRevoked(
        uint256 indexed serviceId,
        address indexed developer,
        address indexed by
    );
    event KeyRotated(uint256 indexed serviceId, address indexed developer);

    event Verified(
        uint256 indexed serviceId,
        address indexed developer,
        bytes32 resultHandle
    );
    event AttestationRequested(
        uint256 indexed serviceId,
        address indexed developer,
        bytes32 handle
    );
    event Attested(
        uint256 indexed serviceId,
        address indexed developer,
        bool valid,
        uint64 verifiedAt
    );
    event UsageRecorded(uint256 indexed serviceId, address indexed developer, uint64 callCount);

    event ListingFeeSet(uint256 oldFee, uint256 newFee);
    event RegistrationFeeSet(uint256 oldFee, uint256 newFee);
    event TreasurySet(address indexed oldTreasury, address indexed newTreasury);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event AttestationTtlChanged(uint256 oldTtl, uint256 newTtl);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ── errors ─────────────────────────────────────────────────────────
    error NotOwner();
    error NotPendingOwner();
    error NotProvider();
    error InsufficientFee();
    error ServiceNotFound();
    error ServiceInactive();
    error AlreadySubscribed();
    error NotSubscribed();
    error SubscriptionIsRevoked();
    error EmptyName();
    error InvalidCategory();
    error WrongHandleCount();
    error UnknownHandle();
    error TtlOutOfRange();
    error ZeroAddress();
    error WithdrawFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyServiceProvider(uint256 serviceId) {
        Service storage s = _services[serviceId];
        if (s.provider == address(0)) revert ServiceNotFound();
        if (s.provider != msg.sender) revert NotProvider();
        _;
    }

    constructor() {
        owner = msg.sender;
        treasury = msg.sender;
    }

    // ════════════════════════════════════════════════════════════════
    // Ownership (two-step)
    // ════════════════════════════════════════════════════════════════

    function transferOwnership(address newOwner) external onlyOwner {
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        address prev = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(prev, owner);
    }

    // ════════════════════════════════════════════════════════════════
    // Marketplace admin (fees, treasury, TTL)
    // ════════════════════════════════════════════════════════════════

    function setListingFee(uint256 newFee) external onlyOwner {
        uint256 old = listingFee;
        listingFee = newFee;
        emit ListingFeeSet(old, newFee);
    }

    function setRegistrationFee(uint256 newFee) external onlyOwner {
        uint256 old = registrationFee;
        registrationFee = newFee;
        emit RegistrationFeeSet(old, newFee);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address old = treasury;
        treasury = newTreasury;
        emit TreasurySet(old, newTreasury);
    }

    /// Anyone can trigger the withdraw — the destination is fixed at
    /// `treasury` so there's no attack surface in making this open.
    function withdraw() external {
        uint256 bal = address(this).balance;
        if (bal == 0) return;
        (bool ok, ) = treasury.call{value: bal}("");
        if (!ok) revert WithdrawFailed();
        emit FeesWithdrawn(treasury, bal);
    }

    function setAttestationTtl(uint256 newTtl) external onlyOwner {
        if (newTtl < MIN_TTL || newTtl > MAX_TTL) revert TtlOutOfRange();
        uint256 old = attestationTtl;
        attestationTtl = newTtl;
        emit AttestationTtlChanged(old, newTtl);
    }

    // ════════════════════════════════════════════════════════════════
    // Provider — list / update / revoke
    // ════════════════════════════════════════════════════════════════

    function listService(
        string calldata name,
        string calldata description,
        string calldata endpoint,
        Category category
    ) external payable returns (uint256 serviceId) {
        if (msg.value < listingFee) revert InsufficientFee();
        if (bytes(name).length == 0) revert EmptyName();
        if (uint8(category) > MAX_CATEGORY) revert InvalidCategory();

        serviceId = nextServiceId++;
        _services[serviceId] = Service({
            provider: msg.sender,
            name: name,
            description: description,
            endpoint: endpoint,
            category: category,
            active: true,
            createdAt: uint64(block.timestamp),
            subscriberCount: 0
        });
        _byCategory[uint8(category)].push(serviceId);

        emit ServiceListed(serviceId, msg.sender, category, name);
    }

    function setServiceActive(uint256 serviceId, bool active)
        external
        onlyServiceProvider(serviceId)
    {
        _services[serviceId].active = active;
        emit ServiceActiveSet(serviceId, active);
    }

    /// Endpoint is mutable so providers can move infrastructure without
    /// re-listing. Gated by the wallet signature implicit in
    /// `onlyServiceProvider` (msg.sender == service.provider).
    function setServiceEndpoint(uint256 serviceId, string calldata endpoint)
        external
        onlyServiceProvider(serviceId)
    {
        _services[serviceId].endpoint = endpoint;
        emit ServiceEndpointUpdated(serviceId, endpoint);
    }

    function setServiceDescription(uint256 serviceId, string calldata description)
        external
        onlyServiceProvider(serviceId)
    {
        _services[serviceId].description = description;
        emit ServiceDescriptionUpdated(serviceId, description);
    }

    /// Provider-only revocation of a specific subscriber. Sets the
    /// `revoked` flag — the encrypted key remains in storage but
    /// `verify` / `verifyAndAttest` revert against the slot, and any
    /// in-flight `submitAttestation` for that subscriber is cut off.
    function revokeSubscription(uint256 serviceId, address developer)
        external
        onlyServiceProvider(serviceId)
    {
        Subscription storage sub = _subs[serviceId][developer];
        if (!sub.exists) revert NotSubscribed();
        if (sub.revoked) revert SubscriptionIsRevoked();
        sub.revoked = true;
        emit SubscriptionRevoked(serviceId, developer, msg.sender);
    }

    // ════════════════════════════════════════════════════════════════
    // Developer — register / rotate
    // ════════════════════════════════════════════════════════════════

    function registerForService(
        uint256 serviceId,
        externalEuint128 hiExt,
        externalEuint128 loExt,
        bytes calldata proof
    ) external payable {
        if (msg.value < registrationFee) revert InsufficientFee();

        Service storage s = _services[serviceId];
        if (s.provider == address(0)) revert ServiceNotFound();
        if (!s.active) revert ServiceInactive();

        Subscription storage sub = _subs[serviceId][msg.sender];
        if (sub.exists) revert AlreadySubscribed();

        euint128 hi = FHE.fromExternal(hiExt, proof);
        euint128 lo = FHE.fromExternal(loExt, proof);

        sub.keyHi = hi;
        sub.keyLo = lo;
        sub.exists = true;
        sub.registeredAt = uint64(block.timestamp);

        FHE.allowThis(sub.keyHi);
        FHE.allowThis(sub.keyLo);

        unchecked { s.subscriberCount += 1; }

        emit Subscribed(serviceId, msg.sender);
    }

    /// Rotate the encrypted key for an existing subscription. No fee —
    /// the developer already paid `registrationFee` to subscribe.
    /// Reverts on revoked subs; the developer must ask the provider to
    /// reinstate (or re-list under a new service id).
    function rotateKey(
        uint256 serviceId,
        externalEuint128 hiExt,
        externalEuint128 loExt,
        bytes calldata proof
    ) external {
        Subscription storage sub = _subs[serviceId][msg.sender];
        if (!sub.exists) revert NotSubscribed();
        if (sub.revoked) revert SubscriptionIsRevoked();

        euint128 hi = FHE.fromExternal(hiExt, proof);
        euint128 lo = FHE.fromExternal(loExt, proof);

        sub.keyHi = hi;
        sub.keyLo = lo;

        FHE.allowThis(sub.keyHi);
        FHE.allowThis(sub.keyLo);

        emit KeyRotated(serviceId, msg.sender);
    }

    // ════════════════════════════════════════════════════════════════
    // Verify — caller-only result (user-decrypt)
    // ════════════════════════════════════════════════════════════════

    function verify(
        uint256 serviceId,
        externalEuint128 hiExt,
        externalEuint128 loExt,
        bytes calldata proof
    ) external returns (ebool) {
        Subscription storage sub = _subs[serviceId][msg.sender];
        if (!sub.exists) revert NotSubscribed();
        if (sub.revoked) revert SubscriptionIsRevoked();

        euint128 hi = FHE.fromExternal(hiExt, proof);
        euint128 lo = FHE.fromExternal(loExt, proof);

        require(FHE.isSenderAllowed(hi), "hi handle not allowed for sender");
        require(FHE.isSenderAllowed(lo), "lo handle not allowed for sender");

        ebool hiEq = FHE.eq(hi, sub.keyHi);
        ebool loEq = FHE.eq(lo, sub.keyLo);
        ebool valid = FHE.and(hiEq, loEq);

        FHE.allowThis(valid);
        FHE.allow(valid, msg.sender);

        emit Verified(serviceId, msg.sender, ebool.unwrap(valid));
        return valid;
    }

    // ════════════════════════════════════════════════════════════════
    // Attestation — public-decrypt flow (two-tx)
    // ════════════════════════════════════════════════════════════════

    function verifyAndAttest(
        uint256 serviceId,
        externalEuint128 hiExt,
        externalEuint128 loExt,
        bytes calldata proof
    ) external {
        Subscription storage sub = _subs[serviceId][msg.sender];
        if (!sub.exists) revert NotSubscribed();
        if (sub.revoked) revert SubscriptionIsRevoked();

        euint128 hi = FHE.fromExternal(hiExt, proof);
        euint128 lo = FHE.fromExternal(loExt, proof);
        require(FHE.isSenderAllowed(hi), "hi handle not allowed for sender");
        require(FHE.isSenderAllowed(lo), "lo handle not allowed for sender");

        ebool hiEq = FHE.eq(hi, sub.keyHi);
        ebool loEq = FHE.eq(lo, sub.keyLo);
        ebool valid = FHE.and(hiEq, loEq);

        FHE.allowThis(valid);
        FHE.makePubliclyDecryptable(valid);

        bytes32 handle = ebool.unwrap(valid);
        pendingHandle[msg.sender] = handle;
        _handleMeta[handle] = HandleMeta({requester: msg.sender, serviceId: serviceId});

        emit AttestationRequested(serviceId, msg.sender, handle);
    }

    function submitAttestation(
        bytes32[] calldata handles,
        bytes calldata cleartexts,
        bytes calldata proof
    ) external {
        if (handles.length != 1) revert WrongHandleCount();

        FHE.checkSignatures(handles, cleartexts, proof);

        HandleMeta memory meta = _handleMeta[handles[0]];
        if (meta.requester == address(0)) revert UnknownHandle();

        Subscription storage sub = _subs[meta.serviceId][meta.requester];
        if (sub.revoked) revert SubscriptionIsRevoked();

        // Strict CEI: invalidate handle records first.
        delete _handleMeta[handles[0]];
        delete pendingHandle[meta.requester];

        uint256 raw = abi.decode(cleartexts, (uint256));
        bool decryptedValid = raw != 0;
        uint64 ts = uint64(block.timestamp);

        _attest[meta.requester] = Attestation({
            serviceId: meta.serviceId,
            verifiedAt: ts,
            valid: decryptedValid
        });

        emit Attested(meta.serviceId, meta.requester, decryptedValid, ts);
    }

    // ════════════════════════════════════════════════════════════════
    // Usage metering — optional, public counter
    // ════════════════════════════════════════════════════════════════

    /// Provider's API server calls this after a successful auth to bump
    /// the public call counter. Per-call cost is real; production
    /// deployments should batch updates rather than calling once per
    /// API hit. Skip entirely if you don't need on-chain analytics.
    function recordUse(uint256 serviceId, address developer)
        external
        onlyServiceProvider(serviceId)
    {
        Subscription storage sub = _subs[serviceId][developer];
        if (!sub.exists) revert NotSubscribed();
        unchecked { sub.callCount += 1; }
        emit UsageRecorded(serviceId, developer, sub.callCount);
    }

    // ════════════════════════════════════════════════════════════════
    // Views
    // ════════════════════════════════════════════════════════════════

    function getService(uint256 serviceId) external view returns (Service memory) {
        Service memory s = _services[serviceId];
        if (s.provider == address(0)) revert ServiceNotFound();
        return s;
    }

    /// Total number of listed services (active + inactive). Frontend
    /// uses this for pagination bounds.
    function totalServices() external view returns (uint256) {
        return nextServiceId - 1;
    }

    /// 1-indexed page through all listed services.
    function getServicesPage(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Service[] memory services)
    {
        uint256 total = nextServiceId - 1;
        if (offset >= total || limit == 0) {
            return (new uint256[](0), new Service[](0));
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 count = end - offset;
        ids = new uint256[](count);
        services = new Service[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 id = offset + i + 1;
            ids[i] = id;
            services[i] = _services[id];
        }
    }

    function getServicesByCategory(Category category, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, Service[] memory services)
    {
        uint256[] storage catList = _byCategory[uint8(category)];
        uint256 total = catList.length;
        if (offset >= total || limit == 0) {
            return (new uint256[](0), new Service[](0));
        }
        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 count = end - offset;
        ids = new uint256[](count);
        services = new Service[](count);
        for (uint256 i = 0; i < count; i++) {
            uint256 id = catList[offset + i];
            ids[i] = id;
            services[i] = _services[id];
        }
    }

    function categoryCount(Category category) external view returns (uint256) {
        return _byCategory[uint8(category)].length;
    }

    /// Subscription read — does NOT expose the encrypted key handles
    /// (those are only consumed inside FHE ops). Returns lifecycle
    /// metadata only.
    function getSubscription(uint256 serviceId, address developer)
        external
        view
        returns (bool exists, bool revoked, uint64 registeredAt, uint64 callCount)
    {
        Subscription memory sub = _subs[serviceId][developer];
        return (sub.exists, sub.revoked, sub.registeredAt, sub.callCount);
    }

    function getAttestation(address user)
        external
        view
        returns (bool valid, uint64 verifiedAt, bool fresh, uint256 serviceId)
    {
        Attestation memory a = _attest[user];
        fresh = a.verifiedAt != 0 && block.timestamp <= a.verifiedAt + attestationTtl;
        return (a.valid, a.verifiedAt, fresh, a.serviceId);
    }
}
