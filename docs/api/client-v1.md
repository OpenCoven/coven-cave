# Client v1 HTTP API

The versioned surface an external application uses to talk to a running Cave.
It exists so a separate client — the OpenCoven chat app, a native iOS build, a
script — can obtain a credential from a Cave the user is sitting in front of,
without that client being part of the Cave build and without it being handed
the desktop shell's own per-launch secret.

**Read the scope line before you read anything else.** As of this commit the
surface is thirteen routes: a credential-free health handshake, three pairing
routes that walk a client through create, secret-authorized poll/exchange, and
finally "holding a bearer", four administrator routes that let the Cave's own
settings UI see and decide those requests, and **five canonical reads** a bearer
actually opens — familiars, projects, conversations, one conversation, and that
conversation's messages.

Every read is a `GET` and requires the `chat:read` scope. The four list reads
are paged with an opaque cursor; `conversations.read` returns one record and
rejects paging parameters. **Everything else is still unbuilt**: there is no
write route, no streaming route, no attachment route, and the other five scopes
(`chat:write`, `conversations:write`, `attachments:write`, `tasks:write`,
`github:write`) are recorded on a credential and read by nothing.

## Where the contract actually lives

This document describes behaviour; it is not the authority for it. When the two
disagree, the code is right and this file is stale.

Three places where they *did* disagree are marked ⚠️ below. They were found by
[the real-authority conformance run](../workflows/client-v1-conformance.md),
which drives this surface over a real socket against a release build — the only
vantage point from which the listener, `proxy.ts` and Next's own request
handling are visible at all.

| Concern | Authority |
|---|---|
| Versions, scopes, capabilities, operation ids, error codes, limits, public-route list | [`src/lib/server/client-v1/contract.ts`](../../src/lib/server/client-v1/contract.ts) |
| HPKE modes, suite, headers, bounds, freshness, protected operations, and vector filenames | [`src/lib/server/client-v1/authority-contract.ts`](../../src/lib/server/client-v1/authority-contract.ts) |
| Which method, path, authority, credential, binding, and scope each operation names | [`src/lib/server/client-v1/operations.ts`](../../src/lib/server/client-v1/operations.ts) |
| Byte-pinned export of all of the above, plus example envelopes | [`contract-fixture.json`](../../src/lib/server/client-v1/contract-fixture.json) and its `.sha256` |
| Normative deterministic HPKE handoff bytes | [`hpke-bound-v1-vectors.json`](../../src/lib/server/client-v1/hpke-bound-v1-vectors.json) and [`hpke-bound-v1-vectors.sha256`](../../src/lib/server/client-v1/hpke-bound-v1-vectors.sha256) |
| Who may reach which route, and from where | [`src/proxy.ts`](../../src/proxy.ts) and [`src/proxy-helpers.ts`](../../src/proxy-helpers.ts) |
| Per-route request and response shapes | the thirteen `route.ts` files under `src/app/api/client/v1/` |
| Storage, lifetimes, hashing | `pairing-store.ts`, `credential-store.ts`, `instance-id.ts` |
| The discovery record a client reads to find the endpoint | [`server.ts`](../../server.ts) — **not** `client-v1/discovery.ts`, which nothing in production calls |

The fixture is generated, not hand-written: `node scripts/export-client-v1-contract.mjs`
rewrites it from `contract.ts`, and `--check` runs as a preflight to the `api`
test suite, so a contract change that does not regenerate the fixture fails CI
rather than shipping a stale artifact. A client that wants machine-readable
constants should vendor the fixture, not re-type the tables below.

`scripts/client-v1-doc-contract.test.mjs` pins *this document* to both — every
route file on disk and every entry in the contract's `publicRoutes`, every
scope, and every error code must appear here, so a fourteenth route cannot land
undocumented. It also compares the operation table in *Capability discovery*
against the fixture record by record, so a method, path or authority class that
moves fails here rather than leaving a client author reading a table that
describes a previous build.

## HPKE-bound credential authority

Client v1 can carry the pairing secret or bearer inside an HPKE request and
authenticate the response from the same discovered Cave runtime. The mechanism
identifier is exactly `hpke-bound-v1`.

This is an additive, default-off compatibility contract. The default mode remains `off`;
`off` is not deprecated. Existing v1 clients keep using the v1
discovery record and plaintext credential headers unless an operator explicitly
selects an active mode. This publication does not claim that enforcement is
live or the production default.

### Discovery versions and modes

Discovery always uses `client-v1-discovery.json` with owner-only mode `0600`.
The discovery contract itself remains version `1` and declares
`hpkeBoundVersion: 2`:

- discovery record v1 contains `version`, `endpoint`, `pid`, `nonce`, and
  `startedAt`;
- discovery record v2 contains those fields plus public `authority` metadata:
  `mechanism`, `mode`, `keyId`, `publicKey`, and the three numeric suite IDs.

`nonce`, `keyId`, and `publicKey` in v2 are canonical unpadded base64url
encodings of exactly 32 bytes. A v2 record and every generated contract
artifact must not contain `privateKey`, `secretKey`, `senderKey`, or
`recipientPrivateKey`.

| Mode | Discovery | Missing marker on a protected operation | Present marker |
|---|---|---|---|
| `off` | v1 | Legacy plaintext behavior | The authority wrapper is inactive; compatibility behavior is unchanged. |
| `advertise` | v2 | Legacy plaintext behavior, but only while the boot authority is available | Exact `hpke-bound-v1` is opened and Auth-sealed. Once any marker is present, advertise mode never falls back to plaintext. |
| `enforce` | v2 | Plaintext `426 incompatible_version` with `hpke_binding_required` | Exact `hpke-bound-v1` is required and opened; any other value is invalid. |

In either active mode, unavailable boot key material returns plaintext
`503 service_unavailable` with `authority_unavailable` before credential
parsing, replay/rate-limit charging, store access, or a route callback. It is
not equivalent to `off`. An active mode publishes v2 only when the boot
authority was created successfully.

### Suite and key identity

| Component | Name | Numeric ID |
|---|---|---:|
| KEM | `DHKEM(X25519, HKDF-SHA256)` | `32` (`0x0020`) |
| KDF | `HKDF-SHA256` | `1` (`0x0001`) |
| AEAD | `AES-256-GCM` | `2` (`0x0002`) |

The runtime derives its 32-byte key ID once at boot:
the manifest names this rule
`sha256-domain-separated-public-key-v1`.

```text
SHA-256(
  UTF8("OpenCoven/client-v1/hpke-bound-v1/key-id\0")
  || SerializePublicKey(runtimeRecipientPublicKey)
)
```

Discovery publishes the canonical unpadded base64url result. Every process
creates a fresh X25519 keypair and therefore a fresh key ID, even though the
installation `instanceId` remains stable.

### Request headers and exact bounds

Every bound request carries these exact headers:

| Field | Header |
|---|---|
| mechanism | `x-coven-client-v1-authority` |
| key ID | `x-coven-client-v1-authority-key-id` |
| instance ID | `x-coven-client-v1-authority-instance` |
| runtime nonce | `x-coven-client-v1-authority-runtime-nonce` |
| request nonce | `x-coven-client-v1-authority-request-nonce` |
| issued at | `x-coven-client-v1-authority-issued-at` |
| encapsulated key | `x-coven-client-v1-authority-enc` |
| ciphertext | `x-coven-client-v1-authority-ciphertext` |

The mechanism is exact ASCII `hpke-bound-v1`. Key ID, runtime nonce, request
nonce, and encapsulated key are canonical unpadded base64url of 32 bytes and
therefore 43 characters. The instance header is canonical base64url of the
UTF-8 `instanceId`, with a decoded length of 1 through 256 bytes. `issuedAt` is
1 through 16 decimal epoch-millisecond digits, with no sign or leading zero,
and must be a safe positive integer. Ciphertext is canonical base64url of
16 through 2048 decoded bytes.

| Bound | Exact value |
|---|---:|
| raw key bytes | `32` |
| encoded key characters | `43` |
| request plaintext bytes | `1024` |
| request ciphertext bytes | `2048` |
| request body bytes | `65536` |
| response plaintext bytes | `8388608` |
| response ciphertext bytes | `8388624` |
| response envelope bytes | `11185056` |
| canonical route bytes | `2048` |
| instance id bytes | `256` |
| maximum age milliseconds | `60000` |
| maximum future skew milliseconds | `10000` |
| replay TTL milliseconds | `120000` |
| replay capacity | `4096` |

The route's ordinary body remains outside the credential plaintext. Cave reads
at most 65,536 exact body bytes, hashes those bytes with SHA-256, and
reconstructs the request for the route. All seven currently protected
operations require an empty body.

### Canonical route and binary AAD

The canonical route mode is `rfc3986-sorted-query-v1`. Cave takes the actual
request URL, refuses `%` or `\` in the pathname, decodes query names and values
with `URLSearchParams`, then RFC 3986-encodes each component with uppercase hex,
`%20` for spaces, and escaping for `!'()*`. Each name and value is encoded before sorting.
The already-encoded ASCII pairs are sorted by encoded name and
then encoded value using byte/code-unit order, joined with `=` and `&`, and
never encoded a second time.

AAD uses `u32be-length-prefixed-v1`, not JSON. Every variable field is a
four-byte unsigned big-endian byte length followed by its bytes; `issuedAt` is
first encoded as unsigned 64-bit big-endian and then framed like the others.
Request AAD is:

```text
UTF8("OpenCoven/client-v1/hpke-bound-v1/aad/request\0")
|| frame(ASCII(uppercase method))
|| frame(UTF8(canonical route))
|| frame(SHA-256(exact request body))
|| frame(UTF8(decoded instanceId))
|| frame(runtime nonce bytes)
|| frame(key ID bytes)
|| frame(request nonce bytes)
|| frame(uint64be(issuedAt))
```

Response AAD uses the same fields and order with
`OpenCoven/client-v1/hpke-bound-v1/aad/response\0`. Host, port, PID, and timing
alone are not authority. The response AAD is rebuilt from the stored request
binding, never from untrusted outer response fields.

### Canonical plaintext and HPKE direction

The request encoding is `headers-plus-rfc8785-json`. The Base-mode request
plaintext is RFC 8785 JCS UTF-8 with exactly these properties:

```json
{
  "version": 1,
  "authorization": {
    "kind": "pairing-secret",
    "value": "<existing pairing secret parser>"
  },
  "responsePublicKey": "<fresh 32-byte X25519 public key, base64url>"
}
```

`authorization.kind` is exactly `pairing-secret` or `bearer`. The bearer keeps
its existing 512-character maximum. Unknown/missing properties, noncanonical
JSON bytes, a wrong key length, and duplicate plaintext credential headers are
rejected.

The Cave opens requests in RFC 9180 Base mode with:

```text
OpenCoven/client-v1/hpke-bound-v1/request
```

The response plaintext is RFC 8785 JCS UTF-8 with exactly:

```json
{
  "version": 1,
  "requestNonce": "<the request nonce>",
  "status": 200,
  "headers": {
    "contentType": "application/json",
    "retryAfter": "optional authenticated seconds"
  },
  "body": "<base64url of the exact inner Client v1 response bytes>"
}
```

Only `content-type` and optional `retry-after` cross the wrapper. The Cave seals
that plaintext in RFC 9180 Auth mode with:

```text
OpenCoven/client-v1/hpke-bound-v1/response
```

The outer status is always 200 after a successful request open, with media type
`application/vnd.opencoven.client-v1.hpke-bound-v1+json` and `Cache-Control:
no-store`. Application semantics come only from the authenticated inner status
and body.

The outer JSON envelope has exactly `version: 1`, `mechanism:
"hpke-bound-v1"`, `keyId`, `requestNonce`, `enc`, and `ciphertext`. Before
opening it, the client compares mechanism, key ID, and request nonce with its
outstanding request, then uses only `enc` and `ciphertext` as HPKE inputs. A
forged envelope cannot choose the identity or AAD used to verify itself.

One per-runtime X25519 keypair safely serves as the Base-mode recipient for
requests and the Auth-mode sender for responses. RFC 9180 includes a different
mode byte in each key schedule (`0x00` Base versus `0x02` Auth); request and
response have distinct `info` strings and AAD domains; and each open/seal uses
a separate one-direction context with a fresh peer ephemeral or response key.
No AEAD context, sequence number, key, or nonce is reused. The private key is
never serialized or used outside HPKE.

### Freshness, replay, capacity, and process ownership

`issuedAt` is accepted inclusively from 60 seconds old through 10 seconds in
the future. The request nonce is 32 random bytes. After a successful open and
canonical validation, Cave synchronously reserves `keyId:requestNonce` for 120
seconds before any credential parser, store, rate limiter, read source, or
route callback. A duplicate remains rejected even when the first route result
was an error.

The replay map holds 4096 live entries and never evicts one early. Its
steady-state protected-request capacity is `4096 / 120 = 34.133...` requests
per second. An empty map may accept a burst of 4096 unique requests; the 4097th
gets an Auth-encrypted inner `503 service_unavailable` with
`authority_replay_capacity`. For a same-instant burst the authenticated
`retry-after` is 120 seconds.

The client preserves its credential and cursor, waits for the authenticated
delay, and retries the same logical operation with a fresh nonce, current
timestamp, and freshly sealed envelope. It never replays the rejected
ciphertext. Pagination may retain accepted pages, but retries the rejected page
from the same cursor with that fresh envelope; the rejected attempt never
reaches the bearer store, rate limiter, or read source.

The published key and replay map must belong to a single request-serving process.
A future multi-worker deployment must use a linearizable shared nonce
reservation and coordinated key ownership, or distinct unroutable authority
endpoints per process. If ownership cannot be proved, active modes fail closed
as unavailable; they do not use process-local replay maps behind one advertised
endpoint.

### Errors, trust, consumer actions, and logs

| Condition | Outer HTTP | Inner/application result | Authenticated | Required consumer action |
|---|---:|---|---|---|
| Active boot authority unavailable | 503 | `service_unavailable` / `authority_unavailable` | no | Preserve credentials; rediscover/back off; do not retry plaintext. |
| `enforce` marker absent | 426 | `incompatible_version` / `hpke_binding_required` | no | Rediscover or upgrade; preserve the credential. |
| Marker present but not exact `hpke-bound-v1` | 400 | `invalid_request` / `authority_invalid` | no | Treat as transport failure; never retry plaintext. |
| Key ID or runtime nonce is stale | 409 | `conflict` / `authority_key_stale` | no | Rediscover once; never send plaintext. |
| Installation identity is stale | 409 | `conflict` / `authority_instance_stale` | no | Discard the endpoint association and rediscover. |
| Timestamp is stale or too far future | 409 | `conflict` / `authority_request_stale` | no | Retry once with a fresh nonce and time. |
| Malformed field, key, ciphertext, AAD, body hash, plaintext, or HPKE open | 400 | `invalid_request` / `authority_invalid` | no | Treat as unauthenticated transport failure. |
| Post-open freshness reservation is stale | 200 | inner 409 `conflict` / `authority_request_stale` | yes | Retry once with a fresh nonce and time. |
| Replay after successful open | 200 | inner 409 `conflict` / `authority_replayed` | yes | Generate a new request nonce; do not replay. |
| Replay map at capacity | 200 | inner 503 `service_unavailable` / `authority_replay_capacity` | yes | Honor inner `retry-after`; retry with a fresh envelope. |
| Existing route result | 200 | unchanged inner status/code/body | yes | Apply only after Auth verification. |
| Cave cannot seal the response | 500 | `internal_error` / `authority_response_failed` | no | Treat as unauthenticated transport failure. |

A client may delete a credential, revoke local trust, or begin re-pairing only
when an authenticated decrypted inner response tells it to. A plaintext,
pre-decryption, forged, replacement-listener, or seal-failure response is
transport guidance and must not trigger destructive credential state. After a
marker has been observed, `advertise` never falls back on any validation,
decryption, replay, or response-authentication failure.

Pre-decryption diagnostics use fixed messages and the reason enums above.
Secret-safe logs may contain the operation ID and one fixed reason. They must
not contain Authorization, pairing secrets, bearers, request or response
plaintext, request bodies, ciphertext, encapsulated keys, response public keys,
request nonces, HPKE exception text, or serialized `Request`/`Response`
objects.

### Protected operations and administrator exclusion

The `hpke-bound-v1` protected operation list is exactly `pairing.poll`,
`pairing.exchange`, `familiars.list`, `projects.list`,
`conversations.list`, `conversations.read`, and `messages.list`.
`health.read` and `pairing.create` carry no credential and remain unbound.

The four administrator operations — `pairing.admin.list`,
`pairing.admin.decide`, `credentials.admin.list`, and
`credentials.admin.revoke` — are explicitly excluded. Their `admin` sidecar
credential is not a pairing secret or bearer and is never carried by this
mechanism.

The normative deterministic interoperability artifacts are:

- [`src/lib/server/client-v1/hpke-bound-v1-vectors.json`](../../src/lib/server/client-v1/hpke-bound-v1-vectors.json)
- [`src/lib/server/client-v1/hpke-bound-v1-vectors.sha256`](../../src/lib/server/client-v1/hpke-bound-v1-vectors.sha256)

Consumers recompute the SHA-256 over the exact LF-normalized JSON bytes. The
main contract fixture publishes only those filenames; it does not embed the
vector payload. Plan prose, pull-request text, and copied values are not vector
truth.

## The envelope

Every response body on this surface — success, client error, server error — is
one shape, so a client parses once:

```json
{
  "apiVersion": "1.0",
  "minimumClientVersion": "0.1.0",
  "capabilities": [
    "health", "pairing", "credentials", "familiars", "projects",
    "conversations", "conversation-messages", "cursors"
  ],
  "operations": [
    "health.read", "pairing.create", "pairing.poll", "pairing.exchange",
    "pairing.admin.list", "pairing.admin.decide",
    "credentials.admin.list", "credentials.admin.revoke",
    "familiars.list", "projects.list",
    "conversations.list", "conversations.read", "messages.list"
  ],
  "data": { }
}
```

An error replaces `data` with `error`, and the two are mutually exclusive at the
type level as well as in practice:

```json
{
  "apiVersion": "1.0",
  "minimumClientVersion": "0.1.0",
  "capabilities": ["pairing", "credentials", "..."],
  "operations": ["pairing.create", "pairing.exchange", "..."],
  "error": {
    "code": "rate_limited",
    "message": "Rate limit exceeded.",
    "details": { "limit": "10", "resetAt": "1755731172617" },
    "retryable": true
  }
}
```

- **`apiVersion`** is `"1.0"` and **`minimumClientVersion`** is `"0.1.0"`. A
  client older than the minimum should stop and tell its user to update rather
  than pair.
- **`operations`** is the live inventory: every operation this build can
  actually be asked to perform, and nothing else. This is what a
  `client.supports("…")` helper should read. See *Capability discovery* below
  for the id→route table, the authority classes, and the compatibility rules.
- **`capabilities`** is the coarse family summary of the same inventory,
  derived from it rather than kept alongside it. Use it for display and for a
  quick "does this Cave do conversations at all"; use `operations` for anything
  a code path branches on.
- **`error.retryable`** defaults to `false` and is set true only where the
  route means it. Today that is exactly `pairing_pending`, `rate_limited`, and
  the `internal_error` a failed credential issue returns.
- **`cursor` is set by the canonical read routes** and by nothing else — see
  *Paging* below for its exact shape and for when it is omitted. `requestId`,
  `identity` and `revision` remain defined on the envelope and set by **no**
  route; do not write a client that depends on them being present. `revision`
  in particular is deliberately still unemitted: it implies a reconcile
  protocol (a conditional read or write keyed on the token) that nothing
  implements, and a token nothing consumes is worse than an absent field.

`apiVersion`, `minimumClientVersion`, `capabilities` and `operations`
deliberately ride the envelope and are *not* repeated inside `data` — including
on `/health`, where you might expect them. One source, so a single response can
never carry two different answers to the same question.

### Capability discovery

**`operations` answers what this build can be asked to perform. It is not a
roadmap, and nothing aspirational is allowed in it.**

That distinction is the whole point of this section. Until #4869 the envelope
advertised `streaming` and `revisions` on every response and **neither had a
route** — nothing emitted a stream, and nothing emitted or consumed a revision
token. A client helper spelled `client.supports("streaming")` would therefore
have returned a false operational claim. The list is now derived from a reviewed
operation registry (`src/lib/server/client-v1/operations.ts`), and CI asserts
that every record in it is served by a `route.ts` on disk and that every
advertised family is claimed by such a record. A capability with no owning route
cannot be advertised, because it cannot get into the list.

#### The live inventory

Each id names a fixed method and path for the life of `apiVersion` 1.x, so a
client resolves an id to a request from this table — or from the vendored
contract fixture, which carries the same records — rather than by probing paths.

| Operation | Route | Authority | Credential | Binding | Scope | Families |
|---|---|---|---|---|---|---|
| `health.read` | `GET /api/client/v1/health` | public | `none` | `none` | — | `health` |
| `pairing.create` | `POST /api/client/v1/pairing/requests` | public | `none` | `none` | — | `pairing` |
| `pairing.poll` | `GET /api/client/v1/pairing/requests/:id` | public | `pairing-secret` | `hpke-bound-v1` | — | `pairing` |
| `pairing.exchange` | `POST /api/client/v1/pairing/requests/:id/exchange` | public | `pairing-secret` | `hpke-bound-v1` | — | `pairing` |
| `pairing.admin.list` | `GET /api/client/v1/admin/pairing-requests` | admin | `admin` | `none` | — | `pairing` |
| `pairing.admin.decide` | `POST /api/client/v1/admin/pairing-requests/:id/decision` | admin | `admin` | `none` | — | `pairing` |
| `credentials.admin.list` | `GET /api/client/v1/admin/credentials` | admin | `admin` | `none` | — | `credentials` |
| `credentials.admin.revoke` | `DELETE /api/client/v1/admin/credentials/:id` | admin | `admin` | `none` | — | `credentials` |
| `familiars.list` | `GET /api/client/v1/familiars` | authenticated | `bearer` | `hpke-bound-v1` | `chat:read` | `familiars`, `cursors` |
| `projects.list` | `GET /api/client/v1/projects` | authenticated | `bearer` | `hpke-bound-v1` | `chat:read` | `projects`, `cursors` |
| `conversations.list` | `GET /api/client/v1/conversations` | authenticated | `bearer` | `hpke-bound-v1` | `chat:read` | `conversations`, `cursors` |
| `conversations.read` | `GET /api/client/v1/conversations/:id` | authenticated | `bearer` | `hpke-bound-v1` | `chat:read` | `conversations` |
| `messages.list` | `GET /api/client/v1/conversations/:id/messages` | authenticated | `bearer` | `hpke-bound-v1` | `chat:read` | `conversation-messages`, `cursors` |

#### Three authority classes, and why the id tells you which

The inventory describes **the build**, not your credential. A response carries
the same list whoever asked for it, which is what makes it comparable against
the generated fixture — a per-caller list could not be pinned by anything.

The authority class is therefore legible from the id itself, so a client never
has to consult a table to avoid calling something it can never reach:

- **public** — the four loopback bootstrap operations, without a bearer or
  administrator credential gate. Here, "public" means that neither a bearer nor
  the administrator credential gates ingress. `health.read` and
  `pairing.create` carry credential `none`. `pairing.poll` and
  `pairing.exchange` carry a `pairing-secret`. An `hpke-bound-v1` request carries
  that secret only inside the encrypted canonical plaintext. A plaintext legacy
  request, when the selected mode permits it, carries the secret only in the
  `x-coven-pairing-secret` header. The pairing secret is never a URL/query
  parameter or application request-body field. All four remain loopback-only;
  "public" never means an open network route.
- **authenticated** — a paired bearer carrying the named scope. Every id without
  `.admin.` that is not one of the four above. **This is the only class an
  external application can ever hold.**
- **admin** — any id containing **`.admin.`**. These require the Cave's own
  per-launch sidecar token over direct loopback in packaged Cave. Tokenless
  local development instead accepts only the proxy's secret-valued
  direct-loopback admin marker. These routes back the Cave's settings UI.
  **A paired bearer never satisfies one, whatever scopes it holds.** An SDK
  should treat a `.admin.` id as present-but-not-yours.

That is also the exact answer to what `credentials` means: **administrator
credential management, and nothing else**. `credentials.admin.list` and
`credentials.admin.revoke` are how the Cave's own UI sees and revokes issued
credentials. A paired client *obtaining* a credential is `pairing.exchange`, in
the `pairing` family. A paired client cannot list, inspect, or revoke its own
credential through this API.

`cursors` is the one family with no route of its own. It is cross-cutting: the
four paged reads claim it and `conversations.read` does not, because that route
refuses `limit` and `cursor` outright. Membership is explicit metadata on each
operation rather than inferred from a path, which is what lets a family like
this exist truthfully.

#### Compatibility rules

**Additive by default.**

- Adding an operation or a family in a compatible Client v1 release is additive.
  A new id never becomes *required* merely by appearing: if an older client had
  to understand it for the protocol to work, that would be a
  `minimumClientVersion` transition instead.
- **Consumers must tolerate ids they do not know.** A newer Cave will advertise
  ids your build has never heard of. Parse the arrays as opaque strings, narrow
  only the ids you understand, and keep the rest for diagnostics. Do not reject
  an envelope because it advertises something new — that would turn every
  additive minor release into a breaking one for you.
- **But never claim support you do not have.** Preserving an unknown id is not
  understanding it.
- Cave, as the producer, is strict in the other direction: it refuses to export
  an id no reviewed record backs, and the generated fixture pins what it does
  export.

**An unavailable operation is simply absent — there is no tombstone, and
absence is never a protocol change.** If an id is missing, this build does not
serve it; that is all it means. Read it as a runtime fact about the Cave in
front of you, never as evidence that the contract moved.

**Removing or renaming a live operation is a compatibility decision**, not an
edit. It requires a `minimumClientVersion` review and cannot happen as a side
effect of deleting a route: the reviewed literals in `contract.ts` and in
`scripts/export-client-v1-contract.mjs` both have to be changed by hand, and CI
compares them against each other and against the routes on disk.

#### Migration note for SDK and Chat consumers

Changing from the previous declaration to this one:

1. **`streaming` and `revisions` are gone from `capabilities`.** Neither was
   ever live, so **nothing that worked stops working** — no shipped client can
   have been calling a streaming or revision route, because none existed. What
   changes is the answer to a question: `capabilities.includes("streaming")` was
   `true` and is now `false`. A client that gated a UI affordance on it was
   showing a control that had nothing behind it, and should now correctly hide
   it. A client that *refuses to run* without `streaming` will now refuse — it
   was previously proceeding on a false premise, and the honest fix is to drop
   the requirement, not to restore the claim. When streaming lands it will
   arrive as a new `operations` id, additively.
2. **`health` is new in `capabilities`,** and `operations` is a new envelope
   field. Both are additive. If your parser rejects unknown capability ids or
   unknown envelope fields, relax it — see the consumer rule above.
3. **Prefer `operations` over `capabilities` for feature checks.** `supports()`
   should read the operation ids; `conversations` alone could not tell you
   whether a single conversation can be read as well as listed.
4. **Do not read `credentials` as self-service.** It has always meant
   administrator credential management and now says so; the operation ids make
   it unambiguous.
5. **Vendor the generated fixture** (`contract-fixture.json` and its `.sha256`)
   from a merged Cave commit rather than re-typing these tables. It carries the
   full operation records, which is how an id resolves to a request offline.

### Error codes and their HTTP statuses

The mapping is total and canonical (`httpStatusForClientV1ErrorCode` in
`responses.ts`); a route cannot serve `not_found` with a 200 or a 410. All
thirteen codes are part of the contract, but only the ones marked *in use*
are reachable on the thirteen routes that exist.

| Code | HTTP | In use | What a client should do |
|---|---|---|---|
| `invalid_request` | 400 | yes | Fix the request. Never retry unchanged — the body or a field failed validation. On the canonical reads it also covers an unsupported or repeated query parameter, an out-of-range `limit`, and a cursor this Cave did not mint. |
| `unauthorized` | 401 | yes | On pairing routes: the pairing secret is missing, malformed, or wrong, or the loopback stamp is absent. On the canonical reads: the bearer is missing, malformed, unknown, or revoked — or the loopback stamp is absent. On admin routes: the sidecar token is wrong. Do not retry with the same credential. |
| `scope_denied` | 403 | yes | A credential that exists but was not granted the scope the route requires — `chat:read` on every canonical read. Also returned by admin mutations whose `Origin`/`Referer` is not same-origin. Re-pair with the scope; retrying is pointless. |
| `not_found` | 404 | yes | The id does not exist. For pairing this includes "expired long enough ago to have been evicted"; for a conversation it also covers an id that could never name one. |
| `conflict` | 409 | yes | The resource is in a state that refuses this operation — a pairing already exchanged (`details.reason: "pairing_replayed"`) or already decided (`"pairing_already_decided"`). |
| `pairing_pending` | 409 | yes | Retryable. Nobody has approved or denied yet. Poll. |
| `pairing_denied` | 403 | yes | Terminal. The user said no; do not re-request without a fresh user action. |
| `pairing_expired` | 410 | yes | Terminal for this request. Start a new pairing request. |
| `rate_limited` | 429 | yes | Retryable. Honour `Retry-After`; `details.limit` and `details.resetAt` (epoch ms) carry the budget. |
| `internal_error` | 500 | yes | Retryable where the route says so — see the exchange route, where a failed credential write restores the pairing precisely so a retry works. On the canonical reads it is **not** retryable: it means a stored record could not be projected, and the store answers the same way next second. |
| `service_unavailable` | 503 | yes | The Cave cannot answer right now. On admin routes it means neither packaged sidecar authorization nor the proxy's tokenless-development authorization is available, and is not fixable by retrying; on `GET /familiars` it means the daemon roster could not be read and **is** retryable. |
| `reconcile_required` | 409 | yes | The client's position is no longer valid against canonical state. Today that is exactly one case: a messages cursor naming a turn that has left the conversation's active branch (`details.reason: "resume_from_canonical_state"`). Not retryable — restart the read. |
| `incompatible_version` | 426 | no | Reserved. Version incompatibility is currently discovered by reading `minimumClientVersion` off `/health`, not by being told. |

## Reaching the API at all

Five checks sit in front of every route here, none of them in the route file: a
request-target refusal for escaped paths, a loopback `Host` gate, a
cross-origin gate, control-plane body rules, and a direct-loopback peer gate.
Every one of them answers in a **different shape from
the envelope above**: the proxy returns `{"ok": false, "error": "<reason>"}`. A
client that assumes every response parses as a Client v1 envelope will fail to
read its own rejection. Branch on the HTTP status first.

(A fifth, `401 passkey presence required`, is armed only by
`COVEN_CAVE_PASSKEY_REQUIRED=1` and applies to remote ingress, which the peer
gate below already refuses for this surface. It is listed for completeness; a
client on the machine never meets it.)

### The loopback stamp

`server.ts` (`server.mjs` in a built app) deletes any client-supplied
`x-coven-cave-local-peer` header and re-stamps it with a per-boot secret only
for connections whose TCP peer it verified as direct, unforwarded loopback. The
secret never leaves the process. A request carrying a matching value therefore
*proves the listener classified it as local*, and a request cannot forge one.

If Next is running without `server.ts` in front of it, the secret is unset and
the check fails closed: every route that depends on it answers 401 or 403.

`clientV1IngressKind` classifies the four public paths, and `proxy.ts` requires
`trustedLocalPeer && !remoteIngress` for them:

```
403 {"ok":false,"error":"forbidden peer: client v1 requires direct loopback"}
```

That branch also *skips* the mobile-access gate, which is why a phone reaching
in over Tailscale Serve gets the 403 above rather than a mobile-auth prompt.

`clientV1IngressKind` also classifies the five canonical read paths, as
`authenticated` rather than public. That classification is a **demotion**, not a
promotion: `proxy()` skips the mobile-access gate and returns *before* the
sidecar-token block, so on those paths the route's own bearer check is the only
credential check in the request. See *When the authenticated routes land*.

Eight of the thirteen routes re-check the stamp in the route itself, via
`runtime.authenticator.isTrustedLoopback`, and answer `unauthorized` in the
envelope when it fails: all three pairing routes and all five canonical reads.
The other five take their locality from the proxy alone — `GET /health`
deliberately, because it returns no user data and no paths, and the four admin
routes because `proxy.ts` gives that family its own hard direct-loopback gate
(`403 forbidden peer: client v1 admin requires direct loopback`, #4843) rather
than a check inside each handler.

**The poll route did not always re-check, and that gap is what made
`cave-f1xki` (#4854) exploitable.** `clientV1IngressKind` returns `null` for any
pathname containing `%` or `\`, while Next still percent-decodes a *dynamic*
segment before matching it — so a pairing id written with one percent-escaped
character classified as *not* client-v1 ingress and reached the handler anyway,
skipping both the direct-loopback branch above and the body rules below. A
caller already holding the sidecar token or the mobile access credential could
use that to read `GET /pairing/requests/:id` from **off the machine**, which the
403 above otherwise forbids. Measured against a production build: the plain path
answered `403 forbidden peer` and the percent-written one answered `200` with
the pairing record.

**Fixed by refusing such a target outright.** `proxy.ts` answers any request
whose pathname is inside `/api/client/v1` and contains a `%` or a `\` with

```
400 {"ok":false,"error":"invalid client v1 path"}
```

before anything is classified. Nothing a correct client sends is affected: every
segment of this surface is a fixed literal or a UUID, and the pairing secret
travels in a header — so no legitimate path needs an escape. Percent-encoding in
the **query string** is untouched.

⚠️ **In practice only the `%` half of that is a 400 you will ever see.** Measured
over a real socket by
[the conformance run](../workflows/client-v1-conformance.md) on 2026-08-22: a
request target carrying a **backslash** is normalized to `/` by Next *in the
request target* and answered `308 Permanent Redirect` to the normalized path
before `proxy.ts` runs at all, so `isRefusedClientV1Path` never sees it. The
outcome is still closed — the normalized target is not a client-v1 route and is
refused `401` by the ordinary gate, and no handler is reached — but a client
following the redirect gets a `401`, never this `400`. The refusal in `proxy.ts`
stays as written: it is the layer that would catch a backslash Next stopped
normalizing, and removing it would trade a live defence for tidier prose.

The refusal is scoped by path prefix rather than by the ingress lists, so it
covers the admin family and any dynamic-segmented route added later, including
one nobody remembers to add to a list. Refusal was chosen over normalizing the
pathname before classifying it because Next decodes a dynamic segment exactly
once and does *not* treat a decoded `%2F` as a separator (both measured), so a
normalizing fix would have to reproduce those rules exactly and keep reproducing
them across Next versions — while decoding twice would open the `%252e` class
instead. The poll route's own stamp check, added in the same change, is the
second layer: no route that serves *user data* takes its locality from the proxy
branch alone any more. `GET /health` still does, and deliberately — it answers
the same compatibility envelope to everyone and carries nothing to leak.

### Body and content-type rules on the public routes

For the four public paths, and only those, `proxy.ts` applies control-plane body
rules before the route runs:

| Condition | Result |
|---|---|
| `Transfer-Encoding` present on POST/PUT/PATCH/DELETE | `400 invalid content-length` |
| `Content-Length` absent | `411 content-length required` |
| `Content-Length` not a plain integer | `400 invalid content-length` |
| `Content-Length` > 65536 | `413 request body too large` |

**The bodyless exchange POST still needs `Content-Length: 0`.** Omitting it is a
411 before the handler is reached, and this is the single most likely reason a
hand-rolled client's exchange call fails against a real Cave while passing in
unit tests that call the handler directly.

`POST /api/client/v1/pairing/requests` additionally requires an exact
`Content-Type` of `application/json`, optionally with a `charset=utf-8`
parameter and nothing else; anything else is `415 unsupported content-type`.

The admin routes are *not* classified as client-v1 ingress, so none of these
rules apply to them — no 64 KiB cap, no mandatory `Content-Length`. They are
covered by the ordinary API content-type allowlist instead.

### Host and origin

Every `/api/` request must arrive with a loopback `Host` or it is
`403 forbidden host`. Cross-origin `Origin` or `Referer` values are
`403 forbidden origin` / `403 forbidden referer` before any route runs.

## Public routes

### `GET /api/client/v1/health`

The compatibility handshake a client performs before it tries to pair.
Unauthenticated by design: a client must be able to learn it is too old
*before* it holds a credential, or the only way to discover incompatibility is
to fail a paired request.

**Request:** no headers, no body.

**200:**

```json
{
  "apiVersion": "1.0",
  "minimumClientVersion": "0.1.0",
  "capabilities": ["health", "pairing", "credentials", "..."],
  "operations": ["health.read", "pairing.create", "..."],
  "data": {
    "instanceId": "00000000-0000-4000-8000-000000000000",
    "pairingRequired": true,
    "releaseVersion": "0.3.9"
  }
}
```

`data` has exactly these three keys — the route's own test asserts the key set,
because the whole body is public.

- **`instanceId`** identifies an *installation*, not a person or a machine: a
  random UUID minted on first read and persisted to
  `<cave home>/client-v1-instance.json`. Cache your credential against it. If it
  changes, you are talking to a different Cave that happens to answer on the
  same port, and every cached credential and cursor for the old one is void.
  It is stable across requests and across restarts. It is *not* guaranteed
  stable if the Cave cannot write its home directory: a read-only or full disk
  degrades to a per-process id, retried once a minute, which is deliberately
  preferred over failing the diagnostic endpoint outright.
  `COVEN_CAVE_CLIENT_V1_INSTANCE_ID` overrides it, and an override longer than
  64 characters is warned about once and ignored.
- **`pairingRequired`** is the constant `true`. It is a contract fact, not a
  runtime setting — there is no unpaired mode, and a client reading `false`
  would have nowhere to send an unauthenticated request.
- **`releaseVersion`** is the running Cave's package version. The fixture's
  `"0.0.0"` is a placeholder and never served.

The live inventory is **not** in `data`: `capabilities` and `operations` ride
the envelope, here as on every other response. This is nonetheless the response
a client reads them from, because it is the only one reachable before pairing —
so it is the first place the declaration has to be true. See *Capability
discovery*.

**Errors:** none. The route has no failure branch of its own.

### `POST /api/client/v1/pairing/requests`

Opens a pairing request and mints its secret. This is the only route that hands
out the pairing secret, and it does so exactly once — nothing can re-read it
afterwards, because only its SHA-256 is kept.

**Requires:** the loopback stamp. `Content-Type: application/json`.

**Request body** — all three fields required, and **no other field is
permitted**; an unknown key is a 400, not a warning:

| Field | Rules |
|---|---|
| `appName` | Non-empty string, ≤ 128 chars, no control characters. Trimmed before it is stored. Shown to the user in the approval UI. |
| `installationId` | Non-empty, ≤ 128 chars, trimmed, then matched against `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`. Stable per install of your client. |
| `scopes` | Non-empty array of distinct values from the scope list below. Duplicates are rejected. |

Note the 128 is measured on the string **as sent**, before trimming, while every
other rule runs on the trimmed value — so 130 characters of which five are
leading spaces is a 400 even though what would be stored is 125.

```json
{
  "appName": "OpenCoven Chat",
  "installationId": "chat-install-1",
  "scopes": ["chat:read", "chat:write"]
}
```

The six scopes are `chat:read`, `chat:write`, `conversations:write`,
`attachments:write`, `tasks:write`, `github:write`. Nothing enforces them yet —
see *Known gaps*.

**201:**

```json
{
  "data": {
    "requestId": "018f4f1a-77c2-7a31-8a15-55a25aaba001",
    "secret": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "expiresAt": 1755731112617
  }
}
```

`requestId` is a UUID. `secret` is 43 base64url characters (32 random bytes).
`expiresAt` is epoch milliseconds, always creation + 5 minutes. **Hold the
secret in memory only** — it is the sole proof of ownership for the poll and
exchange calls, and it is unrecoverable if lost.

**Errors:**

| Status | Code | Cause |
|---|---|---|
| 401 | `unauthorized` | Loopback stamp missing or wrong. |
| 429 | `rate_limited` | 10 creations per 60 s, process-wide (see *Rate limits*). |
| 400 | `invalid_request` | Any validation failure above, or a body that is not JSON. The message is always the constant `"Invalid pairing request."` — it never says which field, on purpose. |

### `GET /api/client/v1/pairing/requests/:id`

Reads the status of a pairing request you hold the secret for. This is the
route a client polls while the user is deciding, if it does not want to poll by
attempting the exchange.

**Requires:** the loopback stamp and the pairing secret. An `hpke-bound-v1`
request carries the secret as `authorization.kind: "pairing-secret"` inside the
encrypted canonical plaintext. When the selected mode permits a plaintext
legacy request (`off`, or `advertise` without an authority marker), the only
accepted carrier is the `x-coven-pairing-secret` header. The secret is never an
application request-body field, and a `?secret=` query parameter is refused
with 401, so it never lands in a URL, a log, or a `Referer`.

The stamp is re-checked here, as it is on both pairing POSTs, and it is checked
before the rate-limit budget is read. It used to be left entirely to the proxy
branch — which is what made `cave-f1xki` (#4854) reachable on this route and no
other. A client that can call the exchange can call this, since that route has
always required the same stamp.

**200:**

```json
{ "data": { "id": "018f4f1a-…", "status": "pending", "expiresAt": 1755731112617 } }
```

`status` is one of `pending`, `approved`, `denied`, `expired`. Nothing else —
no `appName`, no `scopes`, no `createdAt`. The projection is deliberately
narrow: this route answers to whoever holds the secret, and it tells them only
what they need to drive the next step.

**Errors:**

| Status | Code | Cause |
|---|---|---|
| 401 | `unauthorized` | The loopback stamp is absent or does not match, the id is not a UUID, the secret header is absent or not 43 base64url characters, **or** the secret is wrong for a request that exists. |
| 429 | `rate_limited` | The per-pairing wrong-secret budget is spent — **including by the exchange route**, which shares it. Checked before the secret is compared, so a correct secret gets this too. |
| 404 | `not_found` | No request or terminal record carries this id. |
| 409 | `conflict` | Already exchanged. `details.reason` is `"pairing_replayed"`. |

The 401/404 split is observable: a well-formed wrong secret against a *known*
id answers 401, and against an *unknown* id answers 404. With 122-bit random
ids this is not a practical enumeration oracle, but it is the behaviour.

**Polling with the correct secret is free**, exactly as on the exchange — the
route's own test drives 150 polls and leaves the shared bucket untouched, and
neither `not_found` nor the already-exchanged 409 is charged either. But *free*
is not the same as *never 429*: see *Rate limits* for the lockout the shared
budget makes possible.

### `POST /api/client/v1/pairing/requests/:id/exchange`

Redeems an approved pairing request for a bearer credential. Exactly once —
this is the step that consumes the user's approval.

**Requires:** the loopback stamp and the pairing secret. An `hpke-bound-v1`
request carries the secret inside its encrypted canonical plaintext; when the
selected mode permits a plaintext legacy request, the only accepted carrier is
the `x-coven-pairing-secret` header. It is never carried in the URL/query or the
application request body. At the proxy, `Content-Length: 0`; there is no
application request body.

**200:**

```json
{
  "data": {
    "bearer": "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    "credential": {
      "id": "018f4f1a-77c2-7a31-8a15-55a25aaba002",
      "appName": "OpenCoven Chat",
      "installationId": "chat-install-1",
      "scopes": ["chat:read", "chat:write"],
      "createdAt": 1755730812617,
      "lastUsedAt": null,
      "revokedAt": null,
      "revocationReason": null
    }
  }
}
```

`bearer` is 43 base64url characters and is returned exactly once; only its
SHA-256 reaches disk. The credential's `scopes` are the scopes the request
asked for, unchanged — approval today is all-or-nothing, with no per-scope
paring by the administrator.

**Errors:**

| Status | Code | Cause | Retry? |
|---|---|---|---|
| 401 | `unauthorized` | Loopback stamp missing/wrong; id not a UUID; secret header malformed or absent; **or** a well-formed wrong secret for a request that exists. | No |
| 404 | `not_found` | No live or terminal record carries this id. | No |
| 409 | `pairing_pending` | Nobody has decided yet. Marked retryable. | Yes — poll |
| 403 | `pairing_denied` | The user declined. | No |
| 410 | `pairing_expired` | The five minutes ran out. | No — start over |
| 409 | `conflict` | Already exchanged. `details.reason: "pairing_replayed"`. | No |
| 429 | `rate_limited` | The per-pairing wrong-secret budget is spent — **including by the GET poll route**, which shares it. | Yes, after `Retry-After` |
| 500 | `internal_error` | The credential could not be written. Marked retryable, and the pairing is deliberately restored to its approved state so a retry succeeds without a second approval. | Yes |

**Polling with the correct secret is free.** The failure budget is charged only
by a *wrong* secret, so a client may poll this route for the whole 5-minute TTL
— 150 polls at a 2 s interval is covered by the route's own test — without ever
being rate limited. That is why `pairing_pending` is marked retryable.

**But an exhausted budget locks the pairing, including its rightful holder.**
The budget is read *before* the secrets are compared — a limit charged after the
comparison would bound nothing — so once ten wrong guesses land against one
pairing id, that pairing answers 429 to everyone for the rest of the 60 s
window. This is a deliberate per-pairing lockout, and it is confined to the
pairing under attack; other pairings are unaffected. **The bucket is shared with
`GET /pairing/requests/:id`**, so guesses against either route spend the same
ten and lock out both.

## Canonical read routes

The four resource families the inventory advertises to a paired bearer —
`"familiars"`, `"projects"`, `"conversations"`, `"conversation-messages"` —
served as paged reads over `"cursors"`. Every one of them is a `GET`, requires
the `chat:read` scope, and projects a store the Cave itself reads, so a paired
client and the desktop never disagree about what exists.

Five operations, not four: `conversations.list` and `conversations.read` are
separately invokable and share the `conversations` family, which is why the
`operations` list is the one to branch on.

### Authentication, and how it fails

Each route performs two checks of its own, in this order, **before** it reads
anything:

1. **The loopback stamp** (`x-coven-cave-local-peer`), through
   `runtime.authenticator.isTrustedLoopback` — the same check the two pairing
   routes make. A missing or wrong stamp is `unauthorized`. This is deliberate
   redundancy: the proxy's direct-loopback branch already covers these paths.
   It began as cover for the percent-encoding escape from that branch, which
   is now refused outright (see *Reaching the API at all*), and it stays
   because a path the ingress list *demotes* should not take its locality on
   trust from the thing that demoted it.
2. **The bearer**, through `requireScope({ bearer, scope: "chat:read" })`. The
   credential is read **only** from an `Authorization: Bearer …` header —
   never a query parameter, never a cookie. A missing, malformed, unknown, or
   revoked bearer is `unauthorized`; a credential that exists but was not
   granted `chat:read` is `scope_denied`.

Both failures are metered, against different buckets — see *Rate limits*.

Only then is the store read. That ordering is part of the contract, not an
implementation detail: it means an unauthenticated caller cannot use these
routes to drive a daemon request, scan the transcript directory, or learn
whether a conversation id exists.

### When a stored record cannot be projected

**500 `internal_error`, not retryable.** None of the stores behind these routes
validates the JSON it returns, so a required field can arrive absent or wrongly
typed — a hand-edited `projects.json` row with no `createdAt`, a conversation
file written by an older Cave, a daemon that renamed a roster field. The
projection refuses such a record rather than serving a shape that contradicts
the types above, and the route answers this.

Three things follow, and a client should plan for all three:

- **It is envelope-shaped**, like every other answer here. It replaced an
  uncaught throw, which Next answered with a body that is not a Client v1
  envelope at all.
- **It is not retryable and carries no `details`.** The record reads the same
  next second, and naming the field would describe the contents of the
  operator's disk to a caller who cannot repair it. Surface it and stop.
- **It is per *page*, not per record.** One unprojectable row fails every page
  that contains it, so a paging walk stops there rather than skipping the row —
  quietly dropping a record from a *canonical* read would tell a client the
  conversation does not exist. Rows before it in the ordering are served
  normally.

### Paging: `limit` and `cursor`

The list routes accept exactly two query parameters. **Any other parameter, and
any repeated parameter, is `invalid_request`** — a `?limt=5` answered with the
default page is how a client comes to believe it asked for five.

| Parameter | Default | Rules |
|---|---|---|
| `limit` | `50` (`defaultPageSize`) | A plain positive integer, 1 to `100` (`maxPageSize`). No leading zeros, no sign, no exponent, no surrounding space. Out of range is refused, **not** clamped. |
| `cursor` | — | An opaque token this Cave minted. Never construct or edit one. |

`GET /api/client/v1/conversations/:id` serves a single record and therefore
accepts **no** query parameters at all, including `limit` and `cursor`.

The cursor rides the shared envelope:

```json
{
  "cursor": { "current": "eyJ2Ijox…", "next": "eyJ2Ijox…", "hasMore": true }
}
```

- **`next` is present only when `hasMore` is true.** Follow it until it is
  absent; that is the whole termination rule.
- **`current` is the token you sent**, absent on a first page. Strictly it is a
  re-mint of the position that token named, which is the same bytes for every
  token this Cave issued and need not be for one you wrote yourself — another
  reason not to.
- **The `cursor` field is omitted entirely** when there is no token to publish —
  a first page that holds the whole set, or an empty first page. Do not treat a
  missing `cursor` as an error.
- **Re-sending a cursor returns the same page.** Paging is a function of (store,
  cursor, limit); replaying never advances and never loops.
- **A deleted record does not strand you.** The token records a position in the
  ordering, not an index, so the next page resumes at the next surviving record.
- **Do not carry a cursor across a Cave upgrade.** A token names a position in
  *an* ordering, and the ordering a route uses can change between versions —
  `/conversations` changed on 2026-08-22 (see below). The encoded version tag
  covers a change to the token's *shape*, not to the meaning of the position
  inside it, so a token minted by an older Cave is accepted rather than refused
  and resumes somewhere the client did not ask for. Measured on the
  2026-08-22 change: the stale token restarts the walk near the head and
  re-serves rows the client already had. That change costs duplicates rather
  than losses — a conversation's `updatedAt` is never below its `createdAt`, so
  no row can hide above a resumed position — but that is a property of those two
  fields, not a promise about the next reordering. A client that persists
  cursors between sessions should discard them when the Cave's version changes
  and start the walk again.
- `previous` is never emitted. These reads are forward-only.

Orderings are total — a sort key plus the id as tiebreak — because a page
boundary landing between two records with equal sort keys would otherwise repeat
both or skip both:

| Route | Order |
|---|---|
| `/familiars` | `id` ascending. A roster entry has no timestamp at all, so the identity is the sort key. |
| `/projects` | `createdAt` descending, then `id` descending. `createdAt` is immutable; `updatedAt` moves under an open cursor. |
| `/conversations` | `createdAt` descending, then `id` descending. A conversation with no `createdAt` sorts **last**, ordered among its peers by `id` descending. |
| `/conversations/:id/messages` | Transcript order, oldest first. **Not** a keyset — see that route. |

**Every sort key here is immutable.** Nothing rewrites a project's `createdAt`
or a conversation's, a familiar's id is its identity, and saving a conversation
stamps only its `updatedAt` — so the position a cursor names is a position the
ordering still has when you resume. A conversation's `createdAt` is decided when
the record is created and is read-only after that: a client body cannot rewrite
it, and a transcript that has none is never given one. A walk that starts now
serves the rows that existed when it started, in the order it started with,
however much the Cave is written to underneath it. Three things are worth
planning for:

- **A conversation created while you are paging is not served by that walk.**
  Its `createdAt` is *now*, which sorts above every cursor you already hold.
  Nothing is lost — no row that existed when the walk began is affected — but a
  client that wants the newest conversations re-reads from the top rather than
  waiting for a walk in progress to surface them.
- **A conversation deleted while you are paging simply stops appearing.** The
  cursor names a position in the ordering rather than an index, so the walk
  continues at the next surviving record.
- **A conversation that has no `createdAt` at all stays in the tail block.**
  Such a record is served last (see below), and it stays there: nothing in Cave
  gives a stored record a `createdAt` it did not already have. It used to —
  writing a turn to a transcript older than the field stamped it with *now*,
  which moved the row from the tail to the head, past every open cursor, and the
  rest of that walk never served it. Fixed on 2026-08-23; if you are talking to
  an older Cave, that row can still be missed. Re-reading from the top and
  deduping by `id` costs nothing and covers it, as it covers every other reason
  a ledger might have moved.

⚠️ **The ordering of `/conversations` changed.** It was `updatedAt` descending —
the order the Cave's own sessions list shows — until 2026-08-22. `updatedAt`
only ever rises and the ordering is descending, so a conversation that received a
turn mid-walk moved *above* an open cursor: one already served stayed served, and
one **not yet served was silently skipped** by the rest of the walk. Measured
over a real socket by [the conformance run](../workflows/client-v1-conformance.md),
which could not reproduce a repeat from a touch at all. A repeat would have been
deduplicable by `id`; a skip is silent data loss from a read this document calls
canonical, so the key moved to the immutable field.

**What that costs you:** this route no longer matches the desktop sessions list
row for row, and the cost is more than cosmetic, so it is worth stating exactly.
`updatedAt` is served on every conversation record, so you can *rank* by
recency — but only over rows you already hold. Sorting a single page by
`updatedAt` does not give you the most recently active conversations; it gives
you one arbitrary slice of the ledger, internally sorted. **To show "most recent
first" you have to read the ledger to exhaustion and sort client-side.** For a
Cave with a few hundred conversations that is one walk you can cache and keep
warm; there is no server-side shortcut, and there cannot be one, because a
keyset cursor cannot name a position in an order that moves. Deduplicating by
`id` still costs nothing and is still worth doing across walks you restart.

`createdAt` is optional on a conversation record: a transcript written before
the field existed has none. Those rows are **served at the end of the walk**,
not stranded and not skipped — they sort as if their key were empty, which is
below every timestamp — and they stay there, because Cave never adds the field
to a record that lacks it.

Cave substitutes a placeholder row for a transcript it cannot read or parse this
scan; you can recognise one by its empty `familiarId`. It carries the `createdAt`
Cave last read from that file, so it holds its place in the ordering rather than
dropping to the tail and climbing back out as the file becomes readable again. A
file Cave has *never* managed to read has no such value and is served in the tail
block with the legacy rows.

### `GET /api/client/v1/familiars`

This Cave's visible familiar roster: the daemon roster merged with
`familiars.toml` and the local removal tombstones, which is exactly what the
Cave's own roster UI shows.

**Request:** `Authorization: Bearer …`, the loopback stamp, optional `limit` and
`cursor`.

**200:**

```json
{
  "data": {
    "familiars": [
      {
        "id": "scribe",
        "displayName": "Scribe",
        "role": "Archivist",
        "description": "Keeps the ledger.",
        "pronouns": "they/them",
        "status": "idle",
        "lastSeenAt": "2026-08-20T10:00:00.000Z",
        "activeSessions": 2
      }
    ]
  },
  "cursor": { "next": "eyJ2Ijox…", "hasMore": true }
}
```

Only `id`, `displayName` and `role` are guaranteed; every other field is omitted
when the roster does not carry it. `lastSeenAt` is the daemon's `last_seen`
passed through verbatim — Cave neither writes nor parses it, so treat its format
as unspecified rather than as an ISO instant.

**503 `service_unavailable`, retryable:** the roster could not be read. This is
returned for **every** roster failure, *including the daemon answering 401 or
403*. That failure is about the Cave's own access token, not your bearer;
discarding a working credential and re-pairing cannot fix a daemon outage.

An empty roster is a `200` with `"familiars": []`, never a `404`.

### `GET /api/client/v1/projects`

The Cave project registry (`<cave home>/projects.json`), deduplicated by
normalized root.

**Request:** `Authorization: Bearer …`, the loopback stamp, optional `limit` and
`cursor`.

**200:**

```json
{
  "data": {
    "projects": [
      {
        "id": "p1",
        "name": "Cave",
        "root": "/Users/me/code/cave",
        "color": "#123456",
        "repoUrl": "https://github.com/OpenCoven/coven-cave",
        "createdAt": "2026-08-01T00:00:00.000Z",
        "updatedAt": "2026-08-09T00:00:00.000Z"
      }
    ]
  }
}
```

`color` and `repoUrl` are omitted when unset. `root` is an absolute path and is
published deliberately: it is the registry's real identity, and a paired
credential belongs to an application running as this user on this machine, which
can already read the directory it names.

Two fields of the stored record are **not** served. `legacyRoot` is
response-only scaffolding that lets the Cave's own web client re-key browser
stores after a root normalization; it is stripped before every write and is not
part of what a project is. `access` is a familiar-scoped permission answer, and
a Client v1 credential is not a familiar — this route serves the operator
registry view, so there is no familiar whose access could be applied.

### `GET /api/client/v1/conversations`

The conversation ledger — the same rows the Cave's own sessions list is built
from, **in a different order**: newest-created first, not most-recently-touched
first. See *Paging* above for why the recency ordering could not be paged safely
and what it costs you — in short, a recency-ordered view has to be assembled
client-side from a complete walk, not by sorting one page.

**Request:** `Authorization: Bearer …`, the loopback stamp, optional `limit` and
`cursor`.

**200:**

```json
{
  "data": {
    "conversations": [
      {
        "id": "conversation-1",
        "familiarId": "scribe",
        "harness": "claude",
        "model": "opus",
        "runtime": "local:/Users/me/code/app",
        "title": "Ledger cleanup",
        "origin": "chat",
        "status": "completed",
        "exitCode": 0,
        "pending": false,
        "createdAt": "2026-08-01T00:00:00.000Z",
        "updatedAt": "2026-08-09T00:00:00.000Z"
      }
    ]
  },
  "cursor": { "next": "eyJ2Ijox…", "hasMore": true }
}
```

Only `id`, `familiarId` and `updatedAt` are guaranteed. `exitCode` may be
`null`, which means the run has no exit code yet — distinct from the field being
absent, which means none was ever recorded. `createdAt` is the field this route
pages by, and it is *not* guaranteed: a record without one is served at the end
of the walk rather than dropped.

**`runtime` is not an enum, and for a local run it is a path.**
`POST /api/chat/send` writes the field as
`local:<the run's working directory>`, so the value you actually receive on most
conversations looks like `"local:/Users/me/code/app"` — an absolute path, often
under the operator's home directory, and not necessarily a registered project
root. It is served on the same grounds as a project's `root`: a paired
credential belongs to an application running as this user on this machine. Treat
it as an opaque string, and think before you log or display it.

**No turns are included.** The transcript is served by the messages route below,
which pages it. Inlining even the latest turn here would make the cost of a page
depend on how much was said rather than on how many conversations you asked for.

Three stored fields are deliberately withheld: `harnessSessionId` (it rotates on
every resume and is never the conversation's identity), and `branch` / `prUrl`
(working-tree attribution for the Cave's own PR badges, which describe the work
rather than the conversation).

### `GET /api/client/v1/conversations/:id`

One conversation's record — the same projection, over the same source, that the
list route serves for the same id. Use it to refresh one conversation without
paging the whole ledger.

**Request:** `Authorization: Bearer …` and the loopback stamp. **No query
parameters**, including `limit` and `cursor`.

**200:**

```json
{
  "data": {
    "conversation": {
      "id": "conversation-1",
      "familiarId": "scribe",
      "updatedAt": "2026-08-09T00:00:00.000Z"
    }
  }
}
```

**404 `not_found`:** no conversation carries that id. This is the answer for a
malformed id too — an empty segment, a traversal attempt, an over-long string —
because a client can act on neither differently, and one answer means the route
cannot be used to map which id shapes the store recognises.

Note this route reads the ledger rather than the transcript file, which costs a
directory scan. That is on purpose: `status` and `exitCode` are *derived* while
the ledger is built and do not exist in the stored file, so serving this from
the file would answer the same question two different ways depending on which
route you asked.

### `GET /api/client/v1/conversations/:id/messages`

One conversation's transcript, oldest first, paged.

**Request:** `Authorization: Bearer …`, the loopback stamp, optional `limit` and
`cursor`.

**200:**

```json
{
  "data": {
    "messages": [
      {
        "id": "t3",
        "conversationId": "conversation-1",
        "parentId": "t1",
        "role": "assistant",
        "text": "Done.",
        "createdAt": "2026-08-01T00:01:00.000Z",
        "attachmentCount": 1,
        "toolCount": 2,
        "isError": false,
        "cancelled": false
      }
    ]
  },
  "cursor": { "next": "eyJ2Ijox…", "hasMore": true }
}
```

`role` is `"user"`, `"assistant"` or `"system"` — a turn carrying anything else
is refused rather than served. `parentId` is `null` for the root turn. `isError`
and `cancelled` are omitted unless the store recorded them.

**`conversationId` is the transcript's own id, not the one you spelled in the
URL.** A conversation resolves to a file, and the filesystems this ships on are
case-insensitive, so `/conversations/CONVERSATION-1/messages` answers with the
messages of `conversation-1`. The id you get back is therefore always one
`GET /conversations/:id` will also answer to — the requested spelling need not
be, because that route matches the ledger exactly and answers `not_found` for a
case that does not match.

**Two things about this route are not the obvious default**, and both come from
how a conversation is stored:

- **The messages are the *active branch*, not the stored array.** A conversation
  file holds every turn of every branch in one append-ordered array; what you
  get is the chain from the active leaf back to the root — the same path the
  desktop renders. Turns on abandoned branches are not served.
- **Paging resumes by position, not by comparing keys.** A user turn and the
  assistant reply answering it are persisted with the *same* `createdAt`, and a
  turn id is unique only inside one transcript, so any `(createdAt, id)` keyset
  would put some replies in front of the prompts they answer.

That second point makes one failure possible here that the list routes do not
have:

**409 `reconcile_required`, not retryable**, with
`details.reason: "resume_from_canonical_state"`. The cursor names a turn that is
no longer on the active branch — someone switched branches in the desktop while
you were paging. Restart the read from the beginning. The route refuses to
guess: restarting silently at the top would replay the conversation as if
nothing had happened, and resuming at position zero would serve a different
branch under the same token.

**404 `not_found`:** the conversation does not exist, its file could not be
read, or the id could never name one.

**What is withheld, and why it matters.** A turn's `reasoning` is the harness's
private scratchpad, and a tool call carries whatever the tool was pointed at — a
path, a command, the contents of a file it read. Neither is served. `toolCount`
and `attachmentCount` tell you the turn did work without handing over the work.
`usage` and `costUsd` are also withheld. `chat:read` is a grant to read the
conversation, not everything the conversation touched.

## Administrator routes

These four are the Cave's own consent surface: the settings UI that lists
pending requests, approves or denies them, lists issued credentials, and revokes
one. They are **not** part of the client-facing API — a paired client has no
business calling them and holds nothing that would authenticate it if it tried.

### Authentication, and how it fails

All four call `requireClientV1Admin`, which:

1. Reads `COVEN_CAVE_AUTH_TOKEN`. If it is unset or blank in non-bundled
   development, it accepts only the secret-valued internal admin marker that
   `proxy.ts` stamps after proving a direct-loopback peer and stripping any
   caller-supplied marker. This keeps the Settings page and local pairing flow
   usable under plain `pnpm dev`. Bundled Cave still fails closed with a missing
   sidecar token before the route runs.
2. Compares the `x-coven-cave-token` header against it in constant time.
   Mismatch or absence is `401 unauthorized`.

   ⚠️ **On a Cave that has a token configured, that envelope is unreachable.**
   `COVEN_CAVE_AUTH_TOKEN` is also what `proxy.ts`'s ordinary sidecar-token gate
   compares, and the admin family deliberately falls through to it — so a wrong
   or absent header is refused there first and the wire carries the proxy's
   shape, `401 {"ok":false,"error":"unauthorized"}`, not the Client v1 envelope
   above. Same status, different body. Measured over a real socket by
   [the conformance run](../workflows/client-v1-conformance.md) on 2026-08-22;
   a handler-level test cannot see it, because it never runs the proxy. The
   check in `requireClientV1Admin` is not redundant — it is what answers if the
   admin family ever stops falling through — but it is the *second* refusal, and
   the 503 for an unset token is the only one of its answers a caller observes.
3. For **mutations only** (the decision POST and the credential DELETE),
   requires **at least one** of `Origin` and `Referer`, and requires every one
   that *is* present to be same-origin. A request carrying neither is refused;
   one carrying only a same-origin `Origin` passes. Failure is
   `403 scope_denied`. Reads require neither header.

   The asymmetry is deliberate rather than sloppy. Browsers omit `Origin` on
   same-origin GETs and can be made to omit `Referer` entirely, so *requiring*
   both would 403 legitimate first-party mutations; refusing the both-absent
   case is what stops a non-browser caller skipping the check by sending no
   source header at all.

`requireClientV1Admin` still does **not** consult the loopback stamp itself, for
the reason its own comment gives: transport locality is not proof of the
administrator, and the per-launch sidecar credential is.

**Locality is required as well, one layer up
([#4843](https://github.com/OpenCoven/coven-cave/issues/4843)).** `proxy.ts`
answers any `/api/client/v1/admin/*` request that is not a direct loopback peer
with

```
403 {"ok":false,"error":"forbidden peer: client v1 admin requires direct loopback"}
```

The two checks answer different questions — the proxy asks *from where*,
`requireClientV1Admin` asks *who* — and the gate binds the family without
excusing it: the admin paths still do **not** appear in either ingress list, so
they never take the client-v1 branch's pass-through and the sidecar token is
still required afterwards by the ordinary gate.

Before that gate existed, a non-browser caller arriving over Tailscale Serve
with the sidecar token and no `Origin`/`Referer` could *read* the credential list
and the pending-request list from off the machine (mutations already failed,
because a `ts.net` origin does not satisfy the same-origin check). Severity was
low — the token is per-launch and never leaves the machine — but the
pairing-approval queue is the human-consent surface for the entire authority, so
it now requires the same direct-loopback stamp the pairing routes require.

### `GET /api/client/v1/admin/pairing-requests`

Lists **pending** requests only — decided and expired ones are filtered out,
because this feeds an approval queue.

**200:** `{ "data": { "pairingRequests": [ … ] } }`, each entry:

```json
{
  "id": "018f4f1a-…",
  "appName": "OpenCoven Chat",
  "installationId": "chat-install-pending",
  "scopes": ["chat:read", "chat:write"],
  "status": "pending",
  "createdAt": 1000,
  "expiresAt": 301000,
  "decidedAt": null
}
```

The projection is enumerated field by field rather than spread, so neither the
secret nor its hash can be added to the underlying record and leak here by
accident.

**Errors:** 503 / 401 as above.

### `POST /api/client/v1/admin/pairing-requests/:id/decision`

Records the user's decision. This is the human-consent step the whole surface
exists to gate.

**Request body** — exactly one key, and the value must be exactly `"approved"`
or `"denied"`:

```json
{ "decision": "approved" }
```

**200:** `{ "data": { "pairingRequest": { … } } }` — the same projection as the
list route, with `status` updated and `decidedAt` set.

**Errors:**

| Status | Code | Cause |
|---|---|---|
| 503 / 401 / 403 | — | Admin auth, as above (403 for a mutation with a bad or missing `Origin`/`Referer`). |
| 404 | `not_found` | The id is not a UUID, or no *live* request carries it — including one that has expired or already been exchanged. |
| 400 | `invalid_request` | Body is not JSON, has extra keys, or `decision` is anything other than the two literals. |
| 409 | `conflict` | Already decided *differently*. `details.reason: "pairing_already_decided"`. |

Re-sending the **same** decision for an already-decided request succeeds with
200 and leaves the original `decidedAt` in place — the operation is idempotent
in that direction. Only a contradicting decision conflicts.

### `GET /api/client/v1/admin/credentials`

Lists every credential in the store, active and revoked, re-read from disk on
each call.

**200:** `{ "data": { "credentials": [ … ] } }`, each entry being the same
metadata shape the exchange returns: `id`, `appName`, `installationId`,
`scopes`, `createdAt`, `lastUsedAt`, `revokedAt`, `revocationReason`. The
`bearerHash` field is projected away and never appears.

Note there is no pagination and no cursor. The contract declares
`defaultPageSize: 50` and `maxPageSize: 100`; this route honours neither,
because it lists a store bounded by how many times a human approved something.

**Errors:** 503 / 401 as above.

### `DELETE /api/client/v1/admin/credentials/:id`

Revokes a credential. Revocation is a tombstone, not a deletion: the record
stays in the store with `revokedAt` and `revocationReason` set, so the audit
trail survives.

**Request body** — exactly one key:

```json
{ "reason": "operator revoked" }
```

`reason` must be a non-empty trimmed string, ≤ 256 characters, with no control
characters.

**200:** `{ "data": { "credential": { … } } }` with `revokedAt` and
`revocationReason` populated.

**Errors:**

| Status | Code | Cause |
|---|---|---|
| 503 / 401 / 403 | — | Admin auth, as above. |
| 400 | `invalid_request` | Body is not JSON, has extra keys, or `reason` fails the rules above. |
| 404 | `not_found` | No credential with that id. Revoking an already-revoked credential is **not** an error — it is a no-op that returns 200 with the existing tombstone. |

Unlike every other id-bearing route here, `:id` is not parsed as a UUID; it is
matched against the store as an opaque string.

## Rate limits

All buckets are fixed 60-second windows held in process memory, capped at 1024
entries per category with least-recently-seen eviction.

| Bucket | Limit | Keyed by | Charged when |
|---|---|---|---|
| Pairing creation | 10 / 60 s | the loopback stamp — one process-wide constant, so this is a single shared bucket | every accepted `POST /pairing/requests` |
| Pairing secret failure | 10 / 60 s | the pairing request id | only a **wrong** secret, on `POST .../exchange` **or** `GET /pairing/requests/:id` — one shared bucket |
| Authenticated requests | 120 / 60 s | credential id | every accepted canonical read, **and** every `scope_denied` on one — a real credential asking for a grant it does not hold is an authenticated request |
| Invalid bearer | 120 / 60 s | the loopback stamp — one process-wide constant, so this is a single shared bucket | every `unauthorized` on a canonical read: a missing, malformed, unknown, or revoked bearer |

Creation is bounded process-wide on purpose: each accepted request occupies a
slot in a fixed-size store, so the quantity worth bounding is the total rate of
creation. Every finer key would be caller-chosen (`installationId`, `appName`)
and so trivially varied to escape the bound.

A 429 carries a `Retry-After` header in seconds and puts `limit` and `resetAt`
(epoch ms, as strings) in `error.details`.

**One bucket covers both places a pairing secret is compared.** `GET
/pairing/requests/:id` and `POST .../exchange` run the byte-identical
`hashesEqual` against the same `secretHash`, and both distinguish a wrong secret
(401) from a right one, so both are guessing oracles. Each peeks the budget
*before* comparing and charges it only on a mismatch, against the same key —
the pairing request id. Two buckets would meter each route and bound neither:
the cheapest attack is to spend one oracle and then use the other.

**The practical consequence a client author will meet: the two routes can lock
each other out.** The budget is read before the secrets are compared, so once
ten wrong guesses have landed against one pairing id — through *either* route —
the next call to *either* route answers 429 for the rest of the 60-second
window, including a call carrying the correct secret. A client polling with the
right secret is never charged, but it is not immune to a budget someone else
spent. Honour `Retry-After` rather than treating 429 as terminal; the pairing
is still alive until `expiresAt`.

Closed by [#4849](https://github.com/OpenCoven/coven-cave/pull/4849)
([#4846](https://github.com/OpenCoven/coven-cave/issues/4846)); before it, the
GET route consulted no rate limiter at all and the exchange budget bounded one
of the two comparison sites, which is to say neither.

The limiter's methods are still named `consumePairingExchangeFailure` /
`peekPairingExchangeFailure` even though the budget now covers both routes. The
name records where the budget was introduced, not who may spend it
(`cave-ngro8`).

## Storage and lifetimes

**Pairing requests are in-memory and process-local.** They do not survive a
Cave restart, and they are not shared between processes. The store holds at most
64 live records, evicting the oldest when full, plus up to 64 terminal
(consumed/expired) records so a replay can be answered `conflict` rather than
`not_found`. TTL is five minutes from creation, enforced by a prune on every
read as well as by `expiresAt`.

**Credentials persist** to `<cave home>/client-v1-credentials.json`, where
*cave home* is `COVEN_CAVE_HOME`, else `$COVEN_HOME/cave`, else `~/.coven/cave`.
The file is written 0600 inside a 0700 directory, atomically via a temp file and
a rename, and the directory is verified not to be a symlink on every operation.
Only `sha256(bearer)` is stored — the bearer itself exists only in the exchange
response. `lastUsedAt` is written at most once a minute per credential to keep a
busy client from rewriting the store on every call.

**The instance id** lives in `<cave home>/client-v1-instance.json`, minted once
and never rotated. Two Caves starting together resolve the race by exclusive
create-and-re-read, so the loser adopts the winner's id rather than serving one
that will vanish at next boot.

### Finding the endpoint

The port is `COVEN_CAVE_PORT`, else `PORT`, else a per-channel default — it does
not move per launch, but it is configuration rather than a constant, so a client
should not hard-code it. `server.ts` publishes the endpoint it actually bound to
`<cave home>/client-v1-discovery.json`, from inside the `listen` callback,
before it prints `Ready on …`:

```json
{
  "version": 1,
  "endpoint": "http://127.0.0.1:3020",
  "pid": 4321,
  "nonce": "018f4f1a-77c2-7a31-8a15-55a25aaba003",
  "startedAt": "2026-08-20T20:20:12.617Z"
}
```

The file is 0600 inside a 0700 directory verified not to be a symlink, written
temp-file → `fsync` → rename, and deleted on shutdown — but only if the record
still carries *this* process's `nonce` and the same inode, so a Cave that has
been restarted underneath never deletes its successor's record.

Both the directory and the file are also checked to be owned by the current
user, and to be writable by nobody else. On POSIX that is a `uid` comparison.
On Windows it is a DACL read: `process.getuid` is undefined there and `lstat`
reports uid 0 for every path, so the uid comparison alone passed unconditionally
on the platform — the defect GitHub #4842 was filed for. `server.ts` now shells
out to PowerShell, refuses a path any other principal can write, and repairs a
DACL that merely inherited one (`icacls <path> /reset` undoes the repair as the
ordinary user; no elevation is needed).

**A publish failure disables client v1; it does not stop Cave.** The record is
withheld, `clientV1DiscoveryPublished` stays false, and a banner naming the
failure goes to stderr, but the server finishes starting and serves everything
else. That is not a relaxation of the check: no path the guard refused is used,
and the request-side guard keeps refusing every client v1 call that presents a
credential — the credential store re-asserts ownership on every read and write,
so `findByBearer` cannot answer on a path the guard refused. Measured on a host
with no reachable `powershell.exe`: the server answers `Ready on …`, the record
is absent, `GET /api/client/v1/health` still answers (it is unauthenticated by
design and carries no user data), and a bearer-carrying request is refused. The
one case that survives is narrow and deliberate: if the discovery *file* alone
is unverifiable while the store's root is exclusive, a client that already
holds a credential and a cached endpoint keeps working against the real server
— it is the record, not the server, that could have been redirected. It is a
correction of blast radius — this used to close the listener and exit 1, which
on a host that cannot read a DACL at all (PowerShell in Constrained Language
Mode, or no `powershell.exe` under `%SystemRoot%`, both measured on Windows 11
under WDAC/AppLocker-shaped configurations) meant Cave would not start and there
was no remedy reachable from inside it.

An operator on such a host can opt back in, explicitly:

```
COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP=i-accept-unverified-path-ownership
COVEN_CAVE_UNVERIFIED_PATH_OWNERSHIP_REASON="<who accepted this, and why>"
```

Both are required; the reason must be at least 12 characters. The value is that
exact sentence, so `1`, `true` and `yes` do nothing and say so. It waives **one**
condition — a DACL that could not be *read* — and never a DACL that was read and
found shared, a POSIX uid mismatch, or a platform with neither a uid nor an ACL.
Every waived path logs a `SECURITY WAIVER` line naming the path and the reason
given. The same waiver covers the mobile pairing secret
(`src/lib/server/mobile-access-provision.ts`), which is restricted by the same
guard because its `chmod(0o600)` is equally inert on Windows.

`endpoint` is validated before it is written: `http:`, a loopback host, an
explicit port, no credentials, no path, query, or fragment. Treat `pid` and
`startedAt` as staleness hints — a `SIGKILL`ed Cave leaves its record behind,
and nothing clears it until the next Cave boots and overwrites it — so confirm
the endpoint with `GET /health` and check `instanceId` before trusting it. The
0600 mode means a client reads the record only by already running as the Cave's
own user on the Cave's own machine.

This is the one part of the surface with two implementations; see *Known gaps*.

## A complete pairing walkthrough

```
client                        Cave                        user
  │  GET /health                │
  │───────────────────────────► │   apiVersion, minimumClientVersion,
  │ ◄───────────────────────────│   instanceId, releaseVersion
  │                             │
  │  POST /pairing/requests     │
  │  {appName, installationId,  │
  │   scopes}                   │
  │───────────────────────────► │
  │ ◄───────────────────────────│   201 {requestId, secret, expiresAt}
  │                             │
  │                             │   GET /admin/pairing-requests
  │                             │ ◄─────────────────────────────── settings UI
  │                             │──────────────────────────────►   shows appName,
  │                             │                                  installationId, scopes
  │  POST /pairing/requests/    │
  │       {id}/exchange         │   POST /admin/pairing-requests/
  │  x-coven-pairing-secret     │        {id}/decision {"approved"}
  │───────────────────────────► │ ◄─────────────────────────────── user approves
  │ ◄───────────────────────────│
  │   409 pairing_pending       │
  │   (poll until decided)      │
  │                             │
  │  POST …/exchange            │
  │───────────────────────────► │
  │ ◄───────────────────────────│   200 {bearer, credential}
```

Client-side rules that fall out of the above:

1. Resolve the endpoint from `<cave home>/client-v1-discovery.json` rather than
   assuming a port — see *Finding the endpoint*. Then read `/health` and compare
   your own version against `minimumClientVersion`. Cache `instanceId`.
2. Create the request, hold `secret` in memory, and show the user that approval
   is needed *in the Cave*, not in your app.
3. Poll the exchange (or the GET lookup) every couple of seconds until
   `expiresAt`. `pairing_pending` is normal and free; `pairing_denied`,
   `pairing_expired`, and `conflict` are terminal. A 429 is **not** terminal:
   both routes share one per-pairing budget that someone else's wrong guesses
   can spend, so back off for `Retry-After` and resume — the pairing is alive
   until `expiresAt`.
4. On 200, persist `bearer` in the platform keychain, keyed by `instanceId`, and
   discard the pairing secret.
5. If `instanceId` ever changes, discard the bearer and pair again.

## Known gaps

Stated because a client author will otherwise discover them by writing code
against something that is not there.

- **Reads only.** The five canonical reads are the whole authenticated surface.
  There is no way to send a message, create a conversation, upload an
  attachment, or act on a task through this API, and the five write scopes are
  recorded on a credential and read by nothing.
- **No streaming, and no revision tokens.** To follow a running conversation
  today you re-read `GET /conversations/:id/messages` and diff — there is no
  server-push channel, and no revision token to make a conditional read cheap.
  Both were *advertised* as capabilities until #4869 while having no route at
  all, so a client could read a declaration that promised them; they are now
  absent from the live inventory, which is the truthful statement of the same
  gap. When either lands it arrives as a new `operations` id. See *Capability
  discovery*.
- **`/conversations` pages on a mutable key.** A conversation whose transcript
  grows while you are paging moves to the front of the ordering, so one you have
  not reached yet is **skipped** by the rest of the walk. Re-read from the top
  if you must not miss one, and deduplicate by `id` across walks. See *Paging*
  for the measurement and for why the immutable alternative is unavailable here.
- **A conversation's whole turn text is served inline.** There is no per-message
  size cap and no truncation, so a page of 100 long turns is a large response.
  Ask for a smaller `limit` on a constrained client.
- **The reviewed discovery module has no production caller** — but the record
  itself is written; see *Finding the endpoint* above. `server.ts` cannot import
  from `src/`, so it carries its own copy of the publish/remove logic and
  `publishClientV1DiscoveryRecord` in
  `src/lib/server/client-v1/discovery.ts` is reached only by its own tests. Two
  implementations of one on-disk contract can drift, and the `src/lib` one is
  the reviewed side.
- **`requestId` and `identity` are never emitted**, so there is no
  server-assigned correlation id to quote in a bug report and no envelope-level
  statement of which resource a response describes. Both envelope fields exist;
  no route sets either.

## When the authenticated routes land

The first five landed (cave-jfa9y). The wiring they inherited is not the obvious
default, and it is the same wiring the next one will inherit — read this before
adding a route here.

`CLIENT_V1_AUTHENTICATED_PATHS` now holds exactly those five paths. **Matching
it is a demotion, not a promotion**: `proxy()` computes the ingress kind before
the mobile-access gate, skips that gate for any client-v1 match, and returns
before the sidecar-token block ever runs — so for a listed path the *only*
credential check left is the one the route performs on itself. That is a sound
trade for a route that really calls `requireScope`, and a hole for a path that
does not exist yet: a handler landing later would inherit an exemption it never
opted into. The list previously named thirteen Phase 2 paths against zero
handlers, which is why it was emptied before any of them existed.

**But absence is a decision too, and it costs something.** Both of the
client-v1-only protections described under *Reaching the API at all* are gated
on that same classification — the hard `403 forbidden peer: client v1 requires
direct loopback`, and the 411/413 body rules with their 64 KiB cap. Neither
applies to a path that classifies `null`. So an authenticated route that lands
un-listed does not merely keep the sidecar-token gate: it *gains* a bearer
requirement and *loses* loopback-only ingress and the body cap.

The admin family shows the other way to buy locality back. It classifies `null`
by design — its protection is the sidecar token, and listing it would return
before the block that checks one — so `proxy.ts` binds it to a direct loopback
peer with a check of its own (#4843) and then lets it fall through to the
ordinary gate. A Phase 2 route that needs locality without the demotion should
follow that shape rather than being added to the list. Nothing has to be
remembered for the escaped-target refusal, though: that one is scoped by path
prefix, so a new route is covered the day it lands.

The invariant, asserted in `src/app/api/api-contracts.test.ts` against the repo
rather than a list somebody must remember to prune:

1. every pattern in the list must be matched by a `route.ts` that exists, so the
   entry lands in the same change as the handler. A dynamic segment is probed as
   one literal segment; a `[...catchAll]` is probed at *every* width it serves,
   because collapsing it to one segment let a catch-all impersonate a reviewed
   single-segment public path.
2. every client-v1 route that is neither the admin family (identified by
   directory) nor entirely inside the reviewed public set (identified by
   `clientV1IngressKind` itself) must call `requireScope`; admin routes must call
   `requireClientV1Admin`. Both are matched against a comment-, string- and
   regex-stripped view of the source, so a `// TODO: … requireScope(…)` on a
   route with no credential check does not satisfy them.
3. the same route must also call `consumeAuthenticated`. A pre-authorized path
   has already given up the sidecar-token gate, so an unmetered one lets a
   single valid bearer drive the credential store, the daemon, and the
   transcript directory without bound — and nothing else in the suite would
   notice, because an unmetered route passes every functional test it has.

Two consequences of that first assertion are worth stating outright, because
both look like bugs from outside:

- **The route must not depend on the ingress branch it is listed for.** The
  percent-encoding hole above means the branch can be skipped entirely, so each
  of the five re-checks the loopback stamp itself. Being on the list is not a
  guarantee that `proxy()` classified the request.
- **A path can be listed without being a distinct route.**
  `/api/client/v1/conversations/search` classifies `authenticated` because there
  is no static `search` route under `conversations` — the App Router serves that
  path from the `[id]` handler with the id `"search"`, which answers
  `not_found`. Classifying it any other way would describe a route that does not
  exist.
