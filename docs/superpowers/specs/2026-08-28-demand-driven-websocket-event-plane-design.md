# Demand-driven WebSocket event plane design

**Bead:** `cave-qjvbb.1`

**Parent:** `cave-qjvbb`

**Status:** Approved design

**Date:** 2026-08-28

**Scope:** Browser, Tauri desktop, and iOS

## Goal

Reduce repeated API reads and stale cross-client state by adding one
demand-driven, authenticated WebSocket invalidation/control plane for:

- sessions;
- board cards;
- run status;
- familiar roster state; and
- daemon connectivity.

The event plane tells clients which authoritative REST snapshots may be stale.
It does not move resource bodies or mutations onto the socket.

This design supersedes the parent performance plan's proposed resource-version
SSE transport for these five pilot resources. It does not replace the existing
chat, inbox, or research SSE streams.

## Success criteria

1. A client with no event-plane subscribers opens no socket.
2. A subscribed browser or Tauri webview owns at most one event socket.
3. HTTPS, MagicDNS, and Tailscale pages use `wss:`; direct loopback pages use
   `ws:` because the local sidecar does not terminate TLS.
4. After initial snapshots, a healthy event connection causes zero recurring
   REST reads for the five covered resources during a 60-second idle window.
5. A burst of invalidations causes at most one replacement fetch per dirty
   topic and client.
6. A dropped, refused, or unsupported socket restores bounded adaptive polling
   without removing manual refresh or foreground reconciliation.
7. Browser, Tauri, and iOS decode the same versioned wire fixtures.
8. Existing REST and SSE behavior remains correct when the event plane is
   disabled.

## Non-goals

- Moving REST mutations onto WebSockets.
- Sending complete resource snapshots over WebSockets.
- Replacing token-streaming chat SSE.
- Replacing inbox or research SSE.
- Eliminating GitHub, Asana, or other upstream polling when the provider does
  not supply a webhook or push source.
- Electing a leader WebSocket across desktop windows in the first version.
- Adding a second listening port or a separate TLS server.

## Existing contracts retained

The implementation must build on these current contracts:

- `server.ts` already owns `WebSocketServer({ noServer: true })` and the HTTP
  upgrade path for `/api/pty-ws`.
- `src/lib/websocket-url.ts` is the only browser authority for choosing `ws:`
  versus `wss:` and constructing a same-host URL.
- The PTY socket already has bounded target parsing, signed mobile credential
  support, sidecar credential support, source validation, replay, reconnect,
  backpressure, and explicit close behavior.
- `src/components/security/sidecar-auth-bridge.tsx` patches WebSocket,
  EventSource, and fetch before hydration so packaged webviews can attach the
  sidecar credential.
- REST snapshots remain the source of truth.
- `usePausablePoll`, `useRefreshOnFocus`, request-generation guards, and the
  surface warm cache already provide safe fallback and reconciliation
  primitives.
- Browser cross-window preference synchronization already uses
  `BroadcastChannel`, but it does not own server connectivity.
- iOS already has pooled REST/SSE sessions, a single-flight connection refresh
  coordinator, secure credential-origin checks, and scene-aware polling.

## Chosen approach

Use one demand-driven event socket per active browser/Tauri webview and one per
active iOS app process.

The first subscriber creates the connection. Subscribers reference-count an
allowlisted set of topics and update the live subscription set as surfaces
mount and unmount. When the final subscriber leaves, the manager waits a
15-second grace period before closing the socket so quick navigation does not
cause connection churn.

This is preferred over desktop leader election because a small number of
same-process sockets is cheap, while leader election adds ownership leases,
failover races, stale leaders, and BroadcastChannel recovery paths before
connection count is known to be a problem.

It is preferred over a general resource SSE stream because live subscription
changes, cumulative acknowledgements, explicit protocol negotiation, and
future control messages fit a bidirectional channel without reopening an HTTP
stream for every topic-set change.

## Server architecture

### Upgrade routing

The existing HTTP server continues to own all upgrades:

```text
HTTP server
  |- /api/pty-ws    -> PTY capability
  |- /api/events-ws -> event-plane capability
  `- everything else -> Next upgrade handler
```

Shared upgrade code may be extracted only for:

- bounded URL and query parsing;
- direct-loopback classification;
- same-host and Origin validation;
- sidecar and signed mobile credential verification; and
- consistent HTTP rejection responses.

Capability-specific authorization remains separate. The PTY endpoint keeps its
remote passkey-presence requirement because it grants an interactive shell.
The event endpoint requires the paired access or sidecar credential for remote
clients, but not PTY-specific passkey presence, because it exposes only
invalidation metadata and must support ordinary paired-app refresh.

### Broker

The event broker is process-local and owns:

- one random epoch per server boot;
- one monotonically increasing safe-integer sequence;
- one monotonically increasing version per topic;
- a bounded replay ring;
- connected-client subscription sets;
- the highest cumulative acknowledgement reported by each client; and
- diagnostic counters.

The replay ring is bounded by both 2,048 events and 1 MiB of encoded event data.
Oldest events are removed first when either limit is exceeded.

The server runtime remains in `server.ts` so the packaged `server.mjs` does not
gain an unresolved local import under the current unbundled server build. Next
route and library code reaches the broker through a typed facade backed by an
established `globalThis` bridge. The facade is a no-op only when the capability
is explicitly disabled; missing or malformed broker state is surfaced as a
diagnostic failure rather than treated as a successful publish.

### Publishers

All publishers call one operation:

```ts
markResourceChanged(
  topic: CaveEventTopic,
  entityIds?: readonly string[],
): void
```

Direct writes call it only after their durable commit succeeds. State observed
outside a direct write, such as a daemon or run transition, calls it from the
existing supervisor that first establishes the new state.

The pilot publishers are:

| Topic | Authoritative publishing boundary |
| --- | --- |
| `board` | `cave-board.ts` mutators after the atomic board write |
| `sessions` | conversation/session persistence and deletion boundaries |
| `runs` | chat and automation runner lifecycle transitions after persisted status changes |
| `familiars` | roster, summon, removal, runtime, and archive mutations after commit |
| `daemon` | a server-owned daemon watcher after the classified state changes |

Route handlers must not publish merely because they received a request. A
rejected request, failed write, or no-op mutation emits nothing.

If a state source can only be learned by polling an upstream system, the server
may retain that poll and publish only when the observed state changes. The
event socket does not claim to turn a pull-only provider into a push source.

## Discovery and dynamic creation

A daemon-independent `GET /api/events/capability` response advertises:

```ts
type CaveEventPlaneCapability = {
  enabled: boolean;
  protocolVersion: 1;
  path: "/api/events-ws";
  topics: CaveEventTopic[];
  rolloutMode: {
    web: "off" | "shadow" | "primary";
    ios: "off" | "shadow" | "primary";
  };
};
```

Clients do not assume the endpoint exists. They create a socket only when:

1. the capability is enabled;
2. at least one supported topic has a subscriber; and
3. that platform's rollout mode is not `off`; and
4. the platform is in a state where network work is allowed.

The endpoint is always same-host. Browser and Tauri callers pass the advertised
path through `websocketUrl()`. This yields:

- `wss://<host>/api/events-ws` for an HTTPS or WSS page; and
- `ws://<loopback>/api/events-ws` for the local HTTP sidecar.

The server never attempts to infer frontend TLS from its loopback request. A
Tailscale Serve connection terminates TLS before forwarding the upgrade, so
the browser chooses `wss:` while the server validates the forwarded same-host
request without requiring its internal hop to be TLS.

## Wire protocol

All application messages are UTF-8 JSON text frames. Binary client frames are
rejected. Inbound frames are limited to 16 KiB before parsing.

### Topics

```ts
type CaveEventTopic =
  | "sessions"
  | "board"
  | "runs"
  | "familiars"
  | "daemon";
```

Unknown topics are rejected rather than ignored. Entity IDs are optional,
advisory optimization hints. An event may contain at most 32 IDs, each at most
256 UTF-8 bytes. Clients must remain correct when IDs are omitted.

### Client messages

```ts
type EventClientMessage =
  | {
      type: "hello";
      protocol: 1;
      clientId: string;
      topics: CaveEventTopic[];
      resume?: { epoch: string; seq: number };
    }
  | {
      type: "subscribe";
      protocol: 1;
      topics: CaveEventTopic[];
    }
  | {
      type: "ack";
      protocol: 1;
      epoch: string;
      seq: number;
    };
```

`subscribe` replaces the complete topic set; it is not an incremental add or
remove operation. This makes reconnection and reference-count reconciliation
deterministic.

Clients acknowledge the highest sequence they have processed. Acknowledgement
is cumulative, is sent at most once per second during activity, and is flushed
before an intentional close when possible. Replay retention is still bounded
globally; an acknowledgement cannot force the server to retain history.

### Server messages

```ts
type EventServerMessage =
  | {
      type: "ready";
      protocol: 1;
      epoch: string;
      seq: number;
      topics: CaveEventTopic[];
      versions: Partial<Record<CaveEventTopic, number>>;
    }
  | {
      type: "invalidate";
      protocol: 1;
      epoch: string;
      seq: number;
      topic: CaveEventTopic;
      version: number;
      entityIds?: string[];
    }
  | {
      type: "resync-required";
      protocol: 1;
      epoch: string;
      seq: number;
      topics: CaveEventTopic[];
      reason:
        | "server-restarted"
        | "replay-gap";
    };
```

Every invalidation increments both the global sequence and that topic's
version. The server sends events only to clients currently subscribed to the
topic. An unsupported protocol version is rejected during `hello` with the
dedicated protocol close code; the server does not send a versioned envelope
that the client has already declared it cannot understand.

Protocol close codes are fixed across the server, TypeScript client, and Swift
client:

| Code | Meaning |
| --- | --- |
| `4400` | unsupported protocol |
| `4402` | malformed, binary, oversized, or otherwise invalid frame |
| `4408` | slow consumer; retryable with backoff |

## Subscription and snapshot data flow

The client sequence is:

1. Load capabilities.
2. Register the first topic subscriber.
3. Open the same-host event socket.
4. Send `hello` with the complete topic set and any in-memory resume cursor.
5. Receive replay events or `resync-required`.
6. Receive `ready`.
7. Fetch authoritative REST snapshots for topics that need initial or full
   reconciliation.
8. Apply later invalidations through topic-specific refresh coordinators.

`ready` is the subscription barrier. A client does not begin its authoritative
initial fetch until the server has installed its subscription.

`subscribe` replaces the complete topic set and the server answers with a new
`ready` carrying that installed set and current versions. A newly added topic
does not become healthy and cannot suppress polling until that later `ready`
arrives.

Each topic keeps a local invalidation generation. A snapshot fetch captures
the generation at start. If an invalidation increments the generation while
the fetch is in flight, that response is not applied; the coordinator performs
one coalesced replacement fetch. This closes the subscribe/read race without
claiming that an asynchronous file read and a version counter are an atomic
transaction.

Multiple invalidations for the same topic within 100 milliseconds coalesce
into one dirty notification. Entity IDs are unioned up to the protocol bound.
When the bound would be exceeded, IDs are dropped and the topic remains a full
invalidation.

## Browser and Tauri client

Add one browser-safe event-plane manager with:

- capability negotiation;
- topic reference counting;
- one socket per webview;
- connection and protocol state;
- an 8-second connect timeout;
- replacement subscriptions;
- replay cursor tracking;
- cumulative acknowledgements;
- invalidation coalescing;
- bounded reconnect backoff;
- diagnostics; and
- subscriber callbacks.

A React hook subscribes a component or store to one or more topics. The hook
does not fetch data itself. Existing owners continue to control loading,
optimistic state, interaction locks, and error presentation.

When a surface is hidden, invalidations mark topics dirty but do not trigger
REST reads. Foreground reconciliation performs one refresh for each dirty
topic and no unconditional covered-topic refresh when the topic stayed clean.
The socket may remain connected while subscribers exist because tiny
invalidation frames are cheaper than repeated full snapshots.

The sidecar auth bridge adds its token only when a WebSocket is:

- same-host;
- `ws:` or `wss:`; and
- exactly `/api/pty-ws` or `/api/events-ws`.

No token is attached to another path or host.

## iOS client

The iOS phase adds a `CaveEventSocket` actor around
`URLSessionWebSocketTask`.

`CaveConnection` derives the event URL from its resolved base URL:

- `https:` becomes `wss:`;
- loopback `http:` becomes `ws:`; and
- credentialed non-loopback plaintext is refused.

The socket request carries the paired bearer credential and must pass the same
exact credential-origin match used by REST/SSE requests.

The actor:

- starts only while the scene is active and at least one store subscribes;
- sends the complete subscription set after every change;
- tracks epoch and sequence in memory;
- cancels when the app enters the background;
- reconnects and resumes on foreground;
- reports health to the connection supervisor; and
- exposes invalidations through typed asynchronous callbacks.

`AppModel`, session/task stores, familiar dashboard state, run state, and
connection state consume invalidations through their current single-flight
refresh coordinators. When the socket is healthy, covered timers pause. When
it is unhealthy, the existing scene-aware polling policies resume.

TypeScript and Swift decode the same checked-in golden JSON messages. Neither
platform may add private wire meanings.

## Fallback and failure handling

The event plane is an optimization, not an availability dependency.

### Connection state

```ts
type CaveEventPlaneState =
  | "disabled"
  | "idle"
  | "connecting"
  | "ready"
  | "backing-off"
  | "degraded";
```

Reconnect uses exponential backoff starting at 500 milliseconds, capped at 30
seconds, with 0.8-1.2 jitter. A foreground event may request one immediate
attempt without creating a parallel connection.

### Adaptive polling

Each covered resource retains one fallback poll owner. The poll is enabled
when:

- the event capability is absent or disabled;
- the socket has not reached `ready`;
- the topic subscription was rejected;
- the connection is backing off or degraded; or
- a resync has not yet completed.

The poll pauses only after the topic is subscribed and the connection is
healthy. Manual retry and `useRefreshOnFocus` remain active.

### Heartbeats and backpressure

The server sends native WebSocket ping frames every 25 seconds. A client that
does not answer by the next heartbeat is terminated. Browsers answer native
ping frames automatically.

Before sending, the server checks `bufferedAmount`. A client above the bounded
slow-consumer threshold is closed with a dedicated retryable close code rather
than allowed to retain unbounded output.

Malformed messages, unsupported protocol versions, unknown topics, oversized
frames, impossible cursors, and invalid acknowledgements receive explicit
non-secret close reasons and close codes. Authentication failures disclose no
topic, sequence, epoch, or capability details.

## Interaction safety

An invalidation means "the snapshot may be stale," not "replace local UI now."

Topic consumers preserve their existing interaction gates:

- Board marks itself dirty during drag, edit, undo, inspector, and confirmation
  states, then refreshes once the interaction ends.
- Session lists keep request and familiar-scope generation guards.
- Optimistic mutations reconcile against the next authoritative snapshot
  rather than being overwritten immediately.
- Hidden surfaces invalidate warm-cache entries but delay point-in-time reads
  until navigation or foreground.

## Observability

Diagnostics expose counts and current state, never credentials or resource
payloads:

- connection attempts and successful opens;
- active connections and topic subscriptions;
- reconnects and current backoff;
- invalidations published and delivered by topic;
- replay successes and replay gaps;
- full resync requests;
- cumulative acknowledgements;
- coalesced invalidations and replacement fetches;
- slow-consumer closures;
- fallback activations; and
- recurring polls avoided.

The server performance report consumes broker-side connection, publication,
replay, acknowledgement, and backpressure counters. The browser/Tauri debug
surface consumes client-side reconnect, coalescing, fallback, and avoided-poll
counters. Logging uses endpoint, close code, topic, and aggregate counts; it
does not log bearer tokens, cookies, entity payloads, or complete client
messages.

## Capability and rollback controls

The server supports an event-plane kill switch. When disabled:

- capabilities advertise `enabled: false`;
- `/api/events-ws` refuses the upgrade without disclosing broker state;
- REST and existing SSE routes continue unchanged; and
- all covered clients remain on their fallback polling paths.

Each platform has an independent client rollout mode:

1. `off` - do not connect;
2. `shadow` - connect, validate, and record invalidations while polling remains
   authoritative; and
3. `primary` - pause covered polling while the topic is healthy.

Rollout mode is explicit and observable. A transport error never silently
changes a permanent user preference.

## Test strategy

### Pure TypeScript tests

Test:

- protocol parsing and encoding;
- every size and count bound;
- unknown topic and version rejection;
- topic reference counting;
- first-subscriber open and last-subscriber grace close;
- complete-set subscription replacement;
- connect timeout;
- epoch and sequence resume handling;
- acknowledgement throttling;
- coalescing and entity-ID overflow;
- stale snapshot rejection;
- hidden-window dirty handling;
- reconnect backoff and jitter;
- fallback state transitions; and
- zero subscribers creating zero sockets.

Socket, clock, visibility, and capability dependencies are injected so these
tests are deterministic.

### Broker tests

Test:

- monotonic global sequences and per-topic versions;
- topic-filtered fan-out;
- bounded replay by count and bytes;
- successful replay;
- restart epoch resync;
- replay-gap resync;
- cumulative acknowledgement tracking;
- heartbeat timeout;
- slow-consumer eviction;
- client cleanup on close; and
- publish failure diagnostics when broker state is unavailable.

### Upgrade security tests

Extend the existing WebSocket upgrade coverage for:

- exact `/api/events-ws` routing;
- direct-loopback access;
- valid and invalid sidecar credentials;
- valid, expired, and malformed signed mobile credentials;
- missing Host and Origin;
- cross-host and cross-origin requests;
- forwarded Tailscale same-host requests;
- no PTY passkey requirement on the event capability;
- preserved PTY passkey enforcement; and
- authentication failure before protocol disclosure.

### Mutation integration tests

For each pilot topic, prove:

1. a successful durable transition emits after commit;
2. a failed or rejected transition emits nothing;
3. a no-op transition emits nothing; and
4. a burst is observed as one coalesced client refresh.

Board tests cover create, update, lifecycle, delete, restore, and clear paths.
Session tests cover creation, persisted turn settlement, rename, deletion, and
external completion observed by the session source. Run tests cover queued,
running, terminal, cancellation, and stale-run reconciliation. Familiar tests
cover summon, remove, archive, restore, and runtime changes. Daemon tests cover
offline, connecting, healthy, degraded, and restart transitions.

### Browser and Tauri tests

Test:

- `ws:` loopback and `wss:` secure-origin derivation;
- exact sidecar token injection for `/api/events-ws`;
- no token injection for another path or host;
- WebSocket constructor statics after patching;
- WebKit connect timeout and reconnect behavior;
- foreground reconciliation;
- hidden-window fetch suppression;
- Board interaction deferral;
- polling pause only after `ready`;
- polling restoration after close; and
- CSP/Tauri permissions allowing only intended same-origin socket targets.

A production-sidecar smoke test opens the event socket against the packaged
server path and verifies one authenticated invalidation round trip.

### iOS tests

Inject the WebSocket task factory and clock. Test:

- HTTP/HTTPS to WS/WSS derivation;
- credentialed plaintext remote refusal;
- exact credential-origin matching;
- Authorization on the upgrade request;
- protocol fixture decoding;
- scene-active start and background cancellation;
- reference-counted subscriptions;
- replay and resync;
- connection-supervisor handoff;
- polling pause and restoration; and
- unchanged store state for duplicate or older versions.

### Cross-platform conformance

Checked-in golden fixtures cover every client and server message plus malformed
examples. TypeScript and Swift tests both consume them. A protocol change must
update both decoders and the protocol version in one change.

### Performance regression gates

Automated tests prove:

- zero covered recurring reads in a healthy 60-second idle window after
  snapshots settle;
- no more than one refetch per topic for an invalidation burst;
- no socket without subscribers;
- one socket maximum per webview/app process;
- bounded replay count and bytes;
- bounded outbound buffering; and
- fallback cadence never exceeds the resource's current poll cadence.

An informational benchmark records loopback mutation-to-dirty-notification and
mutation-to-reconciled-snapshot latency without using wall-clock p95 as a
flaky CI gate.

## Rollout

### Phase 1: protocol and broker

- Add capability discovery, broker, protocol validators, security routing, and
  diagnostics behind the kill switch.
- Keep all existing polling authoritative.
- Verify REST and current SSE behavior with the event plane disabled.

### Phase 2: browser and Tauri shadow mode

- Add the demand-driven manager and pilot topic subscriptions.
- Receive and record invalidations while existing polls remain authoritative.
- Shadow mode performs no event-triggered REST read.
- Measure replay gaps, reconnects, and observed topic/version transitions.

### Phase 3: browser and Tauri primary mode

- Pause a topic's recurring poll only while that topic is subscribed and the
  socket is `ready`.
- Retain degraded fallback, dirty-topic foreground reconciliation, and manual
  refresh.
- Remove no fallback code in this phase.

### Phase 4: iOS shadow and primary modes

- Land the Swift actor, fixtures, store integrations, and scene lifecycle.
- Run shadow mode first.
- Enable event-primary behavior after reconnect and background/foreground
  evidence is clean.

### Phase 5: consolidation

- Remove only polling paths proven redundant by request-count and reliability
  evidence.
- Keep upstream provider polling and every documented fallback owner.
- Consider desktop leader election only if measured connection count or memory
  justifies its additional coordination machinery.

## Documentation

Implementation updates must document:

- the event capability and wire version;
- topic ownership and authoritative publishers;
- browser/Tauri and iOS lifecycle behavior;
- security differences between PTY and event sockets;
- kill-switch and rollout modes;
- fallback ownership; and
- diagnostic interpretation.

## Final acceptance

The design is complete when an implementation can be divided into ordered,
test-first tasks with exact file paths and no unresolved transport, security,
cross-platform, fallback, or rollout decision.
