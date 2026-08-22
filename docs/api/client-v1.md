# Client v1 HTTP API

The versioned surface an external application uses to talk to a running Cave.
It exists so a separate client — the OpenCoven chat app, a native iOS build, a
script — can obtain a credential from a Cave the user is sitting in front of,
without that client being part of the Cave build and without it being handed
the desktop shell's own per-launch secret.

**Read the scope line before you read anything else.** As of this commit the
surface is eight routes: a health handshake, three pairing routes that walk a
client from "no credential" to "holding a bearer", and four administrator
routes that let the Cave's own settings UI see and decide those requests. There
is **no authenticated resource route yet**. A bearer this API issues is real,
persisted, and revocable, and it currently opens nothing — every route that
would consume it is unbuilt. If you are writing a client, you can implement and
test the whole pairing handshake today, and you will have nothing to call with
the result.

## Where the contract actually lives

This document describes behaviour; it is not the authority for it. When the two
disagree, the code is right and this file is stale.

| Concern | Authority |
|---|---|
| Versions, scopes, capabilities, error codes, limits, public-route list | [`src/lib/server/client-v1/contract.ts`](../../src/lib/server/client-v1/contract.ts) |
| Byte-pinned export of all of the above, plus example envelopes | [`contract-fixture.json`](../../src/lib/server/client-v1/contract-fixture.json) and its `.sha256` |
| Who may reach which route, and from where | [`src/proxy.ts`](../../src/proxy.ts) and [`src/proxy-helpers.ts`](../../src/proxy-helpers.ts) |
| Per-route request and response shapes | the eight `route.ts` files under `src/app/api/client/v1/` |
| Storage, lifetimes, hashing | `pairing-store.ts`, `credential-store.ts`, `instance-id.ts` |
| The discovery record a client reads to find the endpoint | [`server.ts`](../../server.ts) — **not** `client-v1/discovery.ts`, which nothing in production calls |

The fixture is generated, not hand-written: `node scripts/export-client-v1-contract.mjs`
rewrites it from `contract.ts`, and `--check` runs as a preflight to the `api`
test suite, so a contract change that does not regenerate the fixture fails CI
rather than shipping a stale artifact. A client that wants machine-readable
constants should vendor the fixture, not re-type the tables below.

`scripts/client-v1-doc-contract.test.mjs` pins *this document* to both — every
route file on disk and every entry in the contract's `publicRoutes`, every
scope, and every error code must appear here, so a ninth route cannot land
undocumented.

## The envelope

Every response body on this surface — success, client error, server error — is
one shape, so a client parses once:

```json
{
  "apiVersion": "1.0",
  "minimumClientVersion": "0.1.0",
  "capabilities": [
    "pairing", "credentials", "familiars", "projects", "conversations",
    "conversation-messages", "streaming", "cursors", "revisions"
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
- **`capabilities`** is the full list above on every response. It is what the
  surface *declares*; several entries (`familiars`, `projects`,
  `conversations`, `conversation-messages`, `streaming`, `cursors`,
  `revisions`) name route families that do not exist yet. Treat it as the
  roadmap the Cave commits to, not as an inventory of live endpoints.
- **`error.retryable`** defaults to `false` and is set true only where the
  route means it. Today that is exactly `pairing_pending`, `rate_limited`, and
  the `internal_error` a failed credential issue returns.
- `requestId`, `identity`, `revision`, and `cursor` are defined on the envelope
  and **no current route sets any of them**. They are the forward surface for
  the paginated, revisioned resource routes; do not write a client that depends
  on them being present.

`apiVersion`, `minimumClientVersion`, and `capabilities` deliberately ride the
envelope and are *not* repeated inside `data` — including on `/health`, where
you might expect them. One source, so a single response can never carry two
different answers to the same question.

### Error codes and their HTTP statuses

The mapping is total and canonical (`httpStatusForClientV1ErrorCode` in
`responses.ts`); a route cannot serve `not_found` with a 200 or a 410. All
thirteen codes are part of the contract, but only the ones marked *in use*
are reachable on the eight routes that exist.

| Code | HTTP | In use | What a client should do |
|---|---|---|---|
| `invalid_request` | 400 | yes | Fix the request. Never retry unchanged — the body or a field failed validation. |
| `unauthorized` | 401 | yes | On pairing routes: the pairing secret is missing, malformed, or wrong, or the loopback stamp is absent. On admin routes: the sidecar token is wrong. Do not retry with the same credential. |
| `scope_denied` | 403 | yes | Returned by admin mutations whose `Origin`/`Referer` is not same-origin. Also the intended answer for a credential lacking a required scope, once scoped routes exist. |
| `not_found` | 404 | yes | The id does not exist. For pairing this includes "expired long enough ago to have been evicted". |
| `conflict` | 409 | yes | The resource is in a state that refuses this operation — a pairing already exchanged (`details.reason: "pairing_replayed"`) or already decided (`"pairing_already_decided"`). |
| `pairing_pending` | 409 | yes | Retryable. Nobody has approved or denied yet. Poll. |
| `pairing_denied` | 403 | yes | Terminal. The user said no; do not re-request without a fresh user action. |
| `pairing_expired` | 410 | yes | Terminal for this request. Start a new pairing request. |
| `rate_limited` | 429 | yes | Retryable. Honour `Retry-After`; `details.limit` and `details.resetAt` (epoch ms) carry the budget. |
| `internal_error` | 500 | yes | Retryable where the route says so — see the exchange route, where a failed credential write restores the pairing precisely so a retry works. |
| `service_unavailable` | 503 | yes | The Cave is not configured for this operation. On admin routes it means `COVEN_CAVE_AUTH_TOKEN` is unset. Not fixable by retrying. |
| `reconcile_required` | 409 | no | Reserved for the resource routes' revision protocol. |
| `incompatible_version` | 426 | no | Reserved. Version incompatibility is currently discovered by reading `minimumClientVersion` off `/health`, not by being told. |

## Reaching the API at all

Four checks sit in front of every route here, none of them in the route file: a
loopback `Host` gate, a cross-origin gate, control-plane body rules, and a
direct-loopback peer gate. Every one of them answers in a **different shape from
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

Two of the four public routes re-check the stamp in the route itself
(`POST /pairing/requests` and `POST .../exchange`, via
`runtime.authenticator.isTrustedLoopback`) and answer `unauthorized` in the
envelope when it fails. `GET /pairing/requests/:id` does not: it takes its
locality entirely from the proxy branch, and its own 401s are about the pairing
secret. `GET /health` performs no check of its own either — it is local because
the proxy branch above says so, and for no other reason.

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
  "capabilities": ["pairing", "credentials", "..."],
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

**Requires:** the pairing secret in the `x-coven-pairing-secret` header. That
header is the only accepted carrier — a `?secret=` query parameter is refused
with 401, so the secret never lands in a URL, a log, or a `Referer`.

Note that this route does **not** re-check the loopback stamp itself; the proxy
branch is what makes it local.

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
| 401 | `unauthorized` | The id is not a UUID, the secret header is absent or not 43 base64url characters, **or** the secret is wrong for a request that exists. |
| 404 | `not_found` | No request or terminal record carries this id. |
| 409 | `conflict` | Already exchanged. `details.reason` is `"pairing_replayed"`. |

The 401/404 split is observable: a well-formed wrong secret against a *known*
id answers 401, and against an *unknown* id answers 404. With 122-bit random
ids this is not a practical enumeration oracle, but it is the behaviour.

### `POST /api/client/v1/pairing/requests/:id/exchange`

Redeems an approved pairing request for a bearer credential. Exactly once —
this is the step that consumes the user's approval.

**Requires:** the loopback stamp, the `x-coven-pairing-secret` header, and (at
the proxy) `Content-Length: 0`. No request body.

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
| 429 | `rate_limited` | The per-pairing wrong-secret budget is spent. | Yes, after `Retry-After` |
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
pairing under attack; other pairings are unaffected.

## Administrator routes

These four are the Cave's own consent surface: the settings UI that lists
pending requests, approves or denies them, lists issued credentials, and revokes
one. They are **not** part of the client-facing API — a paired client has no
business calling them and holds nothing that would authenticate it if it tried.

### Authentication, and how it fails

All four call `requireClientV1Admin`, which:

1. Reads `COVEN_CAVE_AUTH_TOKEN`. **If it is unset or blank, every admin route
   answers `503 service_unavailable`** with *"Cave admin authorization is not
   configured. Start Cave through the desktop app."* This is a fail-closed
   default, and it is the state a plain `pnpm dev` is in. The practical
   consequence is worth stating plainly: on a tokenless Cave, a client can open
   a pairing request and can never get it approved, because the approval route
   is 503. The exchange keeps answering `pairing_pending` until the TTL expires.
2. Compares the `x-coven-cave-token` header against it in constant time.
   Mismatch or absence is `401 unauthorized`.
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

`requireClientV1Admin` deliberately does **not** consult the loopback stamp. Its
own comment gives the reason: transport locality is not proof of the
administrator, and the per-launch sidecar credential is.

**Current gap ([#4843](https://github.com/OpenCoven/coven-cave/issues/4843)).**
Because `/api/client/v1/admin/*` appears in neither the public nor the
authenticated path list, `clientV1IngressKind` returns `null` for it and the
family never enters the direct-loopback branch in `proxy.ts`. It is reachable by
anything that holds the sidecar token, including a non-browser caller arriving
over Tailscale Serve with no `Origin`/`Referer` — which can therefore *read* the
credential list and the pending-request list. Mutations still fail, because a
`ts.net` origin does not satisfy the same-origin check. Severity is low (the
token is per-launch and never leaves the machine) and binding the family to
direct loopback is a design decision under review, not a patch to apply
blindly. Documented here because it is the behaviour today.

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
| Pairing exchange failure | 10 / 60 s | the pairing request id | only a **wrong** secret on `POST .../exchange` |
| Authenticated requests | 120 / 60 s | credential id | *nothing yet* — no route calls it |
| Invalid bearer | 120 / 60 s | source identity | *nothing yet* — no route calls it |

Creation is bounded process-wide on purpose: each accepted request occupies a
slot in a fixed-size store, so the quantity worth bounding is the total rate of
creation. Every finer key would be caller-chosen (`installationId`, `appName`)
and so trivially varied to escape the bound.

A 429 carries a `Retry-After` header in seconds and puts `limit` and `resetAt`
(epoch ms, as strings) in `error.details`.

**The exchange budget is not a system-wide bound
([#4846](https://github.com/OpenCoven/coven-cave/issues/4846)).**
`GET /pairing/requests/:id` performs the byte-identical secret comparison
against the same hash and consults **no rate limiter at all**, distinguishing a
wrong secret (401) from a right one (200/409). An attacker holding a pairing id
can therefore guess through the GET route unmetered and spend a single exchange
call once it succeeds. It is not practically exploitable — the secret is 256
bits of randomness, ingress is loopback-only, and the request lives five
minutes — but the exchange route's budget bounds one of the two comparison
sites, not both. The exchange route's own comment says so rather than
overclaiming.

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

The file is 0600 inside a 0700 directory it verifies is neither a symlink nor
another user's, written temp-file → `fsync` → rename, and deleted on shutdown —
but only if the record still carries *this* process's `nonce` and the same
inode, so a Cave that has been restarted underneath never deletes its
successor's record. **A publish failure is fatal**: the listener closes and the
process exits 1 rather than serving on an endpoint nothing can discover.

`endpoint` is validated before it is written: `http:`, a loopback host, an
explicit port, no credentials, no path, query, or fragment. Treat `pid` and
`startedAt` as staleness hints — a `SIGKILL`ed Cave leaves its record behind,
and nothing clears it until the next Cave boots and overwrites it — so confirm
the endpoint with `GET /health` and check `instanceId` before trusting it. The
file is 0600 and owned by the user the Cave runs as, so a client reads it only
by already being that user on that machine.

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
   `pairing_expired`, and `conflict` are terminal.
4. On 200, persist `bearer` in the platform keychain, keyed by `instanceId`, and
   discard the pairing secret.
5. If `instanceId` ever changes, discard the bearer and pair again.

## Known gaps

Stated because a client author will otherwise discover them by writing code
against something that is not there.

- **No authenticated route exists.** `requireScope`, `consumeAuthenticated`, and
  `consumeInvalidBearer` have zero non-test call sites, so a bearer is currently
  issued, persisted, listed, and revocable — and never verified. Tracked as
  [#4841](https://github.com/OpenCoven/coven-cave/issues/4841), which must be
  resolved before the first authenticated route lands. The thirteen paths in
  `CLIENT_V1_AUTHENTICATED_PATHS` (`src/proxy-helpers.ts`) are the ingress
  wiring for routes that do not yet exist; a request to any of them passes the
  same direct-loopback gate and then reaches no handler.
- **Scopes are recorded, not enforced.** They are validated on request, stored
  on the credential, and shown to the approving user. Nothing reads them at
  request time yet, because nothing consumes a credential.
- **The reviewed discovery module has no production caller** — but the record
  itself is written; see *Finding the endpoint* above. `server.ts` cannot import
  from `src/`, so it carries its own copy of the publish/remove logic and
  `publishClientV1DiscoveryRecord` in
  `src/lib/server/client-v1/discovery.ts` is reached only by its own tests. Two
  implementations of one on-disk contract can drift, and the `src/lib` one is
  the reviewed side.
- **Admin routes are not bound to direct loopback** —
  [#4843](https://github.com/OpenCoven/coven-cave/issues/4843), described above.
- **The GET lookup route is unmetered** —
  [#4846](https://github.com/OpenCoven/coven-cave/issues/4846), described above.
- **`requestId` is never emitted**, so there is no server-assigned correlation
  id to quote in a bug report. The envelope field exists; no route sets it.
