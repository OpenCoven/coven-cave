# Client v1 HPKE-Bound Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. **Checkbox state in this document is not evidence of completion. Verify what has shipped against code and merged PRs.**

**Goal:** Add a compatibility-safe, SDK-consumable RFC 9180 `hpke-bound-v1` producer mechanism that atomically binds pairing-secret and bearer-bearing Client v1 requests and responses to one per-runtime Cave authority.

**Architecture:** Keep the current Client v1 protocol byte-for-byte live by default: `COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE=off` continues publishing discovery v1 and serving the existing plaintext credential path. Explicit `advertise` and `enforce` modes publish discovery v2 with a per-boot X25519 HPKE public key; protected requests use HPKE Base mode, fixed binary AAD, atomic process-local replay reservation, and a fresh client response key, while Cave returns every successfully opened request through HPKE Auth mode so only the proved Cave runtime can produce an actionable response. An active-mode bootstrap failure is a distinct fail-closed unavailable state: Cave publishes no v2 record and every protected operation returns fixed 503 guidance without invoking the legacy plaintext callback.

**Tech Stack:** TypeScript 6, Node.js 24 Web Crypto, Next.js 16 App Router, `@hpke/core@1.9.0`, `@hpke/dhkem-x25519@1.8.0`, RFC 9180 DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM, RFC 8785 canonical JSON via the existing `canonicalize@3.0.0`, Node test runner, pnpm 10.

---

## Compatibility and staging decision

Use one boot-time setting with three closed values:

```ts
export type ClientV1AuthorityMode = "off" | "advertise" | "enforce";

export const CLIENT_V1_AUTHORITY_MODE_ENV =
  "COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE";

export function parseClientV1AuthorityMode(
  raw: string | undefined,
): ClientV1AuthorityMode {
  const value = raw?.trim() || "off";
  if (value === "off" || value === "advertise" || value === "enforce") {
    return value;
  }
  throw new Error(
    `${CLIENT_V1_AUTHORITY_MODE_ENV} must be off, advertise, or enforce.`,
  );
}
```

| Mode | Discovery | Plaintext protected request | Bound protected request | Purpose |
|---|---|---|---|---|
| `off` | Existing version `1`, unchanged fields and values | Existing behavior | Not activated; it reaches the existing handler without a plaintext credential and is refused normally | Merge-safe default for all current Client v1 consumers |
| `advertise` | Version `2` with `hpke-bound-v1` public metadata | Accepted for compatibility only when the authority header is absent | Accepted; response is authenticated and encrypted | SDK and Chat integration before the enforcement flip |
| `enforce` | Version `2` with the same public metadata | Rejected when the authority header is absent; invalid when it is present but non-exact | Required and accepted | Opt-in real-socket enforcement and later production posture |

The following downgrade rules are mandatory:

1. The mechanism header is absent only when `headers.get("x-coven-client-v1-authority") === null`. `advertise` may use the legacy plaintext callback only in that exact case.
2. Every present mechanism value other than exact ASCII `hpke-bound-v1`—including empty, whitespace-normalized empty, case-changed, duplicate, or comma-combined values—returns fixed `400 authority_invalid` in both `advertise` and `enforce`, before reading credentials or invoking a callback.
3. Once the exact `x-coven-client-v1-authority: hpke-bound-v1` marker is present, any missing field, invalid encoding, failed HPKE open, wrong AAD, or wrong credential kind is terminal for that request. `advertise` must never fall back to plaintext after a bound attempt.
4. In `enforce`, an absent marker on a protected operation returns `426 incompatible_version` before reading `Authorization` or `X-Coven-Pairing-Secret`.
5. A stale key ID requires rediscovery; Cave never tries another boot key.
6. Only a successfully HPKE-authenticated response may cause a consumer to discard, revoke, or re-pair a credential. A plaintext pre-decryption error is transport guidance, never authenticated credential state.
7. `advertise` or `enforce` with an unavailable boot key is not equivalent to `off`. Every protected operation returns `503 service_unavailable` with `details.reason: "authority_unavailable"` before any pairing-secret/bearer parser, store, rate limiter, read source, or legacy callback runs.

Current behavior remains unchanged unless an operator explicitly selects `advertise` or `enforce`. No operation ID, capability, health field, pairing lifetime, bearer format, route, rate-limit budget, or administrator credential changes in this slice.

## Runtime topology invariant

This design is intentionally single-process. One standalone Node.js request-serving process owns exactly one active authority keypair, one runtime nonce, and one in-memory replay map for the discovery endpoint it publishes. JavaScript run-to-completion makes the synchronous replay reservation atomic only inside that process.

A future multi-worker or load-balanced deployment must not reuse discovery v2 unchanged unless it provides one of these reviewed designs:

1. one shared authority tuple plus a linearizable cross-worker `reserve(keyId, requestNonce)` operation whose success is committed before any protected callback; or
2. a distinct endpoint and discovery record per worker, with routing that cannot send a request for one authority tuple to another worker.

Until such a design has its own wire/runtime review, startup configuration must not enable active Client v1 authority mode across multiple request-serving workers. If the process cannot prove that it owns the published key and replay state, protected operations fail closed with `clientV1AuthorityUnavailableResponse()`; they never fall back to plaintext, even in `advertise`.

## Protected operation inventory and administrator scope

Add explicit credential and binding metadata to the existing operation registry:

| Operation | Current ingress | Credential carried by request | `hpke-bound-v1` |
|---|---|---|---|
| `health.read` | public | none | none |
| `pairing.create` | public | none | none |
| `pairing.poll` | public | pairing secret | protected |
| `pairing.exchange` | public | pairing secret | protected |
| `pairing.admin.list` | admin | Cave sidecar token | out of scope |
| `pairing.admin.decide` | admin | Cave sidecar token | out of scope |
| `credentials.admin.list` | admin | Cave sidecar token | out of scope |
| `credentials.admin.revoke` | admin | Cave sidecar token | out of scope |
| `familiars.list` | authenticated | bearer | protected |
| `projects.list` | authenticated | bearer | protected |
| `conversations.list` | authenticated | bearer | protected |
| `conversations.read` | authenticated | bearer | protected |
| `messages.list` | authenticated | bearer | protected |

`pairing.poll` is protected because the current route carries `X-Coven-Pairing-Secret`; it does not qualify for the “status may remain public where no secret is carried” exception. Health and pairing creation remain public. The four admin operations are explicitly excluded because the actual code classifies them as `admin`, keeps them behind the ordinary per-launch sidecar-token boundary, and never accepts a paired bearer for them. Record this exclusion in the contract and reference documentation rather than silently omitting it.

## File responsibility map

### Create

- `src/lib/server/client-v1/authority-contract.ts`
  - Pure, edge-safe constants and TypeScript wire types.
  - Header names, suite identifiers, bounds, mode names, protected credential kinds, response media type, discovery-v2 shape, and vector-fixture filenames.
  - No Node APIs, HPKE imports, `Buffer`, route imports, or side effects.
- `src/lib/server/client-v1/authority-contract.test.ts`
  - Pins exact names, values, bounds, protected operation inventory, and absence of private-key fields.
- `src/lib/server/client-v1/hpke-bound-v1.ts`
  - The only module that constructs the RFC 9180 suite and performs HPKE Base request open and HPKE Auth response seal.
  - Strict base64url, RFC 8785 payload canonicalization, key-ID derivation, canonical route encoding, fixed binary info/AAD encoding, request parsing, and response envelope construction.
- `src/lib/server/client-v1/hpke-bound-v1.test.ts`
  - Recomputes the deterministic vectors and performs all cryptographic negative mutations.
- `src/lib/server/client-v1/hpke-bound-v1-vector.ts`
  - Test/export-only deterministic vector generator using fixed IKM/EKM and the production codec helpers.
- `src/lib/server/client-v1/hpke-bound-v1-vectors.json`
  - Generated deterministic vector bytes; never imported by the proxy/runtime contract graph.
- `src/lib/server/client-v1/hpke-bound-v1-vectors.sha256`
  - SHA-256 of the exact generated vector JSON.
- `src/lib/server/client-v1/authority-replay.ts`
  - In-memory, per-runtime replay reservation with a caller-supplied time snapshot, fixed TTL, and fixed capacity.
- `src/lib/server/client-v1/authority-replay.test.ts`
  - Freshness, duplicate, expiry, 4096-request burst capacity, retry timing, and fail-closed behavior.
- `src/lib/server/client-v1/authority-runtime.ts`
  - Mode dispatch, global boot-key consumption, protected-request wrapper, credential injection into a reconstructed `Request`, pre-auth error normalization, response encryption, and secret-safe diagnostics.
- `src/lib/server/client-v1/authority-runtime.test.ts`
  - Default-off compatibility, active bootstrap-unavailable refusal, absent-versus-present marker handling in both active modes, exact-value and combined-header rejection without callback or secret leakage, atomic replay ordering before secret/bearer stores, concurrent duplicate behavior, and encrypted response semantics.
- `src/lib/server/client-v1/testing/hpke-client.ts`
  - Test-only Base-mode request sender and Auth-mode response opener shared by route tests and the real-socket takeover harness.
  - Never exported from a production package surface.
- `scripts/client-v1-authority-takeover.mjs`
  - Deterministic release-build, real-socket listener replacement proof for plaintext leakage, ciphertext-only bound requests, and response-forgery rejection.
- `scripts/client-v1-authority-takeover.test.mjs`
  - Negative tests for the harness’s capture and acceptance predicates.

### Modify

- `package.json`
  - Pin the two production HPKE dependencies and add `test:client-v1:authority-takeover`.
- `pnpm-lock.yaml`
  - Record exact package resolution and integrity.
- `scripts/dependency-policy.test.mjs`
  - Pin the exact approved HPKE package versions and require them to remain production dependencies.
- `server.ts`
  - Parse the mode at boot, create exactly one runtime keypair only for `advertise`/`enforce`, retain the private key only on `globalThis`, and publish discovery v2 public fields.
  - Do not place the private key, serialized private key, or sender key in `process.env`, discovery, logs, child-process arguments, or files.
- `src/lib/server/client-v1/discovery.ts`
  - Validate a versioned `ClientV1DiscoveryRecordV1 | ClientV1DiscoveryRecordV2` union while keeping v1 behavior.
- `src/lib/server/client-v1/discovery.test.ts`
  - Pin default v1 bytes, opt-in v2, public-only authority metadata, boot rotation, and standalone-server lifecycle.
- `src/lib/server/client-v1/runtime.ts`
  - Add `authority: ClientV1AuthorityRuntime` without making runtime construction asynchronous.
- `src/lib/server/client-v1/runtime.test.ts`
  - Prove the runtime composes one authority object and defaults it to `off`.
- `src/lib/server/client-v1/operations.ts`
  - Add `credential` and `binding` to every internal operation definition in Task 2; expose them through exported fixture records only in Task 7 after handlers are operational.
- `src/lib/server/client-v1/operations.test.ts`
  - Pin the seven protected operations and the four explicit admin exclusions.
- `src/lib/server/client-v1/contract.ts`
  - Export the pure authority contract and discovery-v2 example without importing crypto or the large vector record at runtime.
- `src/lib/server/client-v1/contract.test.ts`
  - Pin the authority manifest, operation metadata, vector-fixture filenames, and edge-safe import boundary.
- `src/lib/server/client-v1/responses.ts`
  - Add fixed pre-decryption authority error helpers, including `clientV1AuthorityUnavailableResponse`, while preserving every existing inner Client v1 response builder.
- `src/app/api/client/v1/pairing/requests/[id]/route.ts`
- `src/app/api/client/v1/pairing/requests/[id]/exchange/route.ts`
- `src/app/api/client/v1/familiars/route.ts`
- `src/app/api/client/v1/projects/route.ts`
- `src/app/api/client/v1/conversations/route.ts`
- `src/app/api/client/v1/conversations/[id]/route.ts`
- `src/app/api/client/v1/conversations/[id]/messages/route.ts`
  - Wrap the existing route body with `runtime.authority.handle({ operation, request, invoke })`; leave the existing loopback, secret/bearer, scope, rate-limit, store, and projection logic inside the callback.
- The seven matching `route.test.ts` files
  - Preserve current default-off expectations and add operation-specific bound-path coverage.
- `src/app/api/api-contracts.test.ts`
  - Require every operation declaring `binding: "hpke-bound-v1"` to call the authority wrapper in executable route source; forbid the wrapper on unprotected/admin operations.
- `scripts/export-client-v1-contract.mjs`
  - Pin reviewed authority metadata and protected operations.
- `scripts/export-client-v1-contract.test.mjs`
  - Assert exact generated authority records, no private-key material, and exact vector-fixture references.
- `scripts/export-client-v1-hpke-vectors.mjs`
  - Generate/check the standalone deterministic HPKE vector JSON and digest.
- `scripts/export-client-v1-hpke-vectors.test.mjs`
  - Pin read-only checking, deterministic consecutive writes, SHA-256, and LF normalization.
- `src/lib/server/client-v1/contract-fixture.json`
  - Generated only.
- `src/lib/server/client-v1/contract-fixture.sha256`
  - Generated only.
- `.gitattributes`
  - Pin LF normalization for the two new vector fixture files.
- `scripts/run-tests.mjs`
  - Wire all new test files into the `api` suite and alias-loader set where required.
- `scripts/check-tests-wired.mjs`
  - No exemption; the existing discovery mechanism must see every new test.
- `scripts/client-v1-conformance.mjs`
  - Add authority mode/context to evidence and an optional takeover leg that delegates to the focused harness.
- `scripts/client-v1-conformance.test.mjs`
  - Pin the new option, assertion IDs, and negative result accounting.
- `scripts/ci-paths.mjs`
- `scripts/ci-paths.test.mjs`
  - Route the new takeover script and tests through the Client v1 CI lane.
- `scripts/client-v1-release-smoke.mjs`
- `scripts/client-v1-release-smoke.test.mjs`
  - Keep the release health contract unchanged and assert the generated producer contract declares `defaultMode: "off"`.
- `scripts/sidecar-runtime-closure.mjs`
- `scripts/sidecar-runtime-closure.test.mjs`
  - Retain and actively import the exact pinned HPKE runtime closure, including transitive `@hpke/common`.
- `scripts/sidecar-runtime-smoke.mjs`
  - Keep one packaged launch default-off with discovery v1, then restart in enforce mode and require discovery v2.
  - The Task 8 takeover harness separately owns hostile listener replacement, request/response secrecy, and its isolated Cave home.
- `docs/api/client-v1.md`
  - Normative wire contract, mode semantics, error handling, operation coverage, and consumer safety rules.
- `docs/workflows/client-v1-conformance.md`
  - Exact build and takeover commands and what a green result proves.
- `scripts/client-v1-doc-contract.test.mjs`
  - Require all authority modes, headers, suite IDs, protected operations, statuses, and limits in the reference.

### Deliberately unchanged

- `src/proxy.ts` and `src/proxy-helpers.ts`
  - Existing direct-loopback classification, public/authenticated path lists, body cap, and content-length rules stay intact. Authority enforcement belongs in the route wrapper because the proxy cannot decrypt or produce an authenticated response.
- `src/lib/server/client-v1/auth.ts`, `read-guard.ts`, `pairing-store.ts`, and `credential-store.ts`
  - They continue receiving the same header values from a reconstructed in-process `Request`; the wrapper must reserve replay before invoking any of them.
- All admin route modules
  - The contract records their exclusion; their sidecar-token authority does not become an SDK bearer authority.

## Normative wire contract

### Suite

```ts
export const CLIENT_V1_HPKE_SUITE = Object.freeze({
  kem: "DHKEM(X25519, HKDF-SHA256)",
  kemId: 0x0020,
  kdf: "HKDF-SHA256",
  kdfId: 0x0001,
  aead: "AES-256-GCM",
  aeadId: 0x0002,
} as const);
```

The generated fixture publishes this exact JSON-safe manifest:

```ts
export type ClientV1AuthorityContract = {
  defaultMode: "off";
  modes: readonly ("off" | "advertise" | "enforce")[];
  mechanism: {
    id: "hpke-bound-v1";
    discoveryVersion: 2;
    suite: typeof CLIENT_V1_HPKE_SUITE;
    requestHeaders: typeof CLIENT_V1_HPKE_HEADERS;
    responseMediaType: typeof CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE;
    requestHpkeMode: "base";
    responseHpkeMode: "auth";
    requestEncoding: "headers-plus-rfc8785-json";
    aadEncoding: "u32be-length-prefixed-v1";
    canonicalRoute: "rfc3986-sorted-query-v1";
    keyIdDerivation: "sha256-domain-separated-public-key-v1";
    requestInfo: "OpenCoven/client-v1/hpke-bound-v1/request";
    responseInfo: "OpenCoven/client-v1/hpke-bound-v1/response";
    limits: typeof CLIENT_V1_HPKE_LIMITS;
    freshness: typeof CLIENT_V1_HPKE_FRESHNESS;
    vectorFixture: {
      fileName: "hpke-bound-v1-vectors.json";
      sha256FileName: "hpke-bound-v1-vectors.sha256";
    };
  };
};

export const CLIENT_V1_AUTHORITY_CONTRACT =
  Object.freeze({
    defaultMode: "off",
    modes: Object.freeze(["off", "advertise", "enforce"]),
    mechanism: Object.freeze({
      id: "hpke-bound-v1",
      discoveryVersion: 2,
      suite: CLIENT_V1_HPKE_SUITE,
      requestHeaders: CLIENT_V1_HPKE_HEADERS,
      responseMediaType: CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
      requestHpkeMode: "base",
      responseHpkeMode: "auth",
      requestEncoding: "headers-plus-rfc8785-json",
      aadEncoding: "u32be-length-prefixed-v1",
      canonicalRoute: "rfc3986-sorted-query-v1",
      keyIdDerivation: "sha256-domain-separated-public-key-v1",
      requestInfo: "OpenCoven/client-v1/hpke-bound-v1/request",
      responseInfo: "OpenCoven/client-v1/hpke-bound-v1/response",
      limits: CLIENT_V1_HPKE_LIMITS,
      freshness: CLIENT_V1_HPKE_FRESHNESS,
      vectorFixture: Object.freeze({
        fileName: "hpke-bound-v1-vectors.json",
        sha256FileName: "hpke-bound-v1-vectors.sha256",
      }),
    }),
  } as const);
```

Construct it only with the approved packages:

```ts
import { Aes256Gcm, CipherSuite, HkdfSha256 } from "@hpke/core";
import { DhkemX25519HkdfSha256 } from "@hpke/dhkem-x25519";

export function createClientV1HpkeSuite(): CipherSuite {
  return new CipherSuite({
    kem: new DhkemX25519HkdfSha256(),
    kdf: new HkdfSha256(),
    aead: new Aes256Gcm(),
  });
}
```

Do not implement X25519, HKDF, AES-GCM, HPKE labeled extract/expand, KEM serialization, Auth mode, or AEAD nonce sequencing manually.

### Discovery v2

The existing filename and owner-only mode remain:

```ts
export const CLIENT_V1_DISCOVERY_CONTRACT = Object.freeze({
  fileName: "client-v1-discovery.json",
  mode: "0600",
  version: 1,
  hpkeBoundVersion: 2,
} as const);
```

Exact v2 shape:

```ts
export interface ClientV1DiscoveryRecordV2 {
  version: 2;
  endpoint: string;
  pid: number;
  nonce: string;
  startedAt: string;
  authority: {
    mechanism: "hpke-bound-v1";
    mode: "advertise" | "enforce";
    keyId: string;
    publicKey: string;
    suite: {
      kemId: 32;
      kdfId: 1;
      aeadId: 2;
    };
  };
}
```

`nonce`, `keyId`, and `publicKey` are unpadded canonical base64url of exactly 32 bytes, so each is exactly 43 ASCII characters. The v2 parser accepts only these top-level and nested fields. It explicitly rejects `privateKey`, `secretKey`, `senderKey`, JWK private members, extra authority keys, padding, noncanonical base64url, and wrong decoded lengths.

The v2 `nonce` is the same 32-byte `runtimeNonce` held by the authority bootstrap. It remains the discovery record’s cleanup token, so shutdown must pass that exact encoded value to the existing nonce-safe removal function.

### Key ID

Derive the 32-byte key ID once at boot:

```text
SHA-256(
  UTF8("OpenCoven/client-v1/hpke-bound-v1/key-id\0")
  || SerializePublicKey(runtimeRecipientPublicKey)
)
```

Publish `base64url(keyIdBytes)`. A new Cave process always generates a new recipient keypair and therefore a new key ID, even when `health.data.instanceId` remains stable across restarts.

### Request headers

```ts
export const CLIENT_V1_HPKE_HEADERS = Object.freeze({
  mechanism: "x-coven-client-v1-authority",
  keyId: "x-coven-client-v1-authority-key-id",
  instanceId: "x-coven-client-v1-authority-instance",
  runtimeNonce: "x-coven-client-v1-authority-runtime-nonce",
  requestNonce: "x-coven-client-v1-authority-request-nonce",
  issuedAt: "x-coven-client-v1-authority-issued-at",
  enc: "x-coven-client-v1-authority-enc",
  ciphertext: "x-coven-client-v1-authority-ciphertext",
} as const);
```

The parsed, non-JSON binding object is:

```ts
export type ClientV1HpkeBinding = {
  method: string;
  route: string;
  bodySha256: Uint8Array;
  instanceId: string;
  runtimeNonce: string;
  runtimeNonceBytes: Uint8Array;
  keyId: string;
  keyIdBytes: Uint8Array;
  requestNonce: string;
  requestNonceBytes: Uint8Array;
  issuedAt: number;
};
```

Wire values:

- `mechanism`: exact ASCII `hpke-bound-v1`.
- `keyId`, `runtimeNonce`, `requestNonce`, and `enc`: canonical unpadded base64url of exactly 32 bytes.
- `instanceId`: canonical unpadded base64url of the UTF-8 bytes of the health `instanceId`; decoded length `1..256` bytes, decoded string non-empty, and re-encoding must match.
- `issuedAt`: decimal epoch milliseconds, `1..16` digits, no sign, no leading zero, parsed with `Number.isSafeInteger`; zero and values above JavaScript’s safe-integer ceiling are rejected.
- `ciphertext`: canonical unpadded base64url; decoded length `16..2048` bytes.

The request body remains the route’s ordinary body. The current seven protected operations all require an empty body, but the AAD format supports later body-bearing operations without exposing the credential. The wrapper reads at most the existing `64 * 1024` byte Client v1 request-body ceiling, hashes the exact bytes, and reconstructs the `Request` before invoking the route.

### Encrypted request plaintext

```ts
export type ClientV1HpkeAuthorization =
  | { kind: "pairing-secret"; value: string }
  | { kind: "bearer"; value: string };

export interface ClientV1HpkeBoundRequestPlaintext {
  version: 1;
  authorization: ClientV1HpkeAuthorization;
  responsePublicKey: string;
}
```

Encode this object as RFC 8785 canonical JSON UTF-8. The receiver parses by property name, rejects unknown or missing keys, rejects a noncanonical byte representation by comparing the received bytes with `canonicalize(parsed)`, and bounds the canonical plaintext to `1024` bytes. `responsePublicKey` is canonical base64url of a fresh per-request 32-byte X25519 public key. Pairing secrets retain the existing exact 43-character parser. Bearers retain the current maximum of 512 characters and are not syntax-normalized.

Credential-kind requirements:

```ts
export const CLIENT_V1_HPKE_OPERATION_CREDENTIAL = Object.freeze({
  "pairing.poll": "pairing-secret",
  "pairing.exchange": "pairing-secret",
  "familiars.list": "bearer",
  "projects.list": "bearer",
  "conversations.list": "bearer",
  "conversations.read": "bearer",
  "messages.list": "bearer",
} as const);
```

### Canonical route

Build the route from the actual request URL, never from caller-supplied JSON:

> **2026-08-27 follow-up to #5044:** the original blanket `%` refusal below was
> not compatible with canonical conversation IDs built with
> `encodeURIComponent`. The normative implementation now lives in
> `canonical-path.ts`; this section supersedes the original code sketch.

1. Use the serialized `URL.pathname`.
2. Require a leading slash and reject empty non-root segments.
3. Split on literal `/` before decoding. Decode each segment exactly once as
   UTF-8, reject malformed input, `.`, `..`, decoded `\`, and decoded `%HH`,
   then re-encode with the exact `encodeURIComponent` literal set and uppercase
   hex. The re-encoded segment must equal the original byte for byte. Preserve
   the original validated pathname, including `%2F` within one segment.
4. Decode query names and values through `URLSearchParams`.
5. Re-encode each name/value with RFC 3986 percent encoding: UTF-8, uppercase hex, spaces as `%20`, and `!'()*` percent-escaped.
6. Sort pairs by encoded name, then encoded value, using ASCII byte order.
7. Join pairs with `&` and name/value with `=`.
8. Return `pathname` when no query exists, otherwise `pathname + "?" + query`.
9. Reject a canonical route longer than 2048 UTF-8 bytes.

```ts
function rfc3986Component(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

const asciiCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export function canonicalClientV1Route(url: URL): string {
  const pathname = canonicalClientV1Pathname(url.pathname);
  const pairs = [...url.searchParams.entries()]
    .map(([name, value]) => [
      rfc3986Component(name),
      rfc3986Component(value),
    ] as const)
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName === rightName
        ? asciiCompare(leftValue, rightValue)
        : asciiCompare(leftName, rightName),
    );
  const query = pairs.map(([name, value]) => `${name}=${value}`).join("&");
  const route = query ? `${pathname}?${query}` : pathname;
  if (new TextEncoder().encode(route).byteLength > 2048) {
    throw new Error("Client v1 authority route is too long.");
  }
  return route;
}
```

Every encoded component is ASCII. Normalize both components to their exact
RFC 3986 wire strings before sorting, compare those encoded strings with
`<`/`>` code-unit order, and render the already-encoded pairs directly without
another encoding pass. Sorting decoded `URLSearchParams` values first is not
equivalent for non-ASCII or percent-escaped punctuation. Tests include those
adversarial cases and refuse a `localeCompare` call in `hpke-bound-v1.ts`.

### Info and AAD

HPKE info is fixed below 64 bytes, far below `@hpke/common@1.10.0`'s reviewed 65,536-byte `INFO_LENGTH_LIMIT`:

```text
request info UTF-8:  OpenCoven/client-v1/hpke-bound-v1/request
response info UTF-8: OpenCoven/client-v1/hpke-bound-v1/response
```

Export the exact bytes for runtime and test-harness reuse:

```ts
const UTF8 = new TextEncoder();

export const CLIENT_V1_HPKE_REQUEST_INFO =
  UTF8.encode("OpenCoven/client-v1/hpke-bound-v1/request");

export const CLIENT_V1_HPKE_RESPONSE_INFO =
  UTF8.encode("OpenCoven/client-v1/hpke-bound-v1/response");
```

AAD is binary and never uses `JSON.stringify`. For each variable field, encode a four-byte unsigned big-endian byte length followed by the field bytes. Encode `issuedAt` as an eight-byte unsigned big-endian integer and then length-prefix those eight bytes like every other field.

Request AAD, in exact order:

```text
UTF8("OpenCoven/client-v1/hpke-bound-v1/aad/request\0")
|| frame(ASCII(uppercase HTTP method))
|| frame(UTF8(canonical route))
|| frame(SHA-256(exact request body bytes))
|| frame(UTF8(decoded instanceId))
|| frame(runtime nonce bytes)
|| frame(key ID bytes)
|| frame(request nonce bytes)
|| frame(uint64be(issuedAt))
```

Response AAD is the same ordered fields with this prefix:

```text
UTF8("OpenCoven/client-v1/hpke-bound-v1/aad/response\0")
```

This binds the request and authenticated response to method, canonical path/query, exact body, stable installation identity, per-runtime discovery nonce, per-runtime key identity, request nonce, and freshness timestamp. Host, port, PID, and timing alone are never authority.

### Request and response HPKE modes

Request:

```ts
const recipient = await suite.createRecipientContext({
  recipientKey: runtimeKeyPair.privateKey,
  enc,
  info: REQUEST_INFO,
});
const plaintext = await recipient.open(ciphertext, requestAad);
```

This is HPKE Base mode. Client authentication comes from the pairing secret or bearer inside the encrypted plaintext, after replay reservation.

Response:

```ts
const responseRecipientPublicKey =
  await suite.kem.deserializePublicKey(responsePublicKeyBytes);
const sender = await suite.createSenderContext({
  recipientPublicKey: responseRecipientPublicKey,
  senderKey: runtimeKeyPair.privateKey,
  info: RESPONSE_INFO,
});
const ciphertext = await sender.seal(responsePlaintext, responseAad);
```

This is RFC 9180 Auth mode. The client opens it with its fresh response private key and the Cave public key from discovery as `senderPublicKey`. Never seal a response with the request context: sender and recipient sequence counters both begin at zero, so using one bidirectionally would reuse the AEAD key/nonce pair.

The per-runtime X25519 keypair is deliberately reused across two HPKE roles: Base-mode recipient for requests and Auth-mode sender authentication for responses. RFC 9180 separates these uses in three independent ways:

1. the HPKE key schedule context includes the mode byte, so request Base mode (`0x00`) and response Auth mode (`0x02`) derive different key schedules;
2. request and response use distinct fixed `info` values and distinct AAD domain prefixes; and
3. every request open and response seal constructs a new one-direction context with a fresh peer ephemeral/response-recipient key, so no AEAD context, sequence number, key, or nonce is reused.

`@hpke/core` exposes the same X25519 `CryptoKeyPair` through `recipientKey` and `senderKey` for these RFC-defined roles; the repository does not serialize the private key or use it in a non-HPKE protocol. Tests must pin the Base/Auth mode and info separation and prove that a replacement Auth sender key is rejected. If a future suite or library release documents role-specific static keys as necessary, introduce separate discovery fields in a new wire version; do not silently reinterpret discovery v2.

### Encrypted response

Inner plaintext:

```ts
export interface ClientV1HpkeBoundResponsePlaintext {
  version: 1;
  requestNonce: string;
  status: number;
  headers: {
    contentType: "application/json";
    retryAfter?: string;
  };
  body: string;
}
```

- `body` is canonical unpadded base64url of the exact inner Client v1 response bytes.
- Only `content-type` and optional `retry-after` cross the wrapper; no cookies, server headers, or arbitrary values are copied.
- Raw inner response streaming is independently capped at 8 MiB to prevent
  memory abuse.
- Encode the inner plaintext as RFC 8785 canonical JSON UTF-8, then require
  those final bytes—including base64url body expansion and reviewed
  headers—to be at most 8 MiB before creating the HPKE sender context.
- AES-256-GCM adds only its fixed 16-byte tag, so bound response ciphertext is
  at most 8,388,624 bytes. The fixed JSON envelope containing canonical
  base64url ciphertext is at most 11,185,056 UTF-8 bytes.

Outer response:

```ts
export interface ClientV1HpkeBoundResponseEnvelope {
  version: 1;
  mechanism: "hpke-bound-v1";
  keyId: string;
  requestNonce: string;
  enc: string;
  ciphertext: string;
}
```

Every successfully opened bound request returns outer HTTP `200` with:

```text
Content-Type: application/vnd.opencoven.client-v1.hpke-bound-v1+json
Cache-Control: no-store
```

The consumer must ignore the outer status for application semantics, authenticate and decrypt the envelope, verify `requestNonce`, then apply the inner status/body. A replacement listener can emit any outer HTTP status or JSON it wants; none is actionable without a valid Auth-mode response from the discovered Cave public key.

The consumer builds response AAD from the stored request binding, not from untrusted outer response fields. It first compares outer `mechanism`, `keyId`, and `requestNonce` to the outstanding request, then uses only outer `enc` and `ciphertext` as HPKE inputs. A forged outer object cannot choose the identity or AAD against which it is verified.

### Freshness and replay

```ts
export const CLIENT_V1_HPKE_FRESHNESS = Object.freeze({
  maximumAgeMs: 60_000,
  maximumFutureSkewMs: 10_000,
  replayTtlMs: 120_000,
  replayCapacity: 4_096,
} as const);
```

Rules:

1. `requestNonce` is 32 bytes from a cryptographically secure random generator.
2. Accept `issuedAt >= now - 60_000` and `issuedAt <= now + 10_000`.
3. The authority runtime captures exactly one `requestNow = now()` snapshot for each marked bound request. It passes that same number to `openClientV1HpkeBoundRequest({ ..., now: requestNow })` for freshness validation and then to `replay.reserve(opened.binding, requestNow)`. The replay cache never reads an independent clock.
4. After successful HPKE open and canonical payload validation, reserve `${keyId}:${requestNonce}` for 120 seconds relative to `requestNow`.
5. In JavaScript there must be no `await`, promise callback, logging hook, async metric, store access, or user callback between the resolved successful open and the synchronous `reserve(...)` call. Canonical payload validation completes inside the open helper before it resolves; the next runtime statement is `replay.reserve(opened.binding, requestNow)`. Run-to-completion therefore lets only one concurrent continuation reserve an identical tuple.
6. Every non-ok reservation result is terminal before pairing-secret parsing, pairing-store lookup/consume, bearer parsing, credential-store lookup, scope checks, authenticated rate-limit charging, a read source, or any existing route callback. `"stale"` is Auth-encrypted as inner `409 conflict` with `details.reason: "authority_request_stale"`; `"replay"` and `"capacity"` use their fixed encrypted responses. No non-ok variant may fall through.
7. A duplicate is rejected even if the first handler returned an error.
8. Purge expired reservations before checking capacity.
9. At 4096 live entries, do not evict a live nonce; return a fail-closed capacity error with `retry-after` equal to `max(1, ceil((earliestExpiry - requestNow) / 1000))`.

The fixed capacity and TTL admit at most `4096 / 120 = 34.133...` successfully opened protected requests per second as a steady-state average in one process. An empty cache may accept a burst of 4096 unique requests at one instant; the 4097th receives an Auth-encrypted inner `503 service_unavailable` with `authority_replay_capacity` and, for a same-instant burst, `retry-after: 120`. The client preserves its credential and cursor, waits at least the authenticated `retry-after`, then seals a new request with a fresh nonce and current `issuedAt`; it never retries the rejected ciphertext/nonce. Paginated readers may retain already accepted pages, but the capacity-rejected page must not reach the bearer store, rate limiter, or read source and is resumed from the same cursor only with the fresh envelope.

### Error and trust matrix

| Condition | Outer HTTP | Client v1 code | `details.reason` | Encrypted? | Consumer action |
|---|---:|---|---|---|---|
| Active `advertise`/`enforce` bootstrap is unavailable | 503 | `service_unavailable` | `authority_unavailable` | no | Preserve credentials; rediscover/back off; never retry plaintext |
| Enforce mode, marker absent | 426 | `incompatible_version` | `hpke_binding_required` | no | Rediscover/upgrade; do not discard credential |
| Mechanism header present with any value other than exact `hpke-bound-v1` | 400 | `invalid_request` | `authority_invalid` | no | Treat as unauthenticated transport failure; never retry plaintext |
| Key ID or runtime nonce is not this boot’s authority tuple | 409 | `conflict` | `authority_key_stale` | no | Rediscover once; do not send plaintext |
| Instance ID is not the Cave installation currently answering | 409 | `conflict` | `authority_instance_stale` | no | Discard endpoint association and rediscover; do not send plaintext |
| Timestamp stale or too far future | 409 | `conflict` | `authority_request_stale` | no | Retry once with a fresh nonce/time |
| Missing field, malformed/noncanonical base64url, wrong length, oversized ciphertext, failed HPKE open, wrong method/path/body/AAD, noncanonical payload, duplicate plaintext credential header | 400 | `invalid_request` | `authority_invalid` | no | Treat as unauthenticated transport failure |
| Replay reservation reports stale after successful open | outer 200 | inner 409 `conflict` | `authority_request_stale` | yes | Retry once with a fresh nonce/time; never invoke a credential/read handler |
| Replay after successful open | outer 200 | inner 409 `conflict` | `authority_replayed` | yes | Do not replay; generate a fresh request nonce |
| Replay map at 4096 live entries | outer 200 | inner 503 `service_unavailable` | `authority_replay_capacity` | yes | Honor authenticated `retry-after`; retry the same logical operation with a fresh nonce/time |
| Existing route success/error after successful open | outer 200 | unchanged inner code/status | unchanged | yes | Apply only after Auth-mode verification |
| Cave cannot Auth-seal the response | 500 | `internal_error` | `authority_response_failed` | no | Treat as unauthenticated transport failure |

All pre-decryption diagnostics use fixed messages and reason enums. Logs may contain the operation ID and one of the fixed reason enums. They must not contain `Authorization`, pairing secret, bearer, request plaintext, response plaintext, request body, ciphertext, encapsulated key, response public key, request nonce, HPKE exception text, or serialized `Request`/`Response`.

## Deterministic RFC 9180 vector

Generate and commit the vector in `src/lib/server/client-v1/hpke-bound-v1-vectors.json`, with the SHA-256 of those exact LF-normalized bytes in the sibling `.sha256` file, and recompute both in `hpke-bound-v1.test.ts`. Those two committed files are the sole SDK/Chat cryptographic handoff source of truth. This prose snapshot is non-normative review evidence only: consumers must never copy vector values from the plan, a PR description, or rendered documentation. The main Client v1 contract fixture declares both filenames but does not embed/import the large vector, preserving the lightweight `contract.ts` → `proxy-helpers.ts` graph. The production path never supplies `ekm`; only the vector generator/test uses the library’s documented test-only deterministic `ekm` seam.

```json
{
  "suite": {
    "kemId": 32,
    "kdfId": 1,
    "aeadId": 2
  },
  "inputs": {
    "recipientIkm": "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    "requestEkmIkm": "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f",
    "responseRecipientIkm": "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f",
    "responseEkmIkm": "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f",
    "runtimeNonce": "gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8",
    "requestNonce": "oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8",
    "issuedAt": 1787672578109,
    "method": "POST",
    "route": "/api/client/v1/pairing/requests/11111111-1111-4111-8111-111111111111/exchange",
    "bodySha256": "47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU",
    "instanceId": "00000000-0000-4000-8000-000000000000",
    "authorization": {
      "kind": "pairing-secret",
      "value": "wMHCw8TFxsfIycrLzM3Oz9DR0tPU1dbX2Nna29zd3t8"
    }
  },
  "authority": {
    "publicKey": "sfG4QN56MkGwJ0jPmwW3TcjF6EUSmHOIF712qo6-jCs",
    "keyId": "Tq04GMSX5BPPPijzO9pHfQ1lAnna_RQKzL1ncDGl-4g",
    "responsePublicKey": "sln27pLcugERhQsTs_bczIJ3JvmwgjWrYpIraz8_Khk"
  },
  "request": {
    "info": "T3BlbkNvdmVuL2NsaWVudC12MS9ocGtlLWJvdW5kLXYxL3JlcXVlc3Q",
    "aad": "T3BlbkNvdmVuL2NsaWVudC12MS9ocGtlLWJvdW5kLXYxL2FhZC9yZXF1ZXN0AAAAAARQT1NUAAAATS9hcGkvY2xpZW50L3YxL3BhaXJpbmcvcmVxdWVzdHMvMTExMTExMTEtMTExMS00MTExLTgxMTEtMTExMTExMTExMTExL2V4Y2hhbmdlAAAAIOOwxEKY_BwUmvv0yJlvuSQnrkHkZJuTTKSVmRt4UrhVAAAAJDAwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMAAAACCAgYKDhIWGh4iJiouMjY6PkJGSk5SVlpeYmZqbnJ2enwAAACBOrTgYxJfkE88-KPM72kd9DWUCedr9FArMvWdwMaX7iAAAACCgoaKjpKWmp6ipqqusra6vsLGys7S1tre4ubq7vL2-vwAAAAgAAAGgOZbIPQ",
    "plaintext": "eyJhdXRob3JpemF0aW9uIjp7ImtpbmQiOiJwYWlyaW5nLXNlY3JldCIsInZhbHVlIjoid01IQ3c4VEZ4c2ZJeWNyTHpNM096OURSMHRQVTFkYlgyTm5hMjl6ZDN0OCJ9LCJyZXNwb25zZVB1YmxpY0tleSI6InNsbjI3cExjdWdFUmhRc1RzX2JjeklKM0p2bXdnaldyWXBJcmF6OF9LaGsiLCJ2ZXJzaW9uIjoxfQ",
    "enc": "aTZYJUYw9zrY2nj7Mxv5ds1C-Q4OnJ6D9AxRBypvdBc",
    "ciphertext": "Hx5Ux_qW9GaFJx2WVTVg-LlhpzWkFjRxKc4MMW56Fcd9_B_4_Cdsku6BtZQFMgN5aUsP7e73wD9jUUvp-dvKE7OiKhizxkTi7TPaTGIBUmXirSjuLc9d2pWnIjiy8VWfHH_FtlORecWPTSGV3tuz_DpFKnO2x0LphpuLkOTIuM0OuQYYQlEMocxTUIef3bmXgc3o8BK5X3av6IL6i1jl3c7zuyGIs3l4WCv2O99I1rzDjJ5dFvL2a41MPvZVSBs"
  },
  "response": {
    "info": "T3BlbkNvdmVuL2NsaWVudC12MS9ocGtlLWJvdW5kLXYxL3Jlc3BvbnNl",
    "aad": "T3BlbkNvdmVuL2NsaWVudC12MS9ocGtlLWJvdW5kLXYxL2FhZC9yZXNwb25zZQAAAAAEUE9TVAAAAE0vYXBpL2NsaWVudC92MS9wYWlyaW5nL3JlcXVlc3RzLzExMTExMTExLTExMTEtNDExMS04MTExLTExMTExMTExMTExMS9leGNoYW5nZQAAACDjsMRCmPwcFJr79MiZb7kkJ65B5GSbk0yklZkbeFK4VQAAACQwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDAAAAAggIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8AAAAgTq04GMSX5BPPPijzO9pHfQ1lAnna_RQKzL1ncDGl-4gAAAAgoKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8AAAAIAAABoDmWyD0",
    "bodyUtf8": "{\"apiVersion\":\"1.0\",\"capabilities\":[\"pairing\"],\"data\":{\"status\":\"ok\"},\"minimumClientVersion\":\"0.1.0\",\"operations\":[\"pairing.exchange\"]}",
    "plaintext": "eyJib2R5IjoiZXlKaGNHbFdaWEp6YVc5dUlqb2lNUzR3SWl3aVkyRndZV0pwYkdsMGFXVnpJanBiSW5CaGFYSnBibWNpWFN3aVpHRjBZU0k2ZXlKemRHRjBkWE1pT2lKdmF5SjlMQ0p0YVc1cGJYVnRRMnhwWlc1MFZtVnljMmx2YmlJNklqQXVNUzR3SWl3aWIzQmxjbUYwYVc5dWN5STZXeUp3WVdseWFXNW5MbVY0WTJoaGJtZGxJbDE5IiwiaGVhZGVycyI6eyJjb250ZW50VHlwZSI6ImFwcGxpY2F0aW9uL2pzb24ifSwicmVxdWVzdE5vbmNlIjoib0tHaW82U2xwcWVvcWFxcnJLMnVyN0N4c3JPMHRiYTN1TG02dTd5OXZyOCIsInN0YXR1cyI6MjAwLCJ2ZXJzaW9uIjoxfQ",
    "enc": "utdi4JhEbLzFizDH6AT4KEe4uREYWZZYKvnye_1Oh18",
    "ciphertext": "ZysTf9BxiJhiLeQYBjRlK1bm3dBmpfB__VvOVTjNn_CpCR670A7svidlcHBvksk9M_4CtN1iAmp7RvM-QVJ9W7OvMPjQJTnTGNbKckxOlX_BabVQJpTJbqa5_AMLXZJw6bD-HXBT3AXgeO9loJn2CLUfIoT4IgyfuvHKCx2GBtAHssSoukf7KQ_GHg6DlChjoJLByWrNp0eI3BjxkzEOOJ5Sa7cV_u3NGJgIyraThjT4x4bfAS6tiWq4oMqA84q5IJgcBrzWOC26Y4-G4koDH8L1ohGvz0v1laLsnRID_Ys9Q-oS0-CTKgbW--TzrOLT9pPEY45mrTKl0YEwfPW47I04PCZ5OLaR6x1yyg0uG-9DALFdMBUXcbaEioEhaKCRWRICE_Dwp9Zs-7_TX-Ngt1g2QEFEJH-bgPyU42fxoGeiAzd9wC-oqpBARiUzZVKGDQk"
  }
}
```

Mutation coverage must flip one input at a time and assert `open` rejects:

- recipient private key;
- request `enc`;
- request ciphertext;
- method;
- canonical path;
- canonical query;
- body digest;
- instance ID;
- runtime nonce;
- key ID;
- request nonce;
- issued-at value;
- response sender public key;
- response `enc`;
- response ciphertext;
- response AAD.

## Reviewed `@hpke/common` 1.10.0 hold-back audit

Audit date: 2026-08-25. The implementation must preserve this exact resolution record in the dependency-policy test comments or the implementation PR:

| Artifact | Reviewed fact |
|---|---|
| `@hpke/core@1.9.0` | Released 2026-03-08; declares `@hpke/common: ^1.10.0`; npm integrity `sha512-pFxWl1nNJeQCSUFs7+GAblHvXBCjn9EPN65vdKlYQil2aURaRxfGMO6vBKGqm1YHTKwiAxJQNEI70PbSowMP9Q==` |
| `@hpke/dhkem-x25519@1.8.0` | Released 2026-03-08; declares `@hpke/common: ^1.10.0`; npm integrity `sha512-S1MWWkAfu+TFxySgv5+2P3O4Mx/jk7BsoplzQaA1s3sfUJVJ2UsZsSzSsMc+FXJumLXncoJFlO6mK6mDGspfmA==` |
| selected `@hpke/common@1.10.0` | Released 2026-03-08 from hpke-js release commit `f9fbe3d5a6404f516df859e472c078c0d08e8057`; npm integrity `sha512-uVq9pTNERQ1GcFlHZzQx+a0ZMC81wQzkbNzJPEyR/l3AWM7fASd/qYN2Cnq6uL1NPEfwcD4lgOmfjjZfx2k2XA==`; MIT; Node `>=16.0.0` |
| held-back `@hpke/common@1.10.1` | Released 2026-03-12 at tag commit `d56a674fd9c63e2c8176a6e2d68150707158926c`; npm integrity `sha512-moJwhmtLtuxiUzzNp1jpfBfx8yefKoO9D/RCR9dmwrnc7qjJqId1rEtQz+lSlU5cabX8daToMSx/7HayXOiaFw==` |

The reviewed `1.10.0...1.10.1` comparison contains only the changelog/version bump, tests, and PR `#732` changing `INFO_LENGTH_LIMIT` from `65_536` to `268_435_456`; it does not change X25519, HKDF, AEAD, Base/Auth mode, or context construction. Client v1 request/response `info` values are fixed ASCII constants below 64 bytes, so the relaxation is not required for this protocol. Hold `@hpke/common` at `1.10.0` to prevent the two caret ranges from silently changing reviewed cryptographic transitive code.

Resolution rule: a future upgrade must be an explicit dependency-review change that names the old/new npm integrities and upstream commits, reviews the full diff, updates the override/policy/lockfile together, regenerates the committed vector JSON and SHA, and runs the HPKE mutation tests, authority concurrency tests, build, sidecar closure, takeover proof, and production audit. If committed vector bytes or negative-test behavior change, stop the upgrade and require a protocol/security review rather than treating it as routine patch drift.

## Task 1: Pin and audit the HPKE dependencies

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `scripts/dependency-policy.test.mjs`

- [ ] **Step 1: Write the failing dependency-policy assertions**

Add:

```js
assert.equal(
  packageJson.dependencies?.["@hpke/core"],
  "1.9.0",
  "@hpke/core must remain an exact production dependency",
);
assert.equal(
  packageJson.dependencies?.["@hpke/dhkem-x25519"],
  "1.8.0",
  "@hpke/dhkem-x25519 must remain an exact production dependency",
);
assert.equal(
  packageJson.devDependencies?.["@hpke/core"],
  undefined,
  "@hpke/core is used by the release server and must not be dev-only",
);
assert.equal(
  packageJson.devDependencies?.["@hpke/dhkem-x25519"],
  undefined,
  "@hpke/dhkem-x25519 is used by the release server and must not be dev-only",
);
assert.equal(
  packageJson.pnpm?.overrides?.["@hpke/common"],
  "1.10.0",
  "the shared HPKE implementation must remain locked to the reviewed version",
);
```

- [ ] **Step 2: Run the policy test and verify it fails**

Run:

```bash
node --test scripts/dependency-policy.test.mjs
```

Expected: FAIL because both `packageJson.dependencies` entries are `undefined`.

- [ ] **Step 3: Add exact production dependencies**

Run:

```bash
pnpm add --save-exact @hpke/core@1.9.0 @hpke/dhkem-x25519@1.8.0
```

Then add this exact override beside the existing overrides in `package.json`:

```json
"@hpke/common": "1.10.0"
```

Run:

```bash
pnpm install --lockfile-only
```

Expected: `package.json` contains exact direct versions and the exact common override; `pnpm-lock.yaml` records integrity for `@hpke/core@1.9.0`, `@hpke/dhkem-x25519@1.8.0`, and `@hpke/common@1.10.0`.

- [ ] **Step 4: Audit package metadata and resolved graph**

Run:

```bash
pnpm view @hpke/core@1.9.0 license engines repository dist.integrity --json
pnpm view @hpke/dhkem-x25519@1.8.0 license engines repository dist.integrity --json
pnpm view @hpke/common@1.10.0 license engines repository dist.integrity --json
pnpm view @hpke/common@1.10.1 license engines repository dist.integrity --json
pnpm why @hpke/core @hpke/dhkem-x25519 @hpke/common
pnpm audit --prod
```

Expected:

- both direct packages report MIT;
- both support Node `>=16.0.0`, covering the repository’s Node 24 release engine;
- both resolve from `github.com/dajiaji/hpke-js`;
- the direct versions are exactly `1.9.0` and `1.8.0`;
- `@hpke/common` resolves exactly to overridden `1.10.0`, not caret-selected `1.10.1`;
- all four npm integrity strings match the reviewed hold-back table above;
- the implementation PR records that upstream `1.10.1` only relaxes `INFO_LENGTH_LIMIT` from `65_536` to `268_435_456`, which is irrelevant to the fixed sub-64-byte Client v1 `info` values;
- `pnpm audit --prod` reports no unresolved advisory affecting the selected packages. If the repository has an unrelated existing advisory, record its package/advisory ID in the implementation PR and prove neither new package introduces it.

- [ ] **Step 5: Run dependency policy**

Run:

```bash
node --test scripts/dependency-policy.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml scripts/dependency-policy.test.mjs
git commit \
  -m "build(client-v1): pin HPKE dependencies" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 2: Freeze the pure authority contract and internal operation inventory

**Files:**
- Create: `src/lib/server/client-v1/authority-contract.ts`
- Create: `src/lib/server/client-v1/authority-contract.test.ts`
- Modify: `src/lib/server/client-v1/operations.ts`
- Modify: `src/lib/server/client-v1/operations.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing pure-contract tests**

The test must pin:

```ts
assert.equal(CLIENT_V1_HPKE_MECHANISM, "hpke-bound-v1");
assert.deepEqual(CLIENT_V1_HPKE_AUTHORITY_MODES, [
  "off",
  "advertise",
  "enforce",
]);
assert.deepEqual(CLIENT_V1_HPKE_SUITE, {
  kem: "DHKEM(X25519, HKDF-SHA256)",
  kemId: 32,
  kdf: "HKDF-SHA256",
  kdfId: 1,
  aead: "AES-256-GCM",
  aeadId: 2,
});
assert.deepEqual(CLIENT_V1_HPKE_HEADERS, {
  mechanism: "x-coven-client-v1-authority",
  keyId: "x-coven-client-v1-authority-key-id",
  instanceId: "x-coven-client-v1-authority-instance",
  runtimeNonce: "x-coven-client-v1-authority-runtime-nonce",
  requestNonce: "x-coven-client-v1-authority-request-nonce",
  issuedAt: "x-coven-client-v1-authority-issued-at",
  enc: "x-coven-client-v1-authority-enc",
  ciphertext: "x-coven-client-v1-authority-ciphertext",
});
assert.equal(
  CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
  "application/vnd.opencoven.client-v1.hpke-bound-v1+json",
);
assert.deepEqual(CLIENT_V1_HPKE_LIMITS, {
  rawKeyBytes: 32,
  encodedKeyCharacters: 43,
  requestPlaintextBytes: 1024,
  requestCiphertextBytes: 2048,
  requestBodyBytes: 65536,
  responsePlaintextBytes: 8 * 1024 * 1024,
  responseCiphertextBytes: 8_388_624,
  responseEnvelopeBytes: 11_185_056,
  canonicalRouteBytes: 2048,
  instanceIdBytes: 256,
});
assert.deepEqual(CLIENT_V1_HPKE_FRESHNESS, {
  maximumAgeMs: 60_000,
  maximumFutureSkewMs: 10_000,
  replayTtlMs: 120_000,
  replayCapacity: 4_096,
});
```

Also read `authority-contract.ts` as source and assert it contains no `@hpke`, `node:`, `Buffer`, `CryptoKey`, private-key field name, or runtime side effect.
Parse its module declarations and reject every runtime import, side-effect
import, dynamic import, import-equals declaration, and export-from declaration.
Permit only the exact `import type` form. Add mutation strings proving at least
these forms are rejected:

```ts
import "./runtime.ts";
import { x } from "./runtime.ts";
export { x } from "./runtime.ts";
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/authority-contract.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `authority-contract.ts`.

- [ ] **Step 3: Add exact pure types and constants**

Create `authority-contract.ts` with the constants and wire types from the normative section, plus:

```ts
export const CLIENT_V1_HPKE_MECHANISM = "hpke-bound-v1";

export const CLIENT_V1_HPKE_AUTHORITY_MODES = Object.freeze([
  "off",
  "advertise",
  "enforce",
] as const);

export type ClientV1AuthorityMode =
  (typeof CLIENT_V1_HPKE_AUTHORITY_MODES)[number];

export type ClientV1OperationCredential =
  | "none"
  | "pairing-secret"
  | "bearer"
  | "admin";

export type ClientV1OperationBinding = "none" | "hpke-bound-v1";

export const CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE =
  "application/vnd.opencoven.client-v1.hpke-bound-v1+json";
```

Freeze every exported object/array.

- [ ] **Step 4: Add operation metadata tests**

Assert the exact map:

```ts
assert.deepEqual(
  Object.fromEntries(
    CLIENT_V1_OPERATION_DEFINITIONS.map((operation) => [
      operation.id,
      {
        credential: operation.credential,
        binding: operation.binding,
      },
    ]),
  ),
  {
    "health.read": { credential: "none", binding: "none" },
    "pairing.create": { credential: "none", binding: "none" },
    "pairing.poll": {
      credential: "pairing-secret",
      binding: "hpke-bound-v1",
    },
    "pairing.exchange": {
      credential: "pairing-secret",
      binding: "hpke-bound-v1",
    },
    "pairing.admin.list": { credential: "admin", binding: "none" },
    "pairing.admin.decide": { credential: "admin", binding: "none" },
    "credentials.admin.list": { credential: "admin", binding: "none" },
    "credentials.admin.revoke": { credential: "admin", binding: "none" },
    "familiars.list": { credential: "bearer", binding: "hpke-bound-v1" },
    "projects.list": { credential: "bearer", binding: "hpke-bound-v1" },
    "conversations.list": {
      credential: "bearer",
      binding: "hpke-bound-v1",
    },
    "conversations.read": {
      credential: "bearer",
      binding: "hpke-bound-v1",
    },
    "messages.list": { credential: "bearer", binding: "hpke-bound-v1" },
  },
);
```

Assert every `binding: "hpke-bound-v1"` operation has credential `pairing-secret` or `bearer`, every `admin` operation has `binding: "none"`, and health/pairing-create carry no credential.

- [ ] **Step 5: Run operation tests and verify they fail**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/operations.test.ts
```

Expected: FAIL because the internal operation definitions do not yet have
`credential` or `binding`.

- [ ] **Step 6: Extend only the internal operation definition**

Add:

```ts
export type ClientV1OperationDefinition = {
  id: ClientV1Operation;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  ingress: ClientV1OperationIngress;
  scope: ClientV1Scope | null;
  families: readonly ClientV1Capability[];
  credential: ClientV1OperationCredential;
  binding: ClientV1OperationBinding;
};
```

Populate all thirteen definitions exactly as pinned above. Do **not** extend
`clientV1OperationRecords()` yet. `credential` and `binding`
remain internal metadata on `CLIENT_V1_OPERATION_DEFINITIONS` for runtime
routing and enforcement tests. Add explicit assertions that every record
returned by `clientV1OperationRecords()` omits both fields. Do not modify
`ClientV1OperationManifestEntry`, the generated contract fixture, its digest,
the exporter, or public docs in this task. Existing generated contract bytes
must remain unchanged until Task 7.

- [ ] **Step 7: Wire and run the tests**

Append `authority-contract.test.ts` next to the other Client v1 server tests in `scripts/run-tests.mjs`. No new alias-loader entry is needed because the new pure test uses relative imports.

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/authority-contract.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/operations.test.ts
node scripts/export-client-v1-contract.mjs --check
```

Expected: PASS. The fixture check must pass without regeneration.

- [ ] **Step 8: Commit**

```bash
git add \
  src/lib/server/client-v1/authority-contract.ts \
  src/lib/server/client-v1/authority-contract.test.ts \
  src/lib/server/client-v1/operations.ts \
  src/lib/server/client-v1/operations.test.ts \
  scripts/run-tests.mjs
git commit \
  -m "feat(client-v1): define HPKE authority contract" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 3: Implement RFC 9180 codecs and deterministic vectors

**Files:**
- Create: `src/lib/server/client-v1/hpke-bound-v1.ts`
- Create: `src/lib/server/client-v1/hpke-bound-v1.test.ts`
- Create: `src/lib/server/client-v1/hpke-bound-v1-vector.ts`
- Create: `src/lib/server/client-v1/hpke-bound-v1-vectors.json`
- Create: `src/lib/server/client-v1/hpke-bound-v1-vectors.sha256`
- Create: `src/lib/server/client-v1/testing/hpke-client.ts`
- Create: `scripts/export-client-v1-hpke-vectors.mjs`
- Create: `scripts/export-client-v1-hpke-vectors.test.mjs`
- Modify: `src/lib/server/client-v1/authority-contract.ts`
- Modify: `src/lib/server/client-v1/authority-contract.test.ts`
- Modify: `.gitattributes`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the vector and encoding tests first**

Cover:

```ts
assert.equal(base64UrlEncode(Uint8Array.from([0xfb, 0xff])), "-_8");
assert.deepEqual(base64UrlDecode("-_8", { minimum: 2, maximum: 2 }), {
  bytes: Uint8Array.from([0xfb, 0xff]),
  encoded: "-_8",
});
assert.throws(() => base64UrlDecode("-_8=", { minimum: 2, maximum: 2 }));
assert.throws(() => base64UrlDecode("+/8", { minimum: 2, maximum: 2 }));
assert.throws(() => base64UrlDecode("-_9", { minimum: 2, maximum: 2 }));

assert.equal(
  canonicalClientV1Route(
    new URL(
      "http://127.0.0.1:3020/api/client/v1/projects?limit=2&cursor=a%20b",
    ),
  ),
  "/api/client/v1/projects?cursor=a%20b&limit=2",
);
assert.equal(
  canonicalClientV1Route(
    new URL(
      "http://127.0.0.1:3020/api/client/v1/projects?z=%21&a=hello+world",
    ),
  ),
  "/api/client/v1/projects?a=hello%20world&z=%21",
);
assert.equal(
  canonicalClientV1Route(
    new URL(
      "http://127.0.0.1:3020/projects"
      + "?z=plain&%C3%A9=unicode&%5B=bracket"
      + "&dup=z&dup=%C3%A9&dup=space+value&dup=%21&dup=~"
      + "&space+name=a+b&punct%21=%28%29",
    ),
  ),
  "/projects"
    + "?%5B=bracket&%C3%A9=unicode"
    + "&dup=%21&dup=%C3%A9&dup=space%20value&dup=z&dup=~"
    + "&punct%21=%28%29&space%20name=a%20b&z=plain",
);
```

The adversarial case must fail any decoded-first implementation. Read the
source and assert no `localeCompare`, manual X25519 arithmetic, manual HKDF,
manual AES, or direct AEAD nonce construction exists.

- [ ] **Step 2: Run and verify the new test fails**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/hpke-bound-v1.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement strict base64url and binary framing**

Use:

```ts
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/u;

export function base64UrlEncode(value: ArrayBufferLike | ArrayBufferView): string {
  const bytes = value instanceof Uint8Array
    ? value
    : ArrayBuffer.isView(value)
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : new Uint8Array(value);
  return Buffer.from(bytes).toString("base64url");
}

export function base64UrlDecode(
  value: unknown,
  bounds: { minimum: number; maximum: number },
): { bytes: Uint8Array; encoded: string } {
  if (
    typeof value !== "string"
    || !BASE64URL_RE.test(value)
    || value.includes("=")
  ) {
    throw new Error("Client v1 authority value is not canonical base64url.");
  }
  const bytes = Uint8Array.from(Buffer.from(value, "base64url"));
  if (
    bytes.byteLength < bounds.minimum
    || bytes.byteLength > bounds.maximum
    || base64UrlEncode(bytes) !== value
  ) {
    throw new Error("Client v1 authority value has an invalid length or encoding.");
  }
  return { bytes, encoded: value };
}
```

Implement `uint32be`, `uint64be`, `frame`, `concatBytes`, `canonicalClientV1Route`, `encodeClientV1HpkeAad`, and the two fixed info byte arrays exactly as specified above.

- [ ] **Step 4: Implement suite, key serialization, and key ID**

Add:

```ts
export async function clientV1HpkePublicKey(
  suite: CipherSuite,
  key: CryptoKey,
): Promise<Uint8Array> {
  return new Uint8Array(await suite.kem.serializePublicKey(key));
}

export function clientV1HpkeKeyId(publicKey: Uint8Array): Uint8Array {
  return new Uint8Array(
    createHash("sha256")
      .update("OpenCoven/client-v1/hpke-bound-v1/key-id\0", "utf8")
      .update(publicKey)
      .digest(),
  );
}
```

Node’s reviewed `createHash` is used only for the protocol’s SHA-256 digest and key ID; no hash primitive is implemented here.

- [ ] **Step 5: Implement canonical request parsing and Base-mode open**

Add an exported result that never returns the credential in an error:

```ts
export type OpenedClientV1HpkeRequest = {
  authorization: ClientV1HpkeAuthorization;
  responsePublicKeyBytes: Uint8Array;
  binding: ClientV1HpkeBinding;
};

export type ClientV1HpkeBoundRequestErrorKind =
  | "stale-key"
  | "stale-instance"
  | "stale-request"
  | "invalid";

export class ClientV1HpkeBoundRequestError extends Error {
  readonly name = "ClientV1HpkeBoundRequestError";

  constructor(readonly kind: ClientV1HpkeBoundRequestErrorKind) {
    super("Client v1 HPKE bound request rejected.");
  }
}

export async function openClientV1HpkeBoundRequest(input: {
  suite: CipherSuite;
  recipientKey: CryptoKey;
  request: Request;
  body: Uint8Array;
  expectedKeyId: Uint8Array;
  expectedRuntimeNonce: Uint8Array;
  expectedInstanceId: string;
  now: number;
}): Promise<OpenedClientV1HpkeRequest>;
```

The function must reject only with `ClientV1HpkeBoundRequestError`; raw parser, hash, URL, HPKE, UTF-8, JSON, or canonicalization errors never escape. Its numbered contract is:

1. parse and bound every required header; missing, duplicate, malformed, noncanonical, or out-of-bounds values throw kind `"invalid"`;
2. decode `keyId` as exactly 32 bytes, compare it with `expectedKeyId` using `timingSafeEqual`, and throw `"stale-key"` for a well-formed mismatch;
3. decode `runtimeNonce` as exactly 32 bytes, compare it with `expectedRuntimeNonce` using `timingSafeEqual`, and throw `"stale-key"` for a well-formed mismatch;
4. decode `instanceId` from canonical base64url, enforce `1..256` bytes, UTF-8 decode with `{ fatal: true }`, require a non-empty string and exact re-encoding, compare it with `expectedInstanceId`, and throw `"stale-instance"` for a well-formed mismatch;
5. parse `issuedAt` from its strict decimal wire form, require a positive safe integer, and throw `"invalid"` for syntax/range failure;
6. validate `issuedAt >= input.now - 60_000` and `issuedAt <= input.now + 10_000` inclusively, using only the supplied snapshot, and throw `"stale-request"` when it is outside that window;
7. decode and length-check the 32-byte `requestNonce`, 32-byte `enc`, and `16..2048`-byte ciphertext, mapping malformed values to `"invalid"`;
8. calculate the canonical route and exact body SHA-256;
9. create the request recipient context with the boot private key;
10. open with request AAD, mapping HPKE failure to `"invalid"`;
11. enforce the 1024-byte plaintext limit;
12. UTF-8 decode with `{ fatal: true }` and JSON parse;
13. require exact keys `authorization`, `responsePublicKey`, `version`;
14. require exact nested authorization keys;
15. compare received UTF-8 bytes to `canonicalize(parsed)`;
16. decode and length-check the 32-byte response public key without deserializing it yet;
17. return the parsed values without logging them.

The runtime maps `"stale-key"` to `clientV1AuthorityStaleKeyResponse()`, `"stale-instance"` to `clientV1AuthorityStaleInstanceResponse()`, `"stale-request"` to `clientV1AuthorityStaleRequestResponse()`, and `"invalid"` to `clientV1AuthorityInvalidResponse()`. These open failures occur before the response public key is authenticated, so these mapped responses remain plaintext.

After the one cryptographic await, keep the remainder synchronous:

```ts
const plaintext = await recipient.open(ciphertext, requestAad);
const opened = validateOpenedClientV1HpkePlaintext({
  plaintext: new Uint8Array(plaintext),
  binding,
});
return opened;
```

`validateOpenedClientV1HpkePlaintext` performs bounds, UTF-8, JSON, exact-key, canonical-byte, authorization, and response-public-key byte validation without `await`. The caller’s first statement after this function resolves is the synchronous replay reservation shown in Task 4. Only after that reservation may the runtime await `suite.kem.deserializePublicKey(opened.responsePublicKeyBytes)`.

```ts
function validateOpenedClientV1HpkePlaintext(input: {
  plaintext: Uint8Array;
  binding: ClientV1HpkeBinding;
}): OpenedClientV1HpkeRequest;
```

- [ ] **Step 6: Implement Auth-mode response seal**

Accept the inner `Response`, stream at most 8 MiB of raw body bytes, retain only
`content-type` and optional `retry-after`, and build the canonical response
plaintext. Reject before `createSenderContext` or `seal` unless the final
canonical UTF-8 bytes are at most `responsePlaintextBytes`; the limit applies
after JCS, base64url, and header expansion, not to the raw body alone. Add an
exact 8 MiB final-plaintext case and a case whose raw body is one byte larger
and produces an 8 MiB + 1 canonical plaintext.

```ts
export async function sealClientV1HpkeBoundResponse(input: {
  suite: CipherSuite;
  senderKey: CryptoKey;
  responsePublicKey: CryptoKey;
  binding: ClientV1HpkeBinding;
  response: Response;
}): Promise<Response>;
```

Return:

```ts
return Response.json(
  {
    version: 1,
    mechanism: CLIENT_V1_HPKE_MECHANISM,
    keyId: binding.keyId,
    requestNonce: binding.requestNonce,
    enc: base64UrlEncode(sender.enc),
    ciphertext: base64UrlEncode(ciphertext),
  } satisfies ClientV1HpkeBoundResponseEnvelope,
  {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
    },
  },
);
```

- [ ] **Step 7: Implement the vector generator and exporter**

Create `hpke-bound-v1-vector.ts` with:

```ts
import { createHash } from "node:crypto";

import canonicalize from "canonicalize";

import {
  CLIENT_V1_HPKE_REQUEST_INFO,
  CLIENT_V1_HPKE_RESPONSE_INFO,
  base64UrlEncode,
  clientV1HpkeKeyId,
  clientV1HpkePublicKey,
  createClientV1HpkeSuite,
  encodeClientV1HpkeAad,
  type ClientV1HpkeBinding,
} from "./hpke-bound-v1.ts";

const UTF8 = new TextEncoder();

function hexToBytes(value: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/u.test(value)) {
    throw new Error("HPKE vector hex is malformed.");
  }
  return Uint8Array.from(
    value.match(/[0-9a-f]{2}/gu)!.map((pair) => Number.parseInt(pair, 16)),
  );
}

function bytesToHex(value: Uint8Array): string {
  return [...value]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function jcs(value: unknown): string {
  const rendered = canonicalize(value);
  if (typeof rendered !== "string") {
    throw new Error("HPKE vector value is not canonical JSON.");
  }
  return rendered;
}

export async function createClientV1HpkeBoundV1Vector() {
  const recipientIkm = hexToBytes(
    "000102030405060708090a0b0c0d0e0f" +
      "101112131415161718191a1b1c1d1e1f",
  );
  const requestEkmIkm = hexToBytes(
    "202122232425262728292a2b2c2d2e2f" +
      "303132333435363738393a3b3c3d3e3f",
  );
  const responseRecipientIkm = hexToBytes(
    "404142434445464748494a4b4c4d4e4f" +
      "505152535455565758595a5b5c5d5e5f",
  );
  const responseEkmIkm = hexToBytes(
    "606162636465666768696a6b6c6d6e6f" +
      "707172737475767778797a7b7c7d7e7f",
  );
  const runtimeNonceBytes = hexToBytes(
    "808182838485868788898a8b8c8d8e8f" +
      "909192939495969798999a9b9c9d9e9f",
  );
  const requestNonceBytes = hexToBytes(
    "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf" +
      "b0b1b2b3b4b5b6b7b8b9babbbcbdbebf",
  );
  const pairingSecretBytes = hexToBytes(
    "c0c1c2c3c4c5c6c7c8c9cacbcccdcecf" +
      "d0d1d2d3d4d5d6d7d8d9dadbdcdddedf",
  );

  const suite = createClientV1HpkeSuite();
  const recipient = await suite.kem.deriveKeyPair(recipientIkm);
  const publicKey = await clientV1HpkePublicKey(
    suite,
    recipient.publicKey,
  );
  const keyIdBytes = clientV1HpkeKeyId(publicKey);
  const responseRecipient = await suite.kem.deriveKeyPair(
    responseRecipientIkm,
  );
  const responsePublicKey = await clientV1HpkePublicKey(
    suite,
    responseRecipient.publicKey,
  );
  const bodySha256 = new Uint8Array(
    createHash("sha256").update(new Uint8Array()).digest(),
  );
  const binding: ClientV1HpkeBinding = {
    method: "POST",
    route:
      "/api/client/v1/pairing/requests/" +
      "11111111-1111-4111-8111-111111111111/exchange",
    bodySha256,
    instanceId: "00000000-0000-4000-8000-000000000000",
    runtimeNonce: base64UrlEncode(runtimeNonceBytes),
    runtimeNonceBytes,
    keyId: base64UrlEncode(keyIdBytes),
    keyIdBytes,
    requestNonce: base64UrlEncode(requestNonceBytes),
    requestNonceBytes,
    issuedAt: 1_787_672_578_109,
  };
  const requestAad = encodeClientV1HpkeAad("request", binding);
  const responseAad = encodeClientV1HpkeAad("response", binding);
  const authorization = {
    kind: "pairing-secret" as const,
    value: base64UrlEncode(pairingSecretBytes),
  };
  const requestPlaintext = UTF8.encode(jcs({
    authorization,
    responsePublicKey: base64UrlEncode(responsePublicKey),
    version: 1,
  }));
  const requestSender = await suite.createSenderContext({
    recipientPublicKey: recipient.publicKey,
    info: CLIENT_V1_HPKE_REQUEST_INFO,
    ekm: requestEkmIkm,
  });
  const requestCiphertext = new Uint8Array(
    await requestSender.seal(requestPlaintext, requestAad),
  );

  const responseBody = jcs({
    apiVersion: "1.0",
    capabilities: ["pairing"],
    data: { status: "ok" },
    minimumClientVersion: "0.1.0",
    operations: ["pairing.exchange"],
  });
  const responsePlaintext = UTF8.encode(jcs({
    body: base64UrlEncode(UTF8.encode(responseBody)),
    headers: { contentType: "application/json" },
    requestNonce: binding.requestNonce,
    status: 200,
    version: 1,
  }));
  const responseSender = await suite.createSenderContext({
    recipientPublicKey: responseRecipient.publicKey,
    senderKey: recipient.privateKey,
    info: CLIENT_V1_HPKE_RESPONSE_INFO,
    ekm: responseEkmIkm,
  });
  const responseCiphertext = new Uint8Array(
    await responseSender.seal(responsePlaintext, responseAad),
  );

  return {
    suite: { kemId: 32, kdfId: 1, aeadId: 2 },
    inputs: {
      recipientIkm: bytesToHex(recipientIkm),
      requestEkmIkm: bytesToHex(requestEkmIkm),
      responseRecipientIkm: bytesToHex(responseRecipientIkm),
      responseEkmIkm: bytesToHex(responseEkmIkm),
      runtimeNonce: binding.runtimeNonce,
      requestNonce: binding.requestNonce,
      issuedAt: binding.issuedAt,
      method: binding.method,
      route: binding.route,
      bodySha256: base64UrlEncode(bodySha256),
      instanceId: binding.instanceId,
      authorization,
    },
    authority: {
      publicKey: base64UrlEncode(publicKey),
      keyId: binding.keyId,
      responsePublicKey: base64UrlEncode(responsePublicKey),
    },
    request: {
      info: base64UrlEncode(CLIENT_V1_HPKE_REQUEST_INFO),
      aad: base64UrlEncode(requestAad),
      plaintext: base64UrlEncode(requestPlaintext),
      enc: base64UrlEncode(requestSender.enc),
      ciphertext: base64UrlEncode(requestCiphertext),
    },
    response: {
      info: base64UrlEncode(CLIENT_V1_HPKE_RESPONSE_INFO),
      aad: base64UrlEncode(responseAad),
      bodyUtf8: responseBody,
      plaintext: base64UrlEncode(responsePlaintext),
      enc: base64UrlEncode(responseSender.enc),
      ciphertext: base64UrlEncode(responseCiphertext),
    },
  };
}
```

Create `scripts/export-client-v1-hpke-vectors.mjs` with the same atomic check/write and SHA-256 behavior as `export-client-v1-contract.mjs`, targeting:

```js
export const CLIENT_V1_HPKE_VECTOR_PATH = path.join(
  repositoryRoot,
  "src",
  "lib",
  "server",
  "client-v1",
  "hpke-bound-v1-vectors.json",
);
export const CLIENT_V1_HPKE_VECTOR_SHA256_PATH = path.join(
  repositoryRoot,
  "src",
  "lib",
  "server",
  "client-v1",
  "hpke-bound-v1-vectors.sha256",
);
```

Render sorted, two-space-indented JSON with one trailing LF. Add both exact LF rules to `.gitattributes`.

- [ ] **Step 8: Generate, recompute, and compare the vector**

Run:

```bash
node scripts/export-client-v1-hpke-vectors.mjs
node scripts/export-client-v1-hpke-vectors.mjs --check
```

In `hpke-bound-v1.test.ts`, read the committed JSON bytes, verify their LF normalization, call `createClientV1HpkeBoundV1Vector()`, render it with the exporter’s exact formatting, and assert byte equality. Recompute SHA-256 from those committed bytes and compare it to the trimmed sibling `.sha256` file. Use `suite.kem.deriveKeyPair()` for the fixed IKMs and fixed `ekm` only inside the generator. Assert exact public key, key ID, response public key, info, AAD, plaintext, `enc`, ciphertext, and successful opens. No test reads vector values from this plan; the committed JSON/SHA pair is normative.

- [ ] **Step 9: Add negative mutations**

For every mutation listed under “Deterministic RFC 9180 vector,” clone only that byte/string input, flip one bit or substitute one value, and assert `OpenError`, `DecapError`, `DeserializeError`, or the module’s fixed invalid-authority error. Add explicit tests that:

- a replacement X25519 key cannot open the request;
- a response Auth-encrypted by a replacement key cannot be opened when `senderPublicKey` is the discovered Cave key;
- the request context is never reused for the response;
- the request uses Base mode without `senderKey`, the response uses Auth mode with `senderKey`, and the request/response `info` bytes and AAD prefixes differ;
- the same runtime private `CryptoKey` can complete the reviewed Base-recipient/Auth-sender round trip only through separate newly created contexts;
- noncanonical JCS and duplicate JSON keys are refused;
- 2049-byte request ciphertext is refused before HPKE;
- malformed/oversized inputs never appear in thrown messages.

Also assert the typed open-error contract directly:

- a well-formed wrong key ID and a well-formed wrong runtime nonce each throw `ClientV1HpkeBoundRequestError` with kind `"stale-key"`;
- a well-formed wrong instance ID throws kind `"stale-instance"`;
- `issuedAt === now - 60_000` and `issuedAt === now + 10_000` are accepted, while one millisecond outside either boundary throws kind `"stale-request"`;
- malformed key ID, runtime nonce, instance ID, issued-at, request nonce, encapsulated key, ciphertext, route, HPKE input, or canonical plaintext throws kind `"invalid"`;
- no underlying exception text or input value appears in the fixed error message.

- [ ] **Step 10: Add the test-only client codec**

Create `src/lib/server/client-v1/testing/hpke-client.ts` with:

```ts
export type ClientV1HpkeTestClient = {
  request: Request;
  binding: ClientV1HpkeBinding;
  requestAad: Uint8Array;
  responseAad: Uint8Array;
  open(response: Response): Promise<{
    status: number;
    headers: {
      contentType: string;
      retryAfter?: string;
    };
    body: Uint8Array;
  }>;
  responsePublicKey: Uint8Array;
};

export async function createClientV1HpkeTestClient(input: {
  authority: ClientV1DiscoveryRecordV2["authority"];
  instanceId: string;
  runtimeNonce: string;
  operation: ClientV1Operation;
  url: string;
  method: string;
  body?: Uint8Array;
  issuedAt: number;
  requestNonce?: Uint8Array;
  authorization: ClientV1HpkeAuthorization;
  requestEkm?: Uint8Array;
  responseRecipientIkm?: Uint8Array;
}): Promise<ClientV1HpkeTestClient>;
```

It reuses the production canonical route/AAD helpers but implements the opposite HPKE roles: Base-mode request sender and Auth-mode response recipient. It defaults to fresh generated nonce/keys, accepts deterministic IKM/EKM only for tests, never logs credentials, and refuses every plaintext response.

Before parsing JSON or decoding base64url, it streams at most
`responseEnvelopeBytes`. It accepts ciphertext only through
`responseCiphertextBytes`, exactly `responsePlaintextBytes + 16` for the fixed
AES-GCM tag, and explicitly rejects a decrypted plaintext larger than
`responsePlaintextBytes` before UTF-8 decoding or JSON parsing. Tests pin the
exact envelope, ciphertext, and decrypted-plaintext boundary and reject a
one-byte-oversized outer envelope and one-byte-oversized ciphertext with the
fixed secret-free client error.

- [ ] **Step 11: Wire and run**

Append `hpke-bound-v1.test.ts` to the API suite.
Append `scripts/export-client-v1-hpke-vectors.test.mjs` beside the existing Client v1 exporter test.

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/hpke-bound-v1.test.ts
node --test scripts/export-client-v1-hpke-vectors.test.mjs
node scripts/export-client-v1-hpke-vectors.mjs --check
```

Expected: PASS with the exact vector and all negative mutations.

- [ ] **Step 12: Commit**

```bash
git add \
  src/lib/server/client-v1/hpke-bound-v1.ts \
  src/lib/server/client-v1/hpke-bound-v1.test.ts \
  src/lib/server/client-v1/hpke-bound-v1-vector.ts \
  src/lib/server/client-v1/hpke-bound-v1-vectors.json \
  src/lib/server/client-v1/hpke-bound-v1-vectors.sha256 \
  src/lib/server/client-v1/testing/hpke-client.ts \
  src/lib/server/client-v1/authority-contract.ts \
  src/lib/server/client-v1/authority-contract.test.ts \
  scripts/export-client-v1-hpke-vectors.mjs \
  scripts/export-client-v1-hpke-vectors.test.mjs \
  .gitattributes \
  scripts/run-tests.mjs
git commit \
  -m "feat(client-v1): add HPKE authority codecs" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 4: Add freshness, replay reservation, and the authority runtime

**Files:**
- Create: `src/lib/server/client-v1/authority-replay.ts`
- Create: `src/lib/server/client-v1/authority-replay.test.ts`
- Create: `src/lib/server/client-v1/authority-runtime.ts`
- Create: `src/lib/server/client-v1/authority-runtime.test.ts`
- Modify: `src/lib/server/client-v1/runtime.ts`
- Modify: `src/lib/server/client-v1/runtime.test.ts`
- Modify: `src/lib/server/client-v1/responses.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing replay tests**

Pass the current time explicitly to every cache operation and assert:

```ts
const replay = createClientV1AuthorityReplayCache();

assert.deepEqual(
  replay.reserve({
    keyId: "key-1",
    requestNonce: "nonce-1",
    issuedAt: 1_000,
  }, now),
  { ok: true },
);
assert.deepEqual(
  replay.reserve({
    keyId: "key-1",
    requestNonce: "nonce-1",
    issuedAt: 1_000,
  }, now),
  { ok: false, reason: "replay" },
);
now = 121_001;
assert.deepEqual(
  replay.reserve({
    keyId: "key-1",
    requestNonce: "nonce-1",
    issuedAt: 121_001,
  }, now),
  { ok: true },
);
```

Fill 4096 distinct live entries and assert the 4097th returns `{ ok: false, reason: "capacity", retryAfterSeconds: 120 }` without deleting an earlier reservation. Assert old/future timestamps return `"stale"` and do not consume capacity. Assert the inclusive lower and upper freshness boundaries succeed with the exact same supplied `now`, and one millisecond outside each boundary is stale.

Name the capacity case `a 4096-page burst is admitted and the next page receives exact retry timing` and use:

```ts
now = 10_000;
for (let page = 0; page < 4_096; page += 1) {
  assert.deepEqual(
    replay.reserve({
      keyId: "key-1",
      requestNonce: `page-${page}`,
      issuedAt: now,
    }, now),
    { ok: true },
  );
}
assert.deepEqual(
  replay.reserve({
    keyId: "key-1",
    requestNonce: "page-4096",
    issuedAt: now,
  }, now),
  {
    ok: false,
    reason: "capacity",
    retryAfterSeconds: 120,
  },
);
now += 120_000;
assert.deepEqual(
  replay.reserve({
    keyId: "key-1",
    requestNonce: "page-4096-fresh-envelope",
    issuedAt: now,
  }, now),
  { ok: true },
);
```

The test represents unique protected page requests, not replayed ciphertext. It proves the first 4096 reservations remain live, the rejected page does not evict one, and pagination can resume only after expiry with a fresh nonce.

- [ ] **Step 2: Run and verify replay tests fail**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/authority-replay.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the bounded replay cache**

Use one `Map<string, number>` where the value is the reservation expiry. Purge entries with `expiry <= now` before freshness, duplicate, or capacity decisions. Use `${keyId}:${requestNonce}` as the key. Do not store ciphertext, credential, response key, route, body, or instance ID.

```ts
export type ClientV1AuthorityReplayResult =
  | { ok: true }
  | { ok: false; reason: "stale" }
  | { ok: false; reason: "replay" }
  | {
    ok: false;
    reason: "capacity";
    retryAfterSeconds: number;
  };

export type ClientV1AuthorityReplayEnvelope = Pick<
  ClientV1HpkeBinding,
  "issuedAt" | "keyId" | "requestNonce"
>;

export interface ClientV1AuthorityReplayCache {
  reserve(
    envelope: ClientV1AuthorityReplayEnvelope,
    now: number,
  ): ClientV1AuthorityReplayResult;
  size(now: number): number;
}

export function createClientV1AuthorityReplayCache():
  ClientV1AuthorityReplayCache {
  const reservations = new Map<string, number>();

  const purge = (current: number): void => {
    for (const [key, expiresAt] of reservations) {
      if (expiresAt <= current) reservations.delete(key);
    }
  };

  return {
    reserve(
      envelope: ClientV1AuthorityReplayEnvelope,
      now: number,
    ): ClientV1AuthorityReplayResult {
      purge(now);
      if (
        !Number.isSafeInteger(envelope.issuedAt)
        || envelope.issuedAt
          < now - CLIENT_V1_HPKE_FRESHNESS.maximumAgeMs
        || envelope.issuedAt
          > now + CLIENT_V1_HPKE_FRESHNESS.maximumFutureSkewMs
      ) {
        return { ok: false, reason: "stale" };
      }
      const key = `${envelope.keyId}:${envelope.requestNonce}`;
      if (reservations.has(key)) return { ok: false, reason: "replay" };
      if (
        reservations.size
        >= CLIENT_V1_HPKE_FRESHNESS.replayCapacity
      ) {
        let earliestExpiry = Number.POSITIVE_INFINITY;
        for (const expiresAt of reservations.values()) {
          earliestExpiry = Math.min(earliestExpiry, expiresAt);
        }
        return {
          ok: false,
          reason: "capacity",
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((earliestExpiry - now) / 1_000),
          ),
        };
      }
      reservations.set(
        key,
        now + CLIENT_V1_HPKE_FRESHNESS.replayTtlMs,
      );
      return { ok: true };
    },
    size(now: number): number {
      purge(now);
      return reservations.size;
    },
  };
}
```

- [ ] **Step 4: Write failing authority-runtime tests**

Create test boot material with `deriveKeyPair`, inject it into `createClientV1Runtime`, and assert:

1. default runtime mode is `off`;
2. `off` calls the legacy callback with the original plaintext credential headers;
3. for both `advertise` and `enforce`, an `{ unavailable: true }` bootstrap returns the exact fixed plaintext 503 for every protected operation, regardless of marker presence, and invokes the callback zero times;
4. that unavailable response has `error.code === "service_unavailable"`, `error.details.reason === "authority_unavailable"`, and `error.retryable === true`;
5. `advertise` calls the legacy callback when the marker is absent only when boot material is available;
6. `advertise` opens a valid bound request, injects only the expected internal credential header, strips the other credential header, and returns an Auth-mode outer 200;
7. in both `advertise` and `enforce`, present empty, whitespace, case-changed, duplicate, and comma-combined marker values return the same fixed `authority_invalid`, invoke the callback zero times, and expose neither test secret nor bearer;
8. `enforce` rejects an absent binding with 426 before invoking the callback;
9. the four `ClientV1HpkeBoundRequestError` kinds map exactly to stale-key, stale-instance, stale-request, and invalid plaintext responses before callback;
10. replay reservation occurs before a spy pairing/bearer handler;
11. two simultaneous `handle(...)` calls using clones of one identical valid envelope invoke the callback once, return one encrypted success, and return one encrypted inner `authority_replayed`;
12. capacity returns encrypted inner `authority_replay_capacity` with the replay result’s exact `retry-after`;
13. an injected replay cache returning `{ ok: false, reason: "stale" }` invokes the callback zero times and returns encrypted inner `409 conflict` with `details.reason === "authority_request_stale"`;
14. replay, capacity, and stale reservation results all invoke the callback zero times;
15. a request exactly on the lower freshness boundary reads the runtime clock once, reserves successfully, and a second identical request returns encrypted `authority_replayed` without a second callback;
16. plaintext `Authorization` or `X-Coven-Pairing-Secret` accompanying an exact bound marker returns fixed `authority_invalid`;
17. errors and captured diagnostics contain neither test secret nor bearer.

For the defensive stale-result path, inject:

```ts
const replay: ClientV1AuthorityReplayCache = {
  reserve: () => ({ ok: false, reason: "stale" }),
  size: () => 0,
};
```

Open the returned outer response with the test client, assert inner status `409` and `error.details.reason === "authority_request_stale"`, and assert the pairing/bearer callback, store, rate limiter, and read-source spies remain at zero.

For the near-boundary regression, make an independent clock read advance by one millisecond, reset its read count before each `handle(...)`, and use a request with `issuedAt = snapshot - CLIENT_V1_HPKE_FRESHNESS.maximumAgeMs`:

```ts
let clockReads = 0;
const now = () => snapshot + clockReads++;
const handleBoundary = () => authority.handle({
  ...validBoundaryInput,
  request: validBoundaryInput.request.clone(),
});

clockReads = 0;
const first = await handleBoundary();
assert.equal(clockReads, 1);
assert.equal(invocations, 1);
assert.equal((await client.open(first)).status, 200);

clockReads = 0;
const second = await handleBoundary();
assert.equal(clockReads, 1);
assert.equal(invocations, 1);
assert.equal(
  JSON.parse(new TextDecoder().decode((await client.open(second)).body))
    .error.details.reason,
  "authority_replayed",
);
```

This test fails under the old two-clock flow: the open accepts at the inclusive lower boundary, the independent reservation read advances one millisecond and returns `"stale"`, and the unhandled result reaches the callback without a reservation.

For the unavailable matrix, loop over `CLIENT_V1_OPERATION_DEFINITIONS.filter(({ binding }) => binding === "hpke-bound-v1")`, supply the matching plaintext credential header, and assert:

```ts
for (const marker of [undefined, CLIENT_V1_HPKE_MECHANISM]) {
  const headers = new Headers(
    operation.credential === "pairing-secret"
      ? { [CLIENT_V1_PAIRING_SECRET_HEADER]: TEST_PAIRING_SECRET }
      : { authorization: TEST_BEARER },
  );
  if (marker) {
    headers.set(CLIENT_V1_HPKE_HEADERS.mechanism, marker);
  }
  const response = await authority.handle({
    operation: operation.id,
    request: new Request("http://127.0.0.1:3020/api/client/v1/projects", {
      headers,
    }),
    invoke: async () => {
      invocations += 1;
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(response.status, 503);
  assert.equal(invocations, 0);
  assert.deepEqual(
    await response.json(),
    clientV1Error(
      "service_unavailable",
      "Client v1 HPKE authority is unavailable.",
      {
        details: { reason: "authority_unavailable" },
        retryable: true,
      },
    ),
  );
}
```

Import the existing `clientV1Error` producer for this full-envelope comparison; do not compare only the status.

- [ ] **Step 5: Run and verify authority-runtime tests fail**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/lib/server/client-v1/authority-runtime.test.ts
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 6: Define the boot bridge and runtime interface**

Use a process-local global object:

```ts
export type ClientV1AuthorityBootstrap = {
  mode: "advertise" | "enforce";
  suite: CipherSuite;
  keyPair: CryptoKeyPair;
  publicKey: Uint8Array;
  keyId: Uint8Array;
  runtimeNonce: Uint8Array;
};

export type ClientV1AuthorityBootstrapState =
  | ClientV1AuthorityBootstrap
  | {
    mode: "advertise" | "enforce";
    unavailable: true;
  };

declare global {
  var __covenCaveClientV1AuthorityBootstrap:
    | ClientV1AuthorityBootstrapState
    | undefined;
}
```

Add to `ClientV1Runtime`:

```ts
export interface ClientV1Runtime {
  authority: ClientV1AuthorityRuntime;
  authenticator: ClientV1Authenticator;
  credentialStore: CredentialStore;
  now: () => number;
  pairingStore: PairingStore;
  rateLimiter: ClientV1RateLimiter;
}

export interface ClientV1RuntimeOptions {
  authority?: ClientV1AuthorityRuntime;
  credentialRoot?: string;
  loopbackSecret?: string;
  now?: () => number;
}
```

Keep `createClientV1Runtime` synchronous:

```ts
const authority =
  options.authority
  ?? createClientV1AuthorityRuntimeFromGlobal({ now });
```

Give the authority factory an optional replay-cache injection for deterministic fail-closed tests while production uses one new process-local cache:

```ts
export interface ClientV1AuthorityRuntimeFactoryOptions {
  now: () => number;
  replay?: ClientV1AuthorityReplayCache;
}

export function createClientV1AuthorityRuntimeFromGlobal({
  now,
  replay = createClientV1AuthorityReplayCache(),
}: ClientV1AuthorityRuntimeFactoryOptions): ClientV1AuthorityRuntime;
```

- [ ] **Step 7: Implement the wrapper**

Expose:

```ts
export interface ClientV1AuthorityRuntime {
  readonly mode: ClientV1AuthorityMode;
  handle(input: {
    operation: ClientV1Operation;
    request: Request;
    invoke: (request: Request) => Promise<Response>;
  }): Promise<Response>;
}
```

Algorithm:

```ts
if (mode === "off") return input.invoke(input.request);

const operation = clientV1Operation(input.operation);
if (!operation || operation.binding !== "hpke-bound-v1") {
  return input.invoke(input.request);
}
if (unavailable) {
  return clientV1AuthorityUnavailableResponse();
}

const marker = input.request.headers.get(CLIENT_V1_HPKE_HEADERS.mechanism);
if (marker === null) {
  if (mode === "advertise") return input.invoke(input.request);
  return clientV1AuthorityRequiredResponse();
}
if (marker !== CLIENT_V1_HPKE_MECHANISM) {
  return clientV1AuthorityInvalidResponse();
}
if (
  input.request.headers.has("authorization")
  || input.request.headers.has(CLIENT_V1_PAIRING_SECRET_HEADER)
) {
  return clientV1AuthorityInvalidResponse();
}
```

Then:

1. read and bound the body;
2. capture `requestNow = now()` exactly once, then call `openClientV1HpkeBoundRequest`, whose typed contract validates key ID, runtime nonce, instance ID, issued-at freshness, AAD, HPKE open, and canonical request plaintext;
3. map every `ClientV1HpkeBoundRequestError` kind to its fixed plaintext response; no raw exception text is returned;
4. define the exhaustive error-response map once at module scope; on successful open, synchronously reserve replay as the immediately following statement, with no intervening `await`, promise, callback, clock read, log, metric, or store access:

```ts
const clientV1AuthorityOpenErrorResponses = {
  "stale-key": clientV1AuthorityStaleKeyResponse,
  "stale-instance": clientV1AuthorityStaleInstanceResponse,
  "stale-request": clientV1AuthorityStaleRequestResponse,
  invalid: clientV1AuthorityInvalidResponse,
} satisfies Record<
  ClientV1HpkeBoundRequestErrorKind,
  () => Response
>;

const requestNow = now();
let opened: OpenedClientV1HpkeRequest;
try {
  opened = await openClientV1HpkeBoundRequest({
    suite: bootstrap.suite,
    recipientKey: bootstrap.keyPair.privateKey,
    request: input.request,
    body,
    expectedKeyId: bootstrap.keyId,
    expectedRuntimeNonce: bootstrap.runtimeNonce,
    expectedInstanceId: clientV1InstanceId(),
    now: requestNow,
  });
} catch (error) {
  if (!(error instanceof ClientV1HpkeBoundRequestError)) {
    return clientV1AuthorityInvalidResponse();
  }
  return clientV1AuthorityOpenErrorResponses[error.kind]();
}
const reservation = replay.reserve(opened.binding, requestNow);
```

5. after the synchronous reservation result exists, deserialize `opened.responsePublicKeyBytes`; this is the first permitted `await` after HPKE open:

```ts
const responsePublicKey = await bootstrap.suite.kem.deserializePublicKey(
  opened.responsePublicKeyBytes,
);
```

6. before credential parsing or any existing handler, exhaustively handle all non-ok reservation variants and Auth-seal the fixed inner response:

```ts
if (!reservation.ok) {
  let response: Response;
  switch (reservation.reason) {
    case "stale":
      response = clientV1AuthorityStaleRequestResponse();
      break;
    case "replay":
      response = clientV1ErrorResponse(
        "conflict",
        "The authority request was already used.",
        {
          details: { reason: "authority_replayed" },
          retryable: true,
        },
      );
      break;
    case "capacity":
      response = clientV1ErrorResponse(
        "service_unavailable",
        "The authority replay window is full.",
        {
          details: { reason: "authority_replay_capacity" },
          headers: {
            "retry-after": String(reservation.retryAfterSeconds),
          },
          retryable: true,
        },
      );
      break;
  }
  return sealClientV1HpkeBoundResponse({
    suite: bootstrap.suite,
    senderKey: bootstrap.keyPair.privateKey,
    responsePublicKey,
    binding: opened.binding,
    response,
  });
}
```

7. verify credential kind equals `operation.credential`;
8. because all seven current protected operations are bodyless, Auth-seal inner `400 invalid_request` with `details.reason: "authority_invalid"` if the authenticated body is non-empty;
9. clone headers, delete all authority headers, set exactly one internal credential header;
10. reconstruct `Request` with original URL, method, body bytes, signal, and safe headers;
11. invoke the existing handler callback;
12. Auth-seal its response;
13. on response sealing failure, emit the fixed plaintext 500.

Use `timingSafeEqual` from `node:crypto` for raw key-ID and runtime-nonce bytes inside `openClientV1HpkeBoundRequest`. Do not compare secret/bearer values in the wrapper.

- [ ] **Step 8: Add fixed response helpers**

Add named helpers in `responses.ts`:

```ts
export function clientV1AuthorityRequiredResponse(): Response {
  return clientV1ErrorResponse(
    "incompatible_version",
    "HPKE authority binding is required.",
    { details: { reason: "hpke_binding_required" } },
  );
}

export function clientV1AuthorityUnavailableResponse(): Response {
  return clientV1ErrorResponse(
    "service_unavailable",
    "Client v1 HPKE authority is unavailable.",
    {
      details: { reason: "authority_unavailable" },
      retryable: true,
    },
  );
}

export function clientV1AuthorityInvalidResponse(): Response {
  return clientV1ErrorResponse(
    "invalid_request",
    "Invalid authority envelope.",
    { details: { reason: "authority_invalid" } },
  );
}

export function clientV1AuthorityStaleKeyResponse(): Response {
  return clientV1ErrorResponse(
    "conflict",
    "The Cave authority key is stale.",
    { details: { reason: "authority_key_stale" }, retryable: true },
  );
}

export function clientV1AuthorityStaleInstanceResponse(): Response {
  return clientV1ErrorResponse(
    "conflict",
    "The Cave instance identity is stale.",
    { details: { reason: "authority_instance_stale" }, retryable: true },
  );
}

export function clientV1AuthorityStaleRequestResponse(): Response {
  return clientV1ErrorResponse(
    "conflict",
    "The authority request is stale.",
    { details: { reason: "authority_request_stale" }, retryable: true },
  );
}

export function clientV1AuthorityResponseFailure(): Response {
  return clientV1ErrorResponse(
    "internal_error",
    "The authenticated response could not be produced.",
    { details: { reason: "authority_response_failed" }, retryable: true },
  );
}
```

`clientV1ErrorResponse("service_unavailable", ...)` is pinned by the existing response map to HTTP 503. `clientV1AuthorityStaleRequestResponse()` is used plaintext for a typed pre-open `"stale-request"` error and as the encrypted inner response for a post-open replay reservation `"stale"` result. Construct the encrypted replay/capacity responses exactly before sealing:

```ts
const replayed = clientV1ErrorResponse(
  "conflict",
  "The authority request was already used.",
  {
    details: { reason: "authority_replayed" },
    retryable: true,
  },
);

const capacity = clientV1ErrorResponse(
  "service_unavailable",
  "The authority replay window is full.",
  {
    details: { reason: "authority_replay_capacity" },
    headers: {
      "retry-after": String(reservation.retryAfterSeconds),
    },
    retryable: true,
  },
);
```

Auth-seal stale, replay, or capacity inner responses with the opened request’s response key. Never expose the capacity `retry-after` as unauthenticated outer guidance.

- [ ] **Step 9: Wire tests and run**

Add both new tests to the API suite; add `authority-runtime.test.ts` to `ALIAS_LOADER`.

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/authority-replay.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/lib/server/client-v1/authority-runtime.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/runtime.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add \
  src/lib/server/client-v1/authority-replay.ts \
  src/lib/server/client-v1/authority-replay.test.ts \
  src/lib/server/client-v1/authority-runtime.ts \
  src/lib/server/client-v1/authority-runtime.test.ts \
  src/lib/server/client-v1/runtime.ts \
  src/lib/server/client-v1/runtime.test.ts \
  src/lib/server/client-v1/responses.ts \
  scripts/run-tests.mjs
git commit \
  -m "feat(client-v1): add bound authority runtime" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 5: Publish one per-boot public authority through discovery v2

**Files:**
- Modify: `server.ts`
- Modify: `server.mjs` (generated by `pnpm build:server`)
- Modify: `src/lib/server/client-v1/discovery.ts`
- Modify: `src/lib/server/client-v1/discovery.test.ts`
- Modify: `scripts/client-v1-release-smoke.mjs`
- Modify: `scripts/client-v1-release-smoke.test.mjs`
- Modify: `scripts/sidecar-runtime-closure.mjs`
- Modify: `scripts/sidecar-runtime-closure.test.mjs`
- Modify: `scripts/sidecar-runtime-smoke.mjs`

- [ ] **Step 1: Write failing discovery-v2 tests**

Add a valid v2 record:

```ts
const v2 = {
  version: 2,
  endpoint: "http://127.0.0.1:3020",
  pid: process.pid,
  nonce: "gIGCg4SFhoeIiYqLjI2Oj5CRkpOUlZaXmJmam5ydnp8",
  startedAt: "2026-08-25T15:42:58.109Z",
  authority: {
    mechanism: "hpke-bound-v1",
    mode: "enforce",
    keyId: "Tq04GMSX5BPPPijzO9pHfQ1lAnna_RQKzL1ncDGl-4g",
    publicKey: "sfG4QN56MkGwJ0jPmwW3TcjF6EUSmHOIF712qo6-jCs",
    suite: { kemId: 32, kdfId: 1, aeadId: 2 },
  },
};
assert.deepEqual(validateClientV1DiscoveryRecord(v2), v2);
```

Reject:

- `version: 2` without authority;
- v2 `mode: "off"`;
- wrong suite ID;
- padded/noncanonical/wrong-length key, key ID, or nonce;
- any nested `privateKey`, `secretKey`, `senderKey`, `d`, or extra field;
- v2 carrying any top-level field outside the exact schema.

Keep the existing v1 acceptance, unknown-field tolerance, and atomic owner-only publication tests unchanged. The default publisher never emits an authority field in v1.

- [ ] **Step 2: Run and verify discovery tests fail**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/discovery.test.ts
```

Expected: FAIL because version 2 is currently rejected.

- [ ] **Step 3: Implement the strict discovery union**

Define:

```ts
export type ClientV1DiscoveryRecord =
  | ClientV1DiscoveryRecordV1
  | ClientV1DiscoveryRecordV2;
```

Branch on `input.version`. Preserve the current v1 returned object and behavior. For v2, require exact keys and return a freshly cloned record.

```ts
export function validateClientV1DiscoveryRecord(
  value: unknown,
  options: Pick<ClientV1DiscoveryOptions, "isProcessAlive"> = {},
): ClientV1DiscoveryRecord {
  const input = requireDiscoveryObject(value);
  if (input.version === 1) {
    return validateClientV1DiscoveryRecordV1(input, options);
  }
  if (input.version === 2) {
    return validateClientV1DiscoveryRecordV2(input, options);
  }
  throw new Error("Client v1 discovery version must be 1 or 2.");
}
```

`validateClientV1DiscoveryRecordV1` is the current validation body moved without tightening unknown-field behavior. `validateClientV1DiscoveryRecordV2` starts with:

```ts
assertExactKeys(input, [
  "version",
  "endpoint",
  "pid",
  "nonce",
  "startedAt",
  "authority",
]);
assertExactKeys(authority, [
  "mechanism",
  "mode",
  "keyId",
  "publicKey",
  "suite",
]);
assertExactKeys(suite, ["kemId", "kdfId", "aeadId"]);
```

- [ ] **Step 4: Write failing standalone-server source/lifecycle tests**

Read `server.ts` and assert:

- default mode string is `off`;
- invalid mode throws;
- no private key is assigned to `process.env`;
- key generation occurs once before discovery publication;
- `suite.kem.generateKeyPair()` is used;
- only serialized public key/key ID/suite/mode enter JSON;
- `globalThis.__covenCaveClientV1AuthorityBootstrap` receives the in-memory keypair;
- a caught active-mode initialization failure stores `{ mode: requestedMode, unavailable: true }` and never rewrites the requested mode to `off`;
- unavailable active bootstrap publishes no discovery record;
- discovery v1 is emitted when mode is off;
- discovery v2 is emitted for advertise/enforce;
- publication remains inside listener readiness;
- shutdown nonce-safe cleanup remains unchanged.

- [ ] **Step 5: Initialize one boot key in `server.ts`**

Use dynamic imports only when mode is active:

```ts
const CLIENT_V1_AUTHORITY_MODE =
  parseStandaloneClientV1AuthorityMode(
    process.env.COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE,
  );

let clientV1AuthorityInitializationError: Error | null = null;
let CLIENT_V1_AUTHORITY_BOOTSTRAP:
  | ClientV1AuthorityBootstrapState
  | undefined;

if (CLIENT_V1_AUTHORITY_MODE !== "off") {
  try {
    CLIENT_V1_AUTHORITY_BOOTSTRAP =
      await createStandaloneClientV1AuthorityBootstrap(
        CLIENT_V1_AUTHORITY_MODE,
      );
  } catch {
    clientV1AuthorityInitializationError = new Error(
      "Client v1 HPKE authority initialization failed.",
    );
    CLIENT_V1_AUTHORITY_BOOTSTRAP = {
      mode: CLIENT_V1_AUTHORITY_MODE,
      unavailable: true,
    };
  }
}

globalThis.__covenCaveClientV1AuthorityBootstrap =
  CLIENT_V1_AUTHORITY_BOOTSTRAP;

// Replace the current unconditional `const ... = randomUUID()` declaration.
const CLIENT_V1_DISCOVERY_NONCE =
  CLIENT_V1_AUTHORITY_BOOTSTRAP
  && !("unavailable" in CLIENT_V1_AUTHORITY_BOOTSTRAP)
    ? Buffer.from(
        CLIENT_V1_AUTHORITY_BOOTSTRAP.runtimeNonce,
      ).toString("base64url")
    : randomUUID();
```

Inside the creator:

```ts
const [
  { Aes256Gcm, CipherSuite, HkdfSha256 },
  { DhkemX25519HkdfSha256 },
] = await Promise.all([
  import("@hpke/core"),
  import("@hpke/dhkem-x25519"),
]);
const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Aes256Gcm(),
});
const keyPair = await suite.kem.generateKeyPair();
const publicKey = new Uint8Array(
  await suite.kem.serializePublicKey(keyPair.publicKey),
);
const keyId = new Uint8Array(
  createHash("sha256")
    .update("OpenCoven/client-v1/hpke-bound-v1/key-id\0", "utf8")
    .update(publicKey)
    .digest(),
);
const runtimeNonce = randomBytes(32);
return {
  mode,
  suite,
  keyPair,
  publicKey,
  keyId,
  runtimeNonce,
};
```

Add `createHash` and `randomBytes` to the existing `node:crypto` import. The private `CryptoKey` remains in memory only.

- [ ] **Step 6: Publish the version selected by mode**

In `publishStandaloneClientV1DiscoveryRecord`, keep the existing v1 object exact for `off`. For active modes add:

```ts
{
  version: 2,
  endpoint,
  pid: process.pid,
  nonce: CLIENT_V1_DISCOVERY_NONCE,
  startedAt: CLIENT_V1_DISCOVERY_STARTED_AT,
  authority: {
    mechanism: "hpke-bound-v1",
    mode: bootstrap.mode,
    keyId: Buffer.from(bootstrap.keyId).toString("base64url"),
    publicKey: Buffer.from(bootstrap.publicKey).toString("base64url"),
    suite: { kemId: 32, kdfId: 1, aeadId: 2 },
  },
}
```

Before building the v2 object, refuse the unavailable state with the fixed `clientV1AuthorityInitializationError` so the existing listener-readiness catch publishes no record and reports Client v1 disabled without emitting the HPKE library’s exception text.

Do not change the filename or filesystem safeguards. Keep cleanup calling `removeStandaloneClientV1DiscoveryRecord(CLIENT_V1_DISCOVERY_NONCE)`, which now matches both the legacy UUID nonce in `off` and the runtime-nonce base64url value in active modes.

- [ ] **Step 7: Define failure behavior**

If active-mode key initialization fails, retain the requested `advertise` or `enforce` mode in `{ mode, unavailable: true }`, publish no discovery record, and use the existing loud “CLIENT V1 DISABLED” reporting path. This is never represented as `undefined` or `off`. `createClientV1AuthorityRuntimeFromGlobal` must build an unavailable active runtime whose protected-operation branch returns `clientV1AuthorityUnavailableResponse()` before marker inspection or legacy invocation. Health, pairing creation, and explicitly unprotected/admin operations retain their existing behavior; all seven `hpke-bound-v1` operations return the fixed plaintext 503 for both missing-marker plaintext requests and malformed/present-marker requests because no key exists to authenticate them. Invalid mode configuration fails before `app.prepare()` with the exact allowed-value message.

- [ ] **Step 8: Extend release-smoke contract expectations**

Keep `readHealth` and `checkHealthEnvelope` behavior unchanged. Extend
`contractExpectations()` and its tests to pin the producer default to `off`
while retaining the same API/minimum/release version checks. Before Task 7's
atomic public-manifest publication, the existing fixture has no `authority`
field, so absence means the only compatible pre-publication default, `off`;
any present `authority.defaultMode` must already be exact `"off"`. Do not add a
live discovery option to this health-only probe; the packaged runtime smoke and
the takeover harness own their distinct process-startup proofs.

- [ ] **Step 9: Retain and exercise the packaged HPKE runtime**

Add `@hpke/core`, `@hpke/dhkem-x25519`, and the lockfile-pinned transitive
`@hpke/common` to `SIDECAR_DYNAMIC_PACKAGES`. Require each package manifest and
ESM entry module in `verifySidecarRuntime`; the existing package-copy filter
retains the packages' runtime subpaths while excluding maps, declarations, and
nested package trees.

Extend `sidecar-runtime-closure.test.mjs` with the installed pinned HPKE
packages, assemble the fixture sidecar, and run a bare-package import probe
from inside that assembled root. The probe must import all three packages,
construct the production suite, generate an X25519 keypair, and confirm the
serialized public key is 32 bytes.

Keep the first launch in `sidecar-runtime-smoke.mjs` default-off and assert it
publishes discovery v1 without authority. Restart the same packaged sidecar
with `COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE=enforce` and assert discovery v2
publishes the exact HPKE suite, mechanism, mode, key ID, and public key. This
Task 5 smoke owns packaged import/initialization/publication only; Task 8 owns
the hostile listener-takeover harness and Task 9 reruns both gates together.

- [ ] **Step 10: Run targeted tests**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/discovery.test.ts
node --test scripts/client-v1-release-smoke.test.mjs
node --test scripts/sidecar-runtime-closure.test.mjs
pnpm build:server
```

Expected: PASS; `server.mjs` builds with the literal dynamic package imports.
After assembling the release sidecar, `pnpm test:sidecar-runtime` must also
pass its default-off and enforce-mode launches.

- [ ] **Step 11: Commit**

```bash
git add \
  server.ts \
  server.mjs \
  src/lib/server/client-v1/discovery.ts \
  src/lib/server/client-v1/discovery.test.ts \
  scripts/client-v1-release-smoke.mjs \
  scripts/client-v1-release-smoke.test.mjs \
  scripts/sidecar-runtime-closure.mjs \
  scripts/sidecar-runtime-closure.test.mjs \
  scripts/sidecar-runtime-smoke.mjs
git commit \
  -m "feat(client-v1): publish HPKE discovery v2" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 6: Wrap every secret/bearer route and reject downgrades

**Files:**
- Modify: `src/app/api/client/v1/pairing/requests/[id]/route.ts`
- Modify: `src/app/api/client/v1/pairing/requests/[id]/exchange/route.ts`
- Modify: `src/app/api/client/v1/familiars/route.ts`
- Modify: `src/app/api/client/v1/projects/route.ts`
- Modify: `src/app/api/client/v1/conversations/route.ts`
- Modify: `src/app/api/client/v1/conversations/[id]/route.ts`
- Modify: `src/app/api/client/v1/conversations/[id]/messages/route.ts`
- Modify: the seven matching `route.test.ts` files
- Modify: `src/app/api/api-contracts.test.ts`

- [ ] **Step 1: Add failing source-contract assertions**

For every operation:

```ts
if (operation.binding === "hpke-bound-v1") {
  assert.match(
    routeSource,
    /authority\.handle\s*\(/,
    `client-v1 operation ${operation.id} declares hpke-bound-v1 but its route never calls authority.handle`,
  );
} else {
  assert.doesNotMatch(
    routeSource,
    /authority\.handle\s*\(/,
    `client-v1 operation ${operation.id} is not part of hpke-bound-v1`,
  );
}
```

Keep the existing `requireScope`, `consumeAuthenticated`, `requireClientV1Admin`, and ingress assertions.

- [ ] **Step 2: Run and verify the API contract test fails**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/app/api/api-contracts.test.ts
```

Expected: FAIL naming all seven protected operations.

- [ ] **Step 3: Wrap pairing poll**

The exported factory keeps its current body in a local callback:

```ts
return async function pairingRequestGet(request, context): Promise<Response> {
  return runtime.authority.handle({
    operation: "pairing.poll",
    request,
    invoke: (authorizedRequest) =>
      servePairingRequestGet(authorizedRequest, context),
  });
};
```

`servePairingRequestGet` contains the existing loopback check, pairing-secret parser, shared failure budget, lookup, and response logic without semantic changes.

- [ ] **Step 4: Wrap pairing exchange**

Use:

```ts
return async function pairingExchangePost(request, context): Promise<Response> {
  return runtime.authority.handle({
    operation: "pairing.exchange",
    request,
    invoke: (authorizedRequest) =>
      servePairingExchangePost(authorizedRequest, context),
  });
};
```

Keep consumption-before-issue and restore-on-issue-failure behavior unchanged.

- [ ] **Step 5: Wrap all five reads explicitly**

Use these exact operation IDs:

```ts
clientV1.authority.handle({
  operation: "familiars.list",
  request,
  invoke: serve,
});

clientV1.authority.handle({
  operation: "projects.list",
  request,
  invoke: serve,
});

clientV1.authority.handle({
  operation: "conversations.list",
  request,
  invoke: serve,
});

clientV1.authority.handle({
  operation: "conversations.read",
  request,
  invoke: (authorizedRequest) => serve(authorizedRequest, context),
});

clientV1.authority.handle({
  operation: "messages.list",
  request,
  invoke: (authorizedRequest) => serve(authorizedRequest, context),
});
```

Each `serve` function retains the current explicit loopback check, `requireScope`, `consumeAuthenticated`, query validation, source read, projection, and response builder in the same route file so existing source-contract assertions remain meaningful.

- [ ] **Step 6: Preserve default-off route behavior**

Run the existing seven route tests before adding bound cases. They must pass unchanged because `createClientV1Runtime()` defaults to authority mode `off`.

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/app/api/client/v1/pairing/requests/[id]/route.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/app/api/client/v1/pairing/requests/[id]/exchange/route.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/app/api/client/v1/familiars/route.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/app/api/client/v1/projects/route.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/app/api/client/v1/conversations/route.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/app/api/client/v1/conversations/[id]/route.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/app/api/client/v1/conversations/[id]/messages/route.test.ts
```

Expected: PASS with the existing plaintext behavior.

- [ ] **Step 7: Add operation-specific bound tests**

Add at least one valid bound success and these failures to the relevant route suites:

- pairing poll: correct encrypted secret returns encrypted pending/approved status; plaintext secret in enforce mode returns 426; replay does not spend the wrong-secret budget;
- pairing exchange: correct encrypted secret returns an encrypted bearer; replacement/wrong key cannot consume pairing; replay does not issue a second credential;
- each read: correct encrypted bearer returns encrypted data; missing binding in enforce mode does not call `findByBearer` or the read source; wrong method/path/query/body/AAD does not call either store/source;
- all: Auth-mode response opens with the boot public key and fails with a replacement sender public key.

Use `createClientV1HpkeTestClient` from `src/lib/server/client-v1/testing/hpke-client.ts`; do not add it to a production package export.

Add this local decoder to the exchange and projects route suites:

```ts
async function openBoundJson(
  prepared: ClientV1HpkeTestClient,
  response: Response,
): Promise<{ status: number; body: Record<string, unknown> }> {
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type"),
    CLIENT_V1_HPKE_RESPONSE_MEDIA_TYPE,
  );
  const inner = await prepared.open(response);
  return {
    status: inner.status,
    body: JSON.parse(new TextDecoder().decode(inner.body)) as
      Record<string, unknown>,
  };
}
```

In `pairing/requests/[id]/exchange/route.test.ts`, add `two identical concurrent bound exchanges issue one credential and encrypt one replay refusal`. Create one approved pairing, one enforce-mode runtime/handler, and one prepared `pairing.exchange` request with a fixed 32-byte request nonce. Preserve the exact same envelope by cloning it:

```ts
const originalIssue = runtime.credentialStore.issue.bind(
  runtime.credentialStore,
);
let issueCalls = 0;
runtime.credentialStore.issue = async (input) => {
  issueCalls += 1;
  return originalIssue(input);
};

const [leftResponse, rightResponse] = await Promise.all([
  handler(prepared.request.clone(), context(pairing.id)),
  handler(prepared.request.clone(), context(pairing.id)),
]);
const opened = await Promise.all([
  openBoundJson(prepared, leftResponse),
  openBoundJson(prepared, rightResponse),
]);
assert.deepEqual(
  opened.map(({ status }) => status).sort((left, right) => left - right),
  [200, 409],
);
const success = opened.find(({ status }) => status === 200)!;
const replayed = opened.find(({ status }) => status === 409)!;
assert.match(
  (success.body as { data: { bearer: string } }).data.bearer,
  /^[A-Za-z0-9_-]{43}$/u,
);
assert.deepEqual(
  (replayed.body as {
    error: {
      code: string;
      details: { reason: string };
    };
  }).error,
  {
    code: "conflict",
    message: "The authority request was already used.",
    details: { reason: "authority_replayed" },
    retryable: true,
  },
);
assert.equal(issueCalls, 1);
assert.equal((await runtime.credentialStore.reload()).size, 1);
```

Both outer responses must be authenticated media-type 200 responses; ordering is intentionally nondeterministic. The exact replay message above is the fixed inner message used when constructing `clientV1ErrorResponse`.

In `projects/route.test.ts`, add `two identical concurrent bound bearer reads run one source read and encrypt one replay refusal`. Wrap the existing store/source before creating the handler:

```ts
const originalFind = runtime.credentialStore.findByBearer.bind(
  runtime.credentialStore,
);
let findCalls = 0;
runtime.credentialStore.findByBearer = async (bearer) => {
  findCalls += 1;
  return originalFind(bearer);
};
const originalCharge = runtime.rateLimiter.consumeAuthenticated.bind(
  runtime.rateLimiter,
);
let chargeCalls = 0;
runtime.rateLimiter.consumeAuthenticated = (credentialId) => {
  chargeCalls += 1;
  return originalCharge(credentialId);
};
let sourceCalls = 0;
const handler = createClientV1ProjectsGetHandler(
  runtime,
  sources({
    listProjects: async () => {
      sourceCalls += 1;
      return REGISTRY;
    },
  }),
);

const [leftResponse, rightResponse] = await Promise.all([
  handler(prepared.request.clone()),
  handler(prepared.request.clone()),
]);
const opened = await Promise.all([
  openBoundJson(prepared, leftResponse),
  openBoundJson(prepared, rightResponse),
]);
assert.deepEqual(
  opened.map(({ status }) => status).sort((left, right) => left - right),
  [200, 409],
);
assert.equal(
  opened.filter(({ status }) => status === 409).length,
  1,
);
assert.equal(
  ((opened.find(({ status }) => status === 409)!.body as {
    error: { details: { reason: string } };
  }).error.details.reason),
  "authority_replayed",
);
assert.equal(findCalls, 1);
assert.equal(chargeCalls, 1);
assert.equal(sourceCalls, 1);
```

The prepared projects URL includes `?limit=1`, so this also pins bearer pagination concurrency: the accepted page runs once, the duplicate page does not read the credential/source or consume a second authenticated budget, and a client must continue from the returned cursor using a new envelope.

- [ ] **Step 8: Prove secret-safe diagnostics**

Capture `console.warn`/`console.error` around malformed ciphertext, wrong key, replay, and response-seal failure. Assert the joined output excludes:

```ts
for (const secret of [
  pairing.secret,
  issued.bearer,
  "authorization",
  "x-coven-pairing-secret",
  requestCiphertext,
  responseCiphertext,
]) {
  assert.equal(logs.includes(secret), false, secret);
}
```

- [ ] **Step 9: Run source and route tests**

Run the API contract command and all seven route commands from Steps 2 and 6.

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add \
  src/app/api/api-contracts.test.ts \
  src/app/api/client/v1/pairing/requests/[id]/route.ts \
  src/app/api/client/v1/pairing/requests/[id]/route.test.ts \
  src/app/api/client/v1/pairing/requests/[id]/exchange/route.ts \
  src/app/api/client/v1/pairing/requests/[id]/exchange/route.test.ts \
  src/app/api/client/v1/familiars/route.ts \
  src/app/api/client/v1/familiars/route.test.ts \
  src/app/api/client/v1/projects/route.ts \
  src/app/api/client/v1/projects/route.test.ts \
  src/app/api/client/v1/conversations/route.ts \
  src/app/api/client/v1/conversations/route.test.ts \
  src/app/api/client/v1/conversations/[id]/route.ts \
  src/app/api/client/v1/conversations/[id]/route.test.ts \
  src/app/api/client/v1/conversations/[id]/messages/route.ts \
  src/app/api/client/v1/conversations/[id]/messages/route.test.ts \
  src/lib/server/client-v1/testing/hpke-client.ts
git commit \
  -m "feat(client-v1): bind secret and bearer routes" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 7: Export contract truth, vectors, and normative documentation

This is the publication boundary. Only after Task 6 has operational handlers
and downgrade enforcement, atomically add the public manifest types,
`clientV1OperationRecords()` fields, exporter ratchets, generated fixture
bytes/digest, and normative docs. None of those public compatibility bytes
land earlier.

**Files:**
- Modify: `src/lib/server/client-v1/contract.ts`
- Modify: `src/lib/server/client-v1/contract.test.ts`
- Modify: `scripts/export-client-v1-contract.mjs`
- Modify: `scripts/export-client-v1-contract.test.mjs`
- Modify: `src/lib/server/client-v1/contract-fixture.json`
- Modify: `src/lib/server/client-v1/contract-fixture.sha256`
- Modify: `docs/api/client-v1.md`
- Modify: `scripts/client-v1-doc-contract.test.mjs`

- [ ] **Step 1: Write failing contract assertions**

Pin:

```ts
assert.deepEqual(fixture.contract.discovery, {
  fileName: "client-v1-discovery.json",
  mode: "0600",
  version: 1,
  hpkeBoundVersion: 2,
});
assert.equal(fixture.contract.authority.defaultMode, "off");
assert.deepEqual(fixture.contract.authority.modes, [
  "off",
  "advertise",
  "enforce",
]);
assert.deepEqual(fixture.contract.authority.mechanism.suite, {
  kem: "DHKEM(X25519, HKDF-SHA256)",
  kemId: 32,
  kdf: "HKDF-SHA256",
  kdfId: 1,
  aead: "AES-256-GCM",
  aeadId: 2,
});
assert.deepEqual(
  fixture.contract.operations
    .filter((operation) => operation.binding === "hpke-bound-v1")
    .map((operation) => operation.id),
  [
    "pairing.poll",
    "pairing.exchange",
    "familiars.list",
    "projects.list",
    "conversations.list",
    "conversations.read",
    "messages.list",
  ],
);
assert.equal(
  JSON.stringify(fixture).match(
    /privateKey|secretKey|senderKey|recipientPrivateKey/gu,
  ),
  null,
);
```

Assert the main fixture points to `hpke-bound-v1-vectors.json` and `hpke-bound-v1-vectors.sha256`. Independently read the committed vector JSON/digest, recompute with `createClientV1HpkeBoundV1Vector()`, compare rendered bytes to the committed JSON, and compare the SHA-256 of those bytes to the committed digest. Do not read or compare vector values from this plan.

- [ ] **Step 2: Run and verify contract tests fail**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/contract.test.ts
node --test scripts/export-client-v1-contract.test.mjs
```

Expected: FAIL because the manifest and generated fixture do not yet contain authority data.

- [ ] **Step 3: Extend the manifest types and fixture builder**

Add:

```ts
export type ClientV1OperationManifestEntry = {
  id: string;
  method: string;
  path: string;
  ingress: string;
  scope: string | null;
  credential: ClientV1OperationCredential;
  binding: ClientV1OperationBinding;
  families: string[];
};

export type ClientV1ContractManifest = {
  apiVersion: typeof CLIENT_V1_API_VERSION;
  minimumClientVersion: typeof CLIENT_V1_MIN_CLIENT_VERSION;
  capabilities: ClientV1Capability[];
  operations: ClientV1OperationManifestEntry[];
  discovery: typeof CLIENT_V1_DISCOVERY_CONTRACT;
  authority: ClientV1AuthorityContract;
  pairingRequired: typeof CLIENT_V1_PAIRING_REQUIRED;
  pairingScopes: ClientV1Scope[];
  pairingSecretHeader: typeof CLIENT_V1_PAIRING_SECRET_HEADER;
  publicRoutes: ClientV1PublicRoute[];
  identityKinds: ClientV1IdentityKind[];
  errorCodes: ClientV1ErrorCode[];
  limits: typeof CLIENT_V1_LIMITS;
};
```

In the same change, extend `clientV1OperationRecords()` to copy `credential`
and `binding`. Regenerate and review `contract-fixture.json` and
`contract-fixture.sha256` only here, together with the exporter checks and docs.

Add `examples.discoveryRecordV2`. Keep `examples.discoveryRecord` as the current v1 example so existing readers still see the default. The authority manifest carries the two vector-fixture filenames; do not add the vector payload to `ClientV1ContractFixture`.

`contract.ts` may import runtime values only from `operations.ts` and the pure `authority-contract.ts`. Update the import-boundary test to pin exactly those two modules.

- [ ] **Step 4: Ratchet the exporter**

Add independent reviewed literals in `export-client-v1-contract.mjs`:

```js
export const REVIEWED_CLIENT_V1_HPKE_BOUND_OPERATIONS = Object.freeze([
  "pairing.poll",
  "pairing.exchange",
  "familiars.list",
  "projects.list",
  "conversations.list",
  "conversations.read",
  "messages.list",
]);

export const REVIEWED_CLIENT_V1_AUTHORITY_MODES = Object.freeze([
  "off",
  "advertise",
  "enforce",
]);
```

Require exact suite IDs, header map, bounds, response media type, and protected-operation list. Refuse any private-key-shaped field anywhere in the generated fixture.

- [ ] **Step 5: Regenerate and verify deterministic bytes**

Run:

```bash
node scripts/export-client-v1-contract.mjs
node scripts/export-client-v1-contract.mjs --check
node --test scripts/export-client-v1-contract.test.mjs
node scripts/export-client-v1-hpke-vectors.mjs --check
node --test scripts/export-client-v1-hpke-vectors.test.mjs
```

Expected: all commands exit 0; two consecutive exporter runs produce identical JSON and SHA-256.

- [ ] **Step 6: Document the exact wire contract**

Add normative sections to `docs/api/client-v1.md` covering:

- default-off compatibility;
- discovery v1 versus v2;
- mode table;
- suite names and numeric IDs;
- key-ID derivation;
- all request header names and bounds;
- canonical route and binary AAD;
- JCS request/response plaintext types;
- Base-mode request and Auth-mode response;
- the reviewed single-runtime X25519 Base-recipient/Auth-sender reuse rationale, including RFC mode separation, distinct request/response `info`/AAD domains, and separate one-direction contexts;
- 60-second age, 10-second future skew, 120-second replay TTL, 4096 cap;
- the `4096 / 120 = 34.133...` requests/second sustained-capacity calculation, 4096-request burst behavior, authenticated capacity `retry-after`, and fresh-envelope pagination retry rule;
- the single-process key/replay invariant and the requirement that future multi-worker operation use linearizable shared reservation or distinct unroutable authority endpoints;
- all error/status/trust rules;
- exact protected operation table;
- admin exclusion;
- the rule that only authenticated decrypted inner responses may trigger credential deletion/re-pair;
- the rule that advertise mode never falls back after a bound marker;
- secret-safe logging;
- vector fixture and SHA-file locations.

Do not describe `off` as deprecated or claim production enforcement is live.

- [ ] **Step 7: Extend the doc contract test**

Require literal presence of:

```js
[
  "hpke-bound-v1",
  "advertise",
  "enforce",
  "DHKEM(X25519, HKDF-SHA256)",
  "HKDF-SHA256",
  "AES-256-GCM",
  "Base-mode recipient",
  "Auth-mode sender",
  "4096 / 120 = 34.133",
  "single request-serving process",
  "linearizable",
  "x-coven-client-v1-authority",
  "x-coven-client-v1-authority-key-id",
  "x-coven-client-v1-authority-instance",
  "x-coven-client-v1-authority-runtime-nonce",
  "x-coven-client-v1-authority-request-nonce",
  "x-coven-client-v1-authority-issued-at",
  "x-coven-client-v1-authority-enc",
  "x-coven-client-v1-authority-ciphertext",
  "authority_unavailable",
  "hpke_binding_required",
  "authority_key_stale",
  "authority_instance_stale",
  "authority_request_stale",
  "authority_invalid",
  "authority_replayed",
  "authority_replay_capacity",
  "authority_response_failed",
  "hpke-bound-v1-vectors.json",
  "hpke-bound-v1-vectors.sha256",
]
```

Compare the documented protected-operation table to fixture `credential` and `binding` fields record by record.

- [ ] **Step 8: Run contract and documentation tests**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/contract.test.ts
node --test scripts/export-client-v1-contract.test.mjs
node --test scripts/export-client-v1-hpke-vectors.test.mjs
node --test scripts/client-v1-doc-contract.test.mjs
node scripts/export-client-v1-contract.mjs --check
node scripts/export-client-v1-hpke-vectors.mjs --check
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add \
  src/lib/server/client-v1/contract.ts \
  src/lib/server/client-v1/contract.test.ts \
  src/lib/server/client-v1/contract-fixture.json \
  src/lib/server/client-v1/contract-fixture.sha256 \
  scripts/export-client-v1-contract.mjs \
  scripts/export-client-v1-contract.test.mjs \
  scripts/export-client-v1-hpke-vectors.mjs \
  scripts/export-client-v1-hpke-vectors.test.mjs \
  docs/api/client-v1.md \
  scripts/client-v1-doc-contract.test.mjs
git commit \
  -m "docs(client-v1): publish HPKE authority contract" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 8: Add deterministic real-socket listener takeover proof

**Files:**
- Create: `scripts/client-v1-authority-takeover.mjs`
- Create: `scripts/client-v1-authority-takeover.test.mjs`
- Modify: `scripts/client-v1-conformance.mjs`
- Modify: `scripts/client-v1-conformance.test.mjs`
- Modify: `scripts/ci-paths.mjs`
- Modify: `scripts/ci-paths.test.mjs`
- Modify: `scripts/run-tests.mjs`
- Modify: `package.json`
- Modify: `docs/workflows/client-v1-conformance.md`

- [ ] **Step 1: Write failing pure harness tests**

Export predicates and assert:

```js
assert.deepEqual(
  inspectCapturedPlaintextRequest({
    headers: {
      "x-coven-pairing-secret": "pairing-secret-value",
    },
    body: "",
  }),
  {
    exposedPairingSecret: true,
    exposedBearer: false,
    hasBoundCiphertext: false,
  },
);

assert.deepEqual(
  inspectCapturedBoundRequest({
    headers: {
      "x-coven-client-v1-authority": "hpke-bound-v1",
      "x-coven-client-v1-authority-ciphertext": "ciphertext-value",
    },
    body: "",
  }),
  {
    exposedPairingSecret: false,
    exposedBearer: false,
    hasBoundCiphertext: true,
  },
);
```

Add a response-acceptance predicate that rejects plaintext 401, malformed outer JSON, random ciphertext, and Auth-mode ciphertext signed by a replacement key.

- [ ] **Step 2: Run and verify the harness test fails**

Run:

```bash
node --experimental-strip-types \
  --test \
  scripts/client-v1-authority-takeover.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement deterministic socket orchestration**

The script must:

1. require an existing release build (`server.mjs` and `.next/BUILD_ID`);
2. create all scratch state under `path.join(repositoryRoot, ".scratch-client-v1-authority-takeover-")`;
3. choose a free loopback port;
4. start Cave with a dedicated home and `COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE=off`;
5. create a pairing request and retain its secret in harness memory;
6. stop Cave and wait for the process and listener to close;
7. bind a fake HTTP listener to the exact same host/port;
8. send the legacy exchange request;
9. assert the fake listener captured the exact plaintext pairing secret;
10. stop the fake listener;
11. start a fresh Cave fixture with `COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE=enforce`;
12. read discovery v2 and health, create a second pairing request, and build a bound exchange with the test-only codec;
13. stop Cave and wait for closure;
14. bind a second fake listener to the same host/port;
15. send the already-built bound request;
16. assert the fake listener sees no pairing-secret/bearer header or body value and sees only HPKE metadata/ciphertext;
17. attempt to open the request with a newly generated replacement private key and assert failure;
18. return a plaintext 401 and assert the client decoder refuses it as unauthenticated;
19. give the fake harness the client response public key only for the stronger forgery mutation, Auth-encrypt a response with the replacement sender private key, and assert the client rejects it against the old Cave discovery public key;
20. cleanly close listeners/processes and remove the scratch root in `finally`.

No timing race is accepted: every transition awaits process exit and fake-listener `listening` before sending.

Export `freePort`, `startCave`, `stopCave`, `requestOnce`, and the minimum isolated-home seeding helper from `scripts/client-v1-conformance.mjs`. Extend `startCave` with:

```js
export async function startCave({
  port,
  caveHomeDir,
  covenHomeDir,
  adminToken,
  authorityMode = "off",
}) {
  const env = {
    ...process.env,
    NODE_ENV: "production",
    COVEN_HOME: covenHomeDir,
    COVEN_CAVE_HOME: caveHomeDir,
    COVEN_CAVE_PORT: String(port),
    COVEN_CAVE_HEAP_MONITOR: "0",
    COVEN_CAVE_CLIENT_V1_AUTHORITY_MODE: authorityMode,
  };
  delete env.COVEN_CAVE_BUNDLE;
  delete env.COVEN_CAVE_ACCESS_TOKEN;
  delete env.COVEN_CAVE_PASSKEY_REQUIRED;
  delete env.COVEN_CAVE_CLIENT_V1_INSTANCE_ID;
  delete env.PORT;
  if (adminToken) env.COVEN_CAVE_AUTH_TOKEN = adminToken;
  else delete env.COVEN_CAVE_AUTH_TOKEN;

  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: repositoryRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  child.stdout.on("data", (chunk) => log.push(chunk.toString()));
  child.stderr.on("data", (chunk) => log.push(chunk.toString()));

  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120_000;
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`Cave exited before it was ready:\n${log.join("")}`);
    }
    try {
      const response = await requestOnce(origin, {
        path: `${CLIENT_V1_PREFIX}/health`,
      });
      if (response.status === 200) {
        return { child, origin, log, port };
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `Cave did not answer ${origin}${CLIENT_V1_PREFIX}/health within 120s:\n${log.join("")}`,
  );
}
```

The focused harness uses a capture listener:

```js
async function startCaptureListener(port, responder) {
  const captures = [];
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      const capture = {
        method: request.method ?? "",
        url: request.url ?? "",
        headers: { ...request.headers },
        body: Buffer.concat(chunks),
      };
      captures.push(capture);
      const reply = await responder(capture);
      response.writeHead(reply.status, reply.headers);
      response.end(reply.body);
    });
  });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  return {
    captures,
    close: () => new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())),
  };
}
```

The main sequence is explicit:

```js
const scratchRoot = await mkdtemp(
  path.join(repositoryRoot, ".scratch-client-v1-authority-takeover-"),
);
let cave = null;
let replacement = null;
try {
  const port = await freePort();
  const homes = await seedAuthorityTakeoverHome(scratchRoot);

  cave = await startCave({
    port,
    ...homes,
    adminToken: null,
    authorityMode: "off",
  });
  const legacyPairing = await createPairing(cave.origin);
  await stopCave(cave, port);
  cave = null;

  replacement = await startCaptureListener(
    port,
    plaintextUnauthorizedResponder,
  );
  await sendLegacyExchange(caveOrigin(port), legacyPairing);
  assertLegacySecretExposure(replacement.captures[0], legacyPairing.secret);
  await replacement.close();
  replacement = null;

  cave = await startCave({
    port,
    ...homes,
    adminToken: null,
    authorityMode: "enforce",
  });
  const discovery = await readAuthorityDiscovery(homes.caveHomeDir);
  const health = await readHealthEnvelope(cave.origin);
  const boundPairing = await createPairing(cave.origin);
  await proveBoundPollSucceeds({
    origin: cave.origin,
    discovery,
    instanceId: health.data.instanceId,
    pairing: boundPairing,
  });
  const prepared = await prepareBoundExchange({
    origin: cave.origin,
    discovery,
    instanceId: health.data.instanceId,
    pairing: boundPairing,
  });
  await stopCave(cave, port);
  cave = null;

  replacement = await startForgingCaptureListener(port, prepared);
  await proveReplacementCannotSatisfy(prepared, replacement);
} finally {
  if (replacement) await replacement.close();
  if (cave) await stopCave(cave, cave.port);
  await rm(scratchRoot, { recursive: true, force: true });
}
```

Use these concrete helpers:

```js
const caveOrigin = (port) => `http://127.0.0.1:${port}`;

async function seedAuthorityTakeoverHome(scratchRoot) {
  const covenHomeDir = path.join(scratchRoot, "coven");
  const caveHomeDir = path.join(covenHomeDir, "cave");
  await mkdir(caveHomeDir, { recursive: true });
  return { covenHomeDir, caveHomeDir };
}

async function createPairing(origin) {
  const body = JSON.stringify({
    appName: "Authority takeover harness",
    installationId: "authority-takeover-harness",
    scopes: ["chat:read"],
  });
  const response = await requestOnce(origin, {
    method: "POST",
    path: "/api/client/v1/pairing/requests",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
    },
    body,
  });
  assert.equal(response.status, 201);
  return response.json.data;
}

async function readAuthorityDiscovery(caveHomeDir) {
  return JSON.parse(
    await readFile(
      path.join(caveHomeDir, "client-v1-discovery.json"),
      "utf8",
    ),
  );
}

async function readHealthEnvelope(origin) {
  const response = await requestOnce(origin, {
    method: "GET",
    path: "/api/client/v1/health",
  });
  assert.equal(response.status, 200);
  return response.json;
}

async function sendLegacyExchange(origin, pairing) {
  return requestOnce(origin, {
    method: "POST",
    path: `/api/client/v1/pairing/requests/${pairing.requestId}/exchange`,
    headers: {
      "content-length": "0",
      "x-coven-pairing-secret": pairing.secret,
    },
    body: "",
  });
}
```

Build bound requests with the shared test codec:

```js
async function prepareBoundRequest({
  origin,
  discovery,
  instanceId,
  pairing,
  operation,
  path: requestPath,
  method,
}) {
  return createClientV1HpkeTestClient({
    authority: discovery.authority,
    instanceId,
    runtimeNonce: discovery.nonce,
    operation,
    url: new URL(requestPath, origin).href,
    method,
    body: new Uint8Array(),
    issuedAt: Date.now(),
    authorization: {
      kind: "pairing-secret",
      value: pairing.secret,
    },
  });
}

async function proveBoundPollSucceeds(input) {
  const prepared = await prepareBoundRequest({
    ...input,
    operation: "pairing.poll",
    path: `/api/client/v1/pairing/requests/${input.pairing.requestId}`,
    method: "GET",
  });
  const inner = await prepared.open(await fetch(prepared.request));
  assert.equal(inner.status, 200);
}

async function prepareBoundExchange(input) {
  return prepareBoundRequest({
    ...input,
    operation: "pairing.exchange",
    path:
      `/api/client/v1/pairing/requests/${input.pairing.requestId}/exchange`,
    method: "POST",
  });
}
```

`createClientV1HpkeTestClient` sets `content-length: 0` for the bodyless POST and exposes only public binding/AAD bytes plus the client-owned response public key to the harness.

Create the replacement mutations:

```js
function plaintextUnauthorizedResponder() {
  return {
    status: 401,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: "replacement listener" }),
  };
}

async function replacementCannotOpen(capture, prepared, replacementKeyPair) {
  await assert.rejects(async () => {
    const suite = createClientV1HpkeSuite();
    const recipient = await suite.createRecipientContext({
      recipientKey: replacementKeyPair.privateKey,
      enc: base64UrlDecode(
        capture.headers[CLIENT_V1_HPKE_HEADERS.enc],
        { minimum: 32, maximum: 32 },
      ).bytes,
      info: CLIENT_V1_HPKE_REQUEST_INFO,
    });
    const ciphertext = base64UrlDecode(
      capture.headers[CLIENT_V1_HPKE_HEADERS.ciphertext],
      { minimum: 16, maximum: 2048 },
    ).bytes;
    await recipient.open(ciphertext, prepared.requestAad);
  });
}

async function forgeReplacementResponse(prepared, replacementKeyPair) {
  const suite = createClientV1HpkeSuite();
  const responsePublicKey = await suite.kem.deserializePublicKey(
    prepared.responsePublicKey,
  );
  const sender = await suite.createSenderContext({
    recipientPublicKey: responsePublicKey,
    senderKey: replacementKeyPair.privateKey,
    info: CLIENT_V1_HPKE_RESPONSE_INFO,
  });
  const plaintext = new TextEncoder().encode(canonicalize({
    body: base64UrlEncode(new TextEncoder().encode(
      JSON.stringify({ error: "forged" }),
    )),
    headers: { contentType: "application/json" },
    requestNonce: prepared.binding.requestNonce,
    status: 401,
    version: 1,
  }));
  const ciphertext = await sender.seal(
    plaintext,
    prepared.responseAad,
  );
  return {
    status: 200,
    headers: {
      "content-type":
        "application/vnd.opencoven.client-v1.hpke-bound-v1+json",
    },
    body: JSON.stringify({
      version: 1,
      mechanism: "hpke-bound-v1",
      keyId: prepared.binding.keyId,
      requestNonce: prepared.binding.requestNonce,
      enc: base64UrlEncode(sender.enc),
      ciphertext: base64UrlEncode(ciphertext),
    }),
  };
}
```

Generate the two fake replies with:

```js
async function startForgingCaptureListener(port, prepared) {
  const suite = createClientV1HpkeSuite();
  const replacementKeyPair = await suite.kem.generateKeyPair();
  let requestCount = 0;
  const listener = await startCaptureListener(port, async () => {
    requestCount += 1;
    return requestCount === 1
      ? plaintextUnauthorizedResponder()
      : forgeReplacementResponse(prepared, replacementKeyPair);
  });
  return { ...listener, replacementKeyPair };
}
```

The proof is:

```js
async function proveReplacementCannotSatisfy(prepared, replacement) {
  const plaintext = await fetch(prepared.request.clone());
  await assert.rejects(prepared.open(plaintext));

  const forged = await fetch(prepared.request.clone());
  await assert.rejects(prepared.open(forged));

  const capture = replacement.captures[0];
  assertCiphertextOnly(capture);
  await replacementCannotOpen(
    capture,
    prepared,
    replacement.replacementKeyPair,
  );
}
```

`assertLegacySecretExposure` and `assertCiphertextOnly` compare exact header/body presence and record only the fixed assertion IDs listed in Step 5.

- [ ] **Step 4: Add one live success control**

Before replacing the enforce-mode listener, send one valid bound protected request to the real Cave and assert:

- outer status 200;
- exact bound media type;
- Auth-mode open succeeds against the discovery public key;
- inner Client v1 envelope/status is valid.

This prevents a harness that proves only that every bound request fails.

- [ ] **Step 5: Keep evidence secret-free**

Printed assertions may state:

```text
ok takeover.legacy.exposes-pairing-secret
ok takeover.bound.exposes-ciphertext-only
ok takeover.bound.replacement-cannot-open
ok takeover.bound.plaintext-response-rejected
ok takeover.bound.forged-auth-response-rejected
```

Never print captured headers, secret/bearer values, ciphertext, private/public key bytes, nonce, response plaintext, or scratch contents. On failure, print only the assertion ID and fixed reason.

- [ ] **Step 6: Add package and conformance integration**

Add:

```json
"test:client-v1:authority-takeover": "node --experimental-strip-types scripts/client-v1-authority-takeover.mjs"
```

Extend conformance argument parsing:

```js
if (flag === "--include-authority-takeover") {
  options.includeAuthorityTakeover = true;
  continue;
}
```

When absent, record one explicit skip. When present, run the focused harness and translate all five assertion IDs into the conformance recorder. Add `authorityMode`, discovery version, and mechanism to the evidence context without adding key/nonce/ciphertext values.

- [ ] **Step 7: Wire CI path and API test manifests**

Add both `export-client-v1-hpke-vectors(.test).mjs` and `client-v1-authority-takeover(.test).mjs` to `CLIENT_V1_PATH`, append the pure tests to the API suite, add the takeover test to `STRIP_TYPES_MJS` because the harness imports the TypeScript test client, and add negative `ci-paths.test.mjs` cases showing unrelated scripts do not enter the lane.

- [ ] **Step 8: Document exact commands**

Add to `docs/workflows/client-v1-conformance.md`:

```bash
pnpm build
pnpm test:client-v1:authority-takeover
node scripts/client-v1-conformance.mjs --include-authority-takeover
```

State that the first command builds the artifact, the focused command proves the listener-takeover property, and the conformance command records it alongside current Client v1 behavior. State that this is Cave-only evidence and does not prove SDK or Chat integration.

- [ ] **Step 9: Run pure harness tests**

Run:

```bash
node --experimental-strip-types \
  --test \
  scripts/client-v1-authority-takeover.test.mjs
node --test scripts/client-v1-conformance.test.mjs
node --test scripts/ci-paths.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Run the release-build takeover proof**

Run:

```bash
pnpm build
pnpm test:client-v1:authority-takeover
```

Expected: five `ok takeover.*` lines, no secret-bearing output, exit 0.

- [ ] **Step 11: Commit**

```bash
git add \
  scripts/client-v1-authority-takeover.mjs \
  scripts/client-v1-authority-takeover.test.mjs \
  scripts/client-v1-conformance.mjs \
  scripts/client-v1-conformance.test.mjs \
  scripts/ci-paths.mjs \
  scripts/ci-paths.test.mjs \
  scripts/run-tests.mjs \
  package.json \
  docs/workflows/client-v1-conformance.md
git commit \
  -m "test(client-v1): prove HPKE listener takeover safety" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 9: Verify package closure, full Client v1 behavior, and release safety

**Files:**
- Modify only if a failing validation identifies a change directly required by this feature.

- [ ] **Step 1: Verify generated artifacts and test wiring**

Run:

```bash
node scripts/export-client-v1-contract.mjs --check
node scripts/export-client-v1-hpke-vectors.mjs --check
pnpm check:tests-wired
pnpm test:supply-chain
```

Expected: all exit 0.

- [ ] **Step 2: Run focused authority tests together**

Run:

```bash
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/authority-contract.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/hpke-bound-v1.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/authority-replay.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  --import ./scripts/test-alias-register.mjs \
  src/lib/server/client-v1/authority-runtime.test.ts
node --require ./scripts/css-source-contract-hook.cjs \
  --experimental-strip-types \
  src/lib/server/client-v1/discovery.test.ts
node --experimental-strip-types \
  --test \
  scripts/client-v1-authority-takeover.test.mjs
```

Expected: PASS.

- [ ] **Step 3: Run the complete API suite**

Run:

```bash
pnpm test:api
```

Expected: PASS, including every existing Client v1 default-off route assertion.

- [ ] **Step 4: Run static validation**

Run:

```bash
pnpm lint:source
pnpm typecheck
```

Expected: PASS with no warning suppression and no `any` added to authority modules.

- [ ] **Step 5: Verify standalone and packaged dependency closure**

Run:

```bash
pnpm build
node --test scripts/sidecar-runtime-closure.test.mjs
pnpm test:sidecar-runtime
```

Expected:

- release build succeeds;
- Task 5's assembled-runtime probe resolves `@hpke/core`,
  `@hpke/dhkem-x25519`, and pinned `@hpke/common`, initializes the production
  suite, and generates an X25519 keypair;
- the packaged runtime smoke starts default-off with discovery v1, then starts
  in enforce mode and publishes discovery v2;
- no native addon or platform-specific binary is introduced;
- existing runtime-size budgets pass. If the traced pure-JS package bytes exceed a budget, update the reviewed budget by the measured delta in the same implementation change and explain it in the commit.

- [ ] **Step 6: Run release-smoke contract tests and live authority smoke**

Run:

```bash
node --test scripts/client-v1-release-smoke.test.mjs
pnpm test:client-v1:authority-takeover
```

Expected:

- release-smoke expectations keep the default health contract unchanged and read `defaultMode: "off"` from the generated fixture;
- the Task 8 takeover harness independently observes discovery v1 in its
  legacy phase and discovery v2 in its enforce phase, beyond Task 5's packaged
  startup smoke;
- no private field appears;
- both commands exit 0.

- [ ] **Step 7: Run takeover proof one final time**

Run:

```bash
pnpm test:client-v1:authority-takeover
```

Expected: exit 0 with the five fixed assertion lines.

- [ ] **Step 8: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat origin/main...HEAD
git diff origin/main...HEAD -- \
  .gitattributes \
  package.json \
  pnpm-lock.yaml \
  server.ts \
  src/lib/server/client-v1 \
  src/app/api/client/v1 \
  src/app/api/api-contracts.test.ts \
  scripts \
  docs/api/client-v1.md \
  docs/workflows/client-v1-conformance.md
```

Expected: no unrelated production surface, no private-key literal, no generated-artifact drift, and no uncommitted scratch directory.

- [ ] **Step 9: Commit any directly required validation fix**

If every validation passed without edits, do not create an empty commit. If a directly related build/test fix was required:

```bash
git add \
  .gitattributes \
  package.json \
  pnpm-lock.yaml \
  server.ts \
  src/lib/server/client-v1 \
  src/app/api/client/v1 \
  src/app/api/api-contracts.test.ts \
  scripts/dependency-policy.test.mjs \
  scripts/export-client-v1-contract.mjs \
  scripts/export-client-v1-contract.test.mjs \
  scripts/export-client-v1-hpke-vectors.mjs \
  scripts/export-client-v1-hpke-vectors.test.mjs \
  scripts/client-v1-doc-contract.test.mjs \
  scripts/client-v1-release-smoke.mjs \
  scripts/client-v1-release-smoke.test.mjs \
  scripts/client-v1-authority-takeover.mjs \
  scripts/client-v1-authority-takeover.test.mjs \
  scripts/client-v1-conformance.mjs \
  scripts/client-v1-conformance.test.mjs \
  scripts/ci-paths.mjs \
  scripts/ci-paths.test.mjs \
  scripts/run-tests.mjs \
  docs/api/client-v1.md \
  docs/workflows/client-v1-conformance.md
git commit \
  -m "fix(client-v1): complete HPKE authority validation" \
  -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## SDK, Chat, and enforcement handoff gates

This Cave plan ends after producer primitives, opt-in enforcement, contract truth, vectors, and Cave-only conformance. It does not schedule or implement work in another repository.

### SDK handoff requirements

The SDK change may start only from a Cave commit whose following commands pass:

```bash
node scripts/export-client-v1-contract.mjs --check
pnpm test:client-v1:authority-takeover
```

Handoff artifacts:

1. exact Cave commit SHA;
2. exact `src/lib/server/client-v1/contract-fixture.json`;
3. exact `src/lib/server/client-v1/contract-fixture.sha256`;
4. exact `src/lib/server/client-v1/hpke-bound-v1-vectors.json`;
5. exact `src/lib/server/client-v1/hpke-bound-v1-vectors.sha256`;
6. suite IDs `32/1/2`;
7. discovery-v2 schema;
8. exact header map;
9. canonical route, binary AAD, and JCS rules;
10. error/trust matrix;
11. protected operation list.

Artifacts 4 and 5 are the sole normative cryptographic vector handoff. The plan’s rendered vector block is review evidence only and must not be vendored, parsed, copied into tests, or used to resolve a mismatch. Any mismatch is resolved against the vector JSON bytes at the handed-off Cave commit and their committed SHA-256.

SDK acceptance must demonstrate, against Cave `advertise` and `enforce` modes:

- direct and managed transports produce vector-identical AAD and deterministic test ciphertext;
- pairing poll/exchange and all five bearer reads send no plaintext secret/bearer;
- Auth-mode responses verify against the discovery Cave key;
- plaintext/replacement/forged responses cannot trigger credential deletion or re-pair;
- stale key causes bounded rediscovery, never plaintext fallback;
- bootstrap-unavailable 503 preserves credentials and never causes plaintext fallback;
- authenticated replay-capacity 503 honors `retry-after` and retries the logical page/operation with a fresh nonce/time;
- vendored fixture bytes and SHA equal the Cave artifacts exactly.

### Chat Rust adapter handoff requirements

Chat receives the same immutable committed JSON/SHA artifacts after SDK codec behavior is frozen. Its adapter must prove RFC 9180 suite parity, exact canonical encoding, response Auth verification, and secret-free diagnostics. Chat does not use plan prose as vector truth and does not invent a second wire format, alternate suite, alternate key ID, or JSON-order convention.

### Later enforcement flip requirements

Do not change Cave’s default from `off` in this slice. A later Cave change may move through `advertise` to `enforce` only after:

1. released SDK direct and managed clients accept discovery v2;
2. released Chat Rust adapter accepts discovery v2;
3. both vendor the exact Cave fixture SHA;
4. cross-repository real-socket conformance passes pairing poll, exchange, and all five reads;
5. downgrade tests prove neither client sends plaintext after seeing v2;
6. response-forgery tests prove unauthenticated 401/403/409 cannot trigger destructive client state;
7. minimum-client-version and migration policy are reviewed for existing installations;
8. release notes state the enforcement date and recovery path.

The enforcement flip is a separate compatibility decision and separate implementation plan.
