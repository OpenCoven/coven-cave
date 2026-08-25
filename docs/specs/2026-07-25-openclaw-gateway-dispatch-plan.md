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

## Tool compatibility contract

OpenClaw's official `AgentEventSchema` validates the outer event envelope but
leaves `data` unrestricted. Cave therefore combines that official outer schema
with a signed, data-only profile from the OpenClaw compatibility registry. A
profile may select fixed event names and streams, closed lifecycle values, and
direct field aliases. It cannot add executable code, arbitrary JSON paths,
launch arguments, logging behavior, or new envelopes. No capability string or
observed frame is a substitute for this verified contract.

Negotiation is two-phase. Cave first connects without `tool-events`, validates
the authenticated hello, and selects a profile against the exact server
version, protocol, methods, events, server capabilities, client capability, and
official package-schema hash. Only then does it reconnect advertising
`tool-events`; the second hello must preserve the selected identity before Cave
subscribes or dispatches.

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
3. Resolve the signed compatibility profile, reconnect with `tool-events`, and
   establish the selected canonical-session subscription before dispatching.
   Accept `agent` and `session.tool` only when the selected profile names them.
4. Send `chat.send` with the Cave message, canonical session key, agent ID,
   and an idempotency key derived from the Cave request ID. Record the
   Gateway-accepted `runId`.
5. Project only matching, schema-validated events to Cave SSE. Maintain a
   per-run high-water sequence and reject replay or regression. Tool sequence
   values may be sparse because other agent streams share the counter; the
   Gateway transport gap callback remains the missing-frame authority.
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
- Resolve bounded profiles from the Ed25519-signed OpenClaw registry. A profile
  declares exact versions, protocol, methods, events, capabilities, official
  outer-schema hash, lifecycle values, and direct aliases.
- Generate/capture protocol conformance fixtures from each supported package
  release. Include supported, old/unsupported, future/unknown, missing-scope,
  pairing-required, replay, sequence-gap, disconnect, cancellation, and
  concurrent-run cases.
- Upgrade only after source review and conformance fixtures pass. Compatible
  signed profile revisions can ship without a Cave UI release; unknown wire
  versions and profile shapes fail closed to CLI/plain chat.

## Current release boundary (2026-07-31)

Cave pins the `2026.7.2-beta.5` protocol/client package pair and negotiates
wire protocol v4. It validates `HelloOkSchema`, `ChatEventSchema`, and
`AgentEventSchema`, then selects an exact compatibility profile for
`chat.send`, `chat.abort`, `sessions.messages.subscribe`, `chat`, `agent`, and
`session.tool`. The built-in profile is pinned to the upstream source revision
that defines the tool lifecycle aliases and phases; no observed payload can
expand that contract at runtime.

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

| Package profile | Wire protocol | Runtime projection | Tool cards | Upgrade rule |
| --- | --- | --- | --- | --- |
| `2026.7.2-beta.4` | v4 only | Unsupported by the current tool profile | Disabled | Keep CLI/plain chat. |
| `2026.7.2-beta.5` + source profile `d66b514a7e7565d89c87ab6f1a509623128093f0` | v4 only | Correlated `chat` plus schema-validated `agent` / `session.tool` frames on macOS via the keychain-backed paired-device store; all other platforms fail closed | Enabled only for the exact accepted `(sessionKey, agentId, runId)` and pinned lifecycle profile | Add a new fixture and explicit profile for every package or source-contract change. |
| Any other version/profile | Not assumed | None | Disabled | Keep CLI/plain chat with a visible compatibility diagnostic. |

The conformance suite records the package release, schema hash, source revision,
and lifecycle fixtures. It covers foreign-run rejection, malformed payloads,
replay, gaps, disconnects, reconnects, cancellation, compatibility quarantine,
and route-level WebSocket-to-SSE/persistence projection. Do not infer a tool
shape from an observed Gateway frame.

## Verification

The route-level Gateway fixture performs the real WebSocket challenge/connect
handshake, subscription, `chat.send` acknowledgement, and emitted chat/tool
lifecycle. It proves that one accepted run reaches SSE and persistence with
start/update/result cards while an otherwise-valid concurrent run is rejected.
History reconciliation remains disabled until OpenClaw publishes that contract;
gaps therefore terminate the owned Gateway path instead of guessing.

## Delivery slices

The Cave-side slices are implemented: official package pins, paired-device
storage, signed profile resolution, two-phase dispatch, correlated lifecycle,
SSE/persistence/resume, quarantine/fallback, and conformance fixtures. The
remaining deployment slice is owned by `OpenCoven/coven-runtimes`: publish the
canonical signed sequence-one bundle and configure Cave's production URL,
public keyring, and checkpoint. Cave remains fail-closed until those public
trust anchors are present.
