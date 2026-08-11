# OpenClaw Gateway-dispatch implementation plan

**GitHub:** #3865 (implementation issue), #3847 (parent compatibility work),
and #3852 (the retained safe CLI/plain-chat stop point). This document records
both the shipped chat-only v4 boundary and the remaining plan for full tool
lifecycle support.

## Decision

Cave must not observe a CLI-created OpenClaw run. The CLI does not expose the
Gateway's accepted run ID before `session.tool` events may arrive, so such an
observer cannot attribute tool cards safely when sessions overlap.

When a Gateway meets the supported compatibility contract, Cave dispatches the
turn through the authenticated Gateway itself. The same Gateway connection owns
the accepted `runId`, subscribes to session events, and accepts only events
belonging to that exact run. The current CLI bridge stays the authoritative
fallback for every other runtime.

## Target contract after a tool schema is published

Full tool activity requires a published, versioned `session.tool` event name,
payload validator, and lifecycle fixtures. Once those exist, Cave must request
only the documented capabilities, validate the negotiated role/scopes and
methods, and bind tool events to the Gateway-accepted run ID. Until then, no
capability string or observed frame is a substitute for a payload contract.

The direct dispatcher supplies an idempotency key, receives the accepted run
identifier, then binds all live state to `(sessionKey, agentId, runId)`. A tool
call key is `(runId, toolCallId)`, not a session-wide call ID.

No runtime is upgraded heuristically. Older protocol versions, unavailable
packages, unpaired devices, missing `operator.write`, an absent capability, or
an unknown schema use the existing CLI/plain-chat path with a visible
diagnostic. A protocol-version mismatch is a compatibility boundary, not a
reason to guess a field shape.

## Runtime sequence

1. Resolve the local OpenClaw runtime and Gateway endpoint without passing
   Gateway credentials to a fallback child process.
2. Create or load a paired device identity from OS-backed secret storage;
   authenticate with the reference Gateway client and validate `hello-ok` plus
   negotiated policy limits. Never persist credentials in plaintext or include
   them in logs, caches, SSE, or diagnostics.
3. Establish the selected canonical-session subscription before dispatching
   the turn. Add any additional subscription only when its published schema
   and contract fixture are available.
4. Send `chat.send` with the Cave message, canonical session key, agent ID,
   and an idempotency key derived from the Cave request ID. Record the
   Gateway-accepted `runId`.
5. Project only matching, schema-validated events to Cave SSE. Maintain a
   per-run high-water sequence, reject replay, and fail the owned turn on a
   forward gap until a published history-reconciliation contract is available.
6. On terminal chat state, persist the response. After a published tool schema
   is supported, also persist reconciled tool cards. On
   cancellation, first persist a per-run `cancelled` terminal fence, then abort
   the exact `runId`, close the stream, and settle only its unfinished cards.
   Every event, reconciliation, and persistence path checks that fence: a
   queued or late result for that run may not replace cancelled card or turn
   state with success.
7. Before a `chat.send` acknowledgement, resolve an ambiguous dispatch using
   its idempotency key and authoritative Gateway status/history. Start the CLI
   fallback only after acceptance is disproven; a lost acknowledgement is not
   permission to duplicate the turn.
8. After acceptance, use the official keepalive/liveness policy. On reconnect,
   restore the validated session subscription and resume only validated frames
   for the accepted run. Add history reconciliation only alongside its
   published schema; if recovery fails, terminate and settle the Gateway-owned
   turn, never replacing it with a CLI invocation.

## Compatibility and upgrade policy

- Depend on the official protocol/client packages rather than local copies of
  WebSocket framing, signing, or schemas.
- Keep an explicit profile table keyed by protocol version and package release
  range. A profile declares exact methods, events, scopes, payload validators,
  limits, and migration behavior.
- Generate/capture protocol conformance fixtures from each supported package
  release. Include supported, old/unsupported, future/unknown, missing-scope,
  pairing-required, replay, sequence-gap, disconnect, cancellation, and
  concurrent-run cases.
- Upgrade only after the schema diff and fixtures pass. Unknown wire versions
  fail closed to CLI; a new Cave release adds a tested profile.

## Current release boundary (2026-07-26)

The only published protocol/client release is the `2026.7.2-beta.4` beta
package pair, negotiating wire protocol v4. It publishes `HelloOkSchema`,
`ChatEventSchema`, `chat.send`, `chat.abort`, and
`sessions.messages.subscribe`. Cave validates that exact chat-only contract in
its dispatcher, including the accepted `(sessionKey, agentId, runId)` tuple.

The reference client delegates device identity, challenge signing, and token
lifecycle to host-owned `GatewayClientHostDeps`. Cave backs those with an
OS-backed paired-device credential store
(`src/lib/server/openclaw-device-credentials.ts`, cave-cth7q): on macOS the
Ed25519 device identity and Gateway-minted device tokens live in the login
keychain (service `coven-cave.openclaw-gateway`, written through the
`security` tool's stdin command mode so secrets never appear on argv), and
every other platform fails closed **before client construction**. In
particular, `OPENCLAW_GATEWAY_TOKEN` and `OPENCLAW_GATEWAY_DEVICE_TOKEN` still
cannot activate a write-capable direct turn — the hostDeps drop the client's
`env` bag — and dispatch stays opt-in behind `OPENCLAW_GATEWAY_DISPATCH` plus
`OPENCLAW_GATEWAY_URL`; the existing CLI/plain-chat bridge remains the
fallback everywhere the store (or the Gateway) is unavailable. An invalid
persisted identity fails loudly and is never silently regenerated, because
regeneration would silently unpair the device.

The release also does **not** publish a `session.tool` event name, payload
schema, or validator. Cave emits no Gateway tool card for this release and does
not request an unpublished tool-event capability. A method/event capability
string is not a substitute for a versioned payload contract.

| Package profile | Wire protocol | Runtime projection | Tool cards | Upgrade rule |
| --- | --- | --- | --- | --- |
| `2026.7.2-beta.4` | v4 only | Correlated `chat` frames on macOS via the keychain-backed paired-device store; all other platforms fail closed | Disabled: no published schema (re-verified against `2026.7.2-beta.5`, whose `AgentEvent.data` is unchanged and whose typed `tool.*` events belong to the Talk surface only) | Add a fixture and explicit profile only when OpenClaw publishes a stable tool payload validator. |
| Any other version/profile | Not assumed | None | Disabled | Keep CLI/plain chat with a visible compatibility diagnostic. |

Before enabling tool cards, record the package release, exported validator,
schema diff, and fixtures for lifecycle, foreign-run rejection, malformed
payload, replay, gap, disconnect, and cancellation. Do not infer a tool shape
from an observed Gateway frame.

## Verification

Add a route-level Gateway fixture that performs the real authenticated
handshake, subscription, `chat.send` acknowledgement, and emitted chat
lifecycle. It must prove that matching chat frames reach SSE and persistence
and that otherwise-valid concurrent-session frames are rejected. Once a
published tool validator exists, extend it with start/update/result cards,
history reconciliation, and every fallback boundary above.

## Delivery slices

1. Add official protocol/client dependencies, capability/profile discovery,
   paired-device credential storage, and protocol fixtures.
2. Implement one owned Gateway turn with chat SSE projection and a CLI fallback
   selected before dispatch.
3. Implement correlated tool lifecycle, persistence, cancellation, and
   reconciliation.
4. Add cross-version conformance and route-level integration tests; document
   operator setup and upgrade support boundaries.
