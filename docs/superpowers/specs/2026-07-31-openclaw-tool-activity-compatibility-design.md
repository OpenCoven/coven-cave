# OpenClaw Tool-Activity Compatibility Design

**Bead:** `cave-53iko`  
**GitHub:** #3847, #3865, PR #3905  
**Status:** Approved design

## Goal

Enable live and persisted OpenClaw tool activity without trusting undocumented
payloads. Cave must support running, update, completed, error, resume, and
cancelled states with stable tool-call IDs while preserving plain chat whenever
the installed Gateway is unsupported or its event contract changes.

The existing direct Gateway dispatcher remains the transport authority. It
already authenticates through the official client, binds events to the
Gateway-accepted run ID, rejects replay and sequence gaps, and falls back to the
CLI before dispatch when compatibility cannot be established.

## Current Compatibility Boundary

Cave pins `@openclaw/gateway-client` and
`@openclaw/gateway-protocol@2026.7.2-beta.4`. OpenClaw beta.5 is the newest
published package at design time.

Both beta.4 and beta.5 publish:

- wire protocol v4;
- authenticated Gateway discovery through `HelloOkSchema`;
- `chat.send`, `chat.abort`, and `sessions.messages.subscribe`;
- the `chat` event schema;
- `AgentEventSchema`, whose outer fields are `runId`, `seq`, `stream`, `ts`,
  optional metadata, and an unrestricted `data` record.

Upstream now advertises the `tool-events` client capability and emits
`session.tool` events. Source fixtures show `stream: "tool"` with lifecycle
data such as `phase`, `toolCallId`, `name`, `args`, `partialResult`, `result`,
and `isError`. The published protocol package does not type or constrain those
data fields. Cave therefore cannot enable tool cards from the package schema
alone.

## Decision

Add a dedicated OpenClaw compatibility module backed by a signed,
maintainer-owned registry in `OpenCoven/coven-runtimes`.

The module is data-only. Registry bundles may declare bounded event aliases and
lifecycle values, but cannot provide executable code, arbitrary JSON paths,
launch arguments, selectors, or logging behavior. Cave owns all parsing,
projection, redaction, persistence, and transport behavior.

This work intentionally does not extract a generic registry framework from the
existing OpenCode and Grok implementations. Reusing their proven trust model
while keeping the OpenClaw change isolated avoids expanding this bead into a
cross-runtime migration.

## Architecture

### Compatibility module

Create `src/lib/openclaw-compatibility.ts` with:

- Gateway capability discovery types;
- signed registry bundle and profile types;
- strict structural validators;
- Ed25519 signature verification;
- monotonic sequence and payload-hash checkpoints;
- atomic cache and trust-anchor journal handling;
- compatible-profile selection;
- process-local profile-revision quarantine;
- bounded tool-event parsing;
- value-free diagnostic fingerprints.

The module returns either:

- a structured compatibility decision containing one selected profile; or
- a plain-chat decision containing a stable, safe diagnostic code.

### Discovery identity

An authenticated Gateway hello supplies:

- `server.version`;
- negotiated wire protocol;
- advertised methods;
- advertised events;
- advertised server capabilities.

Cave also computes a canonical SHA-256 hash of the imported official
`AgentEventSchema`. The signed profile binds its accepted runtime range and
capabilities to this package schema hash. This distinguishes Cave's validator
revision even though OpenClaw does not expose a Gateway-wide protocol schema
hash in `hello-ok`.

Profiles select on all of the following:

- a bounded OpenClaw server version range;
- exact wire protocol;
- required methods;
- required events;
- required server capabilities;
- required client capability;
- official `AgentEventSchema` hash.

A future server version, package schema, event family, or capability set does
not inherit an older profile automatically.

### Two-phase Gateway negotiation

Gateway dispatch uses two authenticated phases:

1. Connect without `tool-events`, validate hello, and resolve compatibility.
2. When a signed profile matches, reconnect while advertising `tool-events`
   and require the second hello to match the discovered server identity and
   profile requirements before subscribing or dispatching.

This prevents Cave from requesting capability-gated tools before it knows it
can safely consume their lifecycle. A server change between discovery and
dispatch fails closed before `chat.send`, preserving the CLI/plain-chat
fallback.

If no profile matches, Cave keeps direct chat disabled for that attempt and
uses the existing CLI path with a visible compatibility diagnostic. Once
`chat.send` might have reached the Gateway, the existing indeterminate
acknowledgement rules continue to prohibit a duplicate CLI turn.

## Registry Contract

The first bundle format is:

```ts
type OpenClawSchemaBundle = {
  format: 1;
  runtime: "openclaw";
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  keyId?: string;
  retiredProfileIds?: string[];
  profiles: OpenClawToolProfile[];
  signature?: { algorithm: "ed25519"; value: string };
};
```

Each profile contains:

- stable profile ID and optional signed priority;
- server version bounds;
- exact protocol number;
- official outer-schema hash;
- required methods, events, server capabilities, and client capabilities;
- allowed outer event names and streams;
- closed lifecycle phase sets for start, update, and result;
- direct field aliases for tool-call ID, name, input, partial output, final
  output, error flag, status, and exit code;
- terminal and error status values;
- source repository, reviewed blob SHA, and package release provenance.

All alias lists are direct keys. Nested arbitrary paths are forbidden. The
parser may inspect a small Cave-defined set of bounded envelopes, but the
registry cannot add envelopes.

## Trust, Cache, and Refresh Rules

The OpenClaw registry follows the established OpenCode and Grok model:

- an embedded, source-trusted genesis payload remains available offline and is
  byte-equivalent to the publisher's signed sequence-one payload;
- production builds package a canonical HTTPS URL, public keyring, and
  sequence/payload-hash checkpoint;
- bundles and cache wrappers have independent byte limits;
- schema/profile counts and alias counts are bounded;
- refreshes use a short timeout and a six-hour cache TTL;
- concurrent refreshes share one in-flight request;
- writes are lock-protected and atomic;
- a bounded trust-anchor journal survives cache replacement;
- equal sequence numbers must have identical signing payloads;
- lower sequences, history rewrites, partial snapshots, unauthorized
  retirement, and checkpoint mismatches are rejected;
- rejected refreshes retain the last known good bundle;
- expired remote-only contracts do not silently enable structured parsing;
- a quarantined profile revision stays disabled for the process, while a
  higher signed revision can recover.

The release workflow gets an OpenClaw registry guard parallel to the existing
OpenCode and Grok guards. It verifies that production release inputs contain a
valid URL, keyring, and checkpoint without exposing private signing material.

## Event Validation and Projection

The Gateway connection listens to `chat`, `agent`, and `session.tool`.
OpenClaw sends direct-run tool activity to capability-registered recipients on
`agent`; `session.tool` mirrors the same lifecycle for late session
subscribers. Cave accepts either only when the selected profile names it and
deduplicates identical lifecycle frames.

Every tool frame must pass:

1. exact event-name selection by the active profile;
2. official `AgentEventSchema` validation;
3. exact `sessionKey`, `agentId`, and accepted `runId` correlation;
4. existing chat-run sequence and transport-generation fences;
5. profile validation of `stream`, lifecycle phase, stable tool-call ID, and
   allowed data fields.

Tool identity is `(runId, toolCallId)`. Session-wide IDs are insufficient.

Lifecycle projection:

- **start:** create or retain a running card with stable ID, name, and input;
- **update:** patch output while preserving running state;
- **result:** settle as completed or error using explicit error fields,
  profile status values, and exit-code rules;
- **cancel:** settle every unfinished card as error/cancelled before
  `chat.abort`;
- **disconnect or sequence gap:** settle unfinished cards as error because
  Cave lacks a published history-reconciliation contract.

Tool `AgentEvent.seq` values are monotonic but may be sparse because assistant,
thinking, and lifecycle events share the upstream counter while Cave receives
only tool frames from this event family. Cave rejects replay or regression but
does not require adjacent tool sequence values. The Gateway client's transport
gap callback remains the authoritative missing-frame signal. Duplicate or
replayed events cannot mutate terminal cards. A late result cannot replace
cancelled state.

Unknown or malformed tool data quarantines the selected profile revision,
stops further tool projection for the turn, emits a safe visible diagnostic,
and lets validated assistant chat continue. Cave does not terminate a useful
plain-chat response merely because tool activity became incompatible.

## Persistence and Resume

Gateway-owned turns collect reconciled tools alongside assistant text and save
them on the assistant `ChatTurn` using the existing structured tool metadata.
Stable IDs and terminal states survive normal conversation reload.

The current OpenClaw JSONL reader remains a compatibility fallback for sessions
not created through the Gateway path. Its tool-role parsing must remain
backward compatible. Gateway-owned persistence is authoritative for the live
turn and does not reread JSONL to reconstruct already-observed events.

History reconciliation after a connection gap is out of scope until OpenClaw
publishes a versioned contract for recovering run-scoped tool lifecycle. Cave
settles unfinished cards visibly instead of inventing completion.

## Diagnostics and Privacy

Stable compatibility codes include:

- `capability-probe-unavailable`;
- `no-compatible-profile`;
- `profile-registry-refresh-rejected`;
- `cached-profile-unavailable`;
- `profile-quarantined`;
- `unknown-tool-event`;
- `tool-event-sequence-gap`;
- `tool-event-reconnect-gap`.

Diagnostics may include runtime version, protocol number, profile ID, registry
sequence, and a value-free event-shape fingerprint. They never include prompts,
paths, tool inputs, outputs, credentials, dynamic object keys, cookies, tokens,
or raw frames.

The send route surfaces compatibility through the existing progress and notice
path. Unsupported versions retain normal chat rather than silently dropping
tool activity.

## Testing

### Compatibility conformance

Fixture-driven tests cover:

- exact beta.4 and beta.5 discovery shapes;
- official outer-schema hashes;
- valid signed genesis and refreshed bundles;
- tampering, wrong key, wrong runtime, wrong schema hash, and expiry;
- rollback, equal-sequence rewrite, partial snapshot, and retirement rules;
- cache corruption, lock recovery, trust-anchor conflict, and offline use;
- profile selection across concurrent supported versions;
- process quarantine and recovery through a higher signed revision.

### Tool lifecycle

Fixtures derived from reviewed upstream source cover:

- start, update, successful result, and error result;
- missing or duplicate IDs;
- unknown phases, fields, streams, and event names;
- concurrent and foreign run rejection;
- replay, run-sequence gap, transport gap, reconnect gap, and cancellation;
- terminal-state immutability;
- redacted diagnostic fingerprints.

### Route integration

A route-level authenticated Gateway fixture proves:

- discovery before capability advertisement;
- profile resolution and capability-enabled reconnect;
- subscription before `chat.send`;
- exact accepted-run correlation;
- SSE running/completed/error cards;
- assistant text continuing after tool-profile quarantine;
- persisted cards and conversation reload;
- stop-registry cancellation fencing;
- CLI fallback before dispatch for unsupported profiles;
- no CLI fallback after an indeterminate or accepted dispatch.

OpenClaw is not installed on the development host, so tests use exact official
package validators and source-verified upstream fixtures. No stdout parsing or
live-runtime assumptions are introduced.

## Delivery Boundaries

This bead includes Cave's compatibility module, Gateway integration, tests,
documentation, and release guard. Publishing the canonical signed bundle and
configuring production release anchors in `OpenCoven/coven-runtimes` are
required deployment steps and must be recorded in the bead before closure.

The work does not:

- infer tool data from unrestricted records;
- add plaintext Gateway credentials;
- enable non-macOS paired-device storage;
- implement history reconciliation without an upstream contract;
- refactor the OpenCode/Grok registries into shared infrastructure;
- change unrelated runtime adapters or chat presentation.
