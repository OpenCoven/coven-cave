# OpenClaw Gateway-dispatch implementation plan

**GitHub:** #3865 (implementation issue), #3847 (parent compatibility work),
and #3852 (the retained safe CLI/plain-chat stop point). This document is a
planning contract only; it does not enable Gateway dispatch.

## Decision

Cave must not observe a CLI-created OpenClaw run. The CLI does not expose the
Gateway's accepted run ID before `session.tool` events may arrive, so such an
observer cannot attribute tool cards safely when sessions overlap.

When a Gateway meets the supported compatibility contract, Cave dispatches the
turn through the authenticated Gateway itself. The same Gateway connection owns
the accepted `runId`, subscribes to session events, and accepts only events
belonging to that exact run. The current CLI bridge stays the authoritative
fallback for every other runtime.

## Supported contract

The first supported profile is OpenClaw Gateway protocol v4 using the published
`@openclaw/gateway-client` and `@openclaw/gateway-protocol` packages pinned in
Cave's lockfile. Cave requests `operator.read` and `operator.write`, advertises
only `tool-events` and `session-scoped-events`, validates the negotiated
role/scopes, and requires the documented `chat.send`, `sessions.subscribe`,
`sessions.messages.subscribe`, `chat`, and `session.tool` surfaces.

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
3. Establish `sessions.subscribe` and the selected canonical-session
   subscription before dispatching the turn.
4. Send `chat.send` with the Cave message, canonical session key, agent ID,
   and an idempotency key derived from the Cave request ID. Record the
   Gateway-accepted `runId`.
5. Project only matching `chat` and `session.tool` events to Cave SSE. Maintain
   a per-run high-water sequence, reject replay, reload history on a forward
   gap, and never treat an unknown event as liveness.
6. On terminal chat state, persist the response and reconciled tool cards. On
   cancellation, abort the exact `runId`, close the stream, and settle only its
   unfinished cards.
7. Before a `chat.send` acknowledgement, resolve an ambiguous dispatch using
   its idempotency key and authoritative Gateway status/history. Start the CLI
   fallback only after acceptance is disproven; a lost acknowledgement is not
   permission to duplicate the turn.
8. After acceptance, use the official keepalive/liveness policy. On reconnect,
   restore both subscriptions, reconcile authoritative history and the active
   run, then resume only validated frames for the accepted run. If recovery
   fails, terminate and settle the Gateway-owned turn; never replace it with a
   CLI invocation.

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

## Verification

Add a route-level Gateway fixture that performs the real authenticated
handshake, subscriptions, `chat.send` acknowledgement, and emitted chat/tool
lifecycle. It must prove that start/update/result cards reach SSE and
persistence for the accepted run, and that otherwise-valid concurrent-session
frames are rejected. Exercise cancellation, reconnect/history reconciliation,
and every fallback boundary above.

## Delivery slices

1. Add official protocol/client dependencies, capability/profile discovery,
   paired-device credential storage, and protocol fixtures.
2. Implement one owned Gateway turn with chat SSE projection and a CLI fallback
   selected before dispatch.
3. Implement correlated tool lifecycle, persistence, cancellation, and
   reconciliation.
4. Add cross-version conformance and route-level integration tests; document
   operator setup and upgrade support boundaries.
