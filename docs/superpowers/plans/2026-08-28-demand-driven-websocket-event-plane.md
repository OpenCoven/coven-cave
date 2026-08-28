# Demand-driven WebSocket Event Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax as working notes; checkbox state is not evidence of completion — code and merged PRs are authoritative.

**Goal:** Add a demand-driven, authenticated WebSocket invalidation/control plane that replaces recurring polling for sessions, board cards, run status, familiar roster state, and daemon connectivity when the socket is healthy.

**Architecture:** The existing Node HTTP server multiplexes `/api/events-ws` beside the PTY WebSocket and keeps a bounded, process-local replay broker in `server.ts`. Browser/Tauri and iOS clients open one socket only while subscribed, keep REST snapshots authoritative, coalesce invalidations into guarded refetches, and automatically restore the existing polling paths when the socket is unavailable.

**Tech Stack:** Node.js 24, TypeScript 6, Next.js 16 custom server, `ws`, React 19, Tauri 2 WebView, Swift concurrency, `URLSessionWebSocketTask`, Node test runner, XCTest, XcodeGen.

---

## Execution prerequisites

- Land the design and this plan through their docs PR before implementation.
- Execute implementation from fresh managed worktrees rooted at the merged
  `origin/main`, not from the docs worktree.
- Use `cave-qjvbb` as the parent tracker and create one child bead for each
  independently mergeable phase below.
- Do not add AI attribution to commits or PR descriptions.
- Keep existing chat, inbox, and research SSE paths unchanged.
- Do not remove fallback polling until the shadow-mode and request-count gates
  in this plan pass.

## File and responsibility map

### Shared protocol and fixtures

| File | Responsibility |
| --- | --- |
| `src/lib/cave-event-plane-protocol.ts` | TypeScript wire types, bounds, topic allowlist, capability shape, and strict parsers |
| `src/lib/cave-event-plane-protocol.test.ts` | TypeScript protocol fixtures, malformed input, and bounds |
| `apps/ios/CovenCave/CovenCaveTests/Fixtures/cave-event-plane-v1.json` | One checked-in golden contract consumed by TypeScript and Swift |
| `apps/ios/CovenCave/CovenCave/Models/CaveEventWire.swift` | Swift `Codable` mirror of protocol v1 |
| `apps/ios/CovenCave/CovenCaveTests/CaveEventWireTests.swift` | Swift decoding of the shared golden contract |

### Server transport and publication

| File | Responsibility |
| --- | --- |
| `server.ts` | Event broker, replay ring, WebSocket upgrade routing, heartbeat, backpressure, diagnostics bridge, and kill switch |
| `src/server-events-broker.test.ts` | Source-sliced broker unit tests for replay, filtering, bounds, and close codes |
| `scripts/event-plane-runtime-conformance.mjs` | Built-server handshake, auth, publisher, replay, and restart integration coverage |
| `src/server-pty-ws.test.ts` | Source contract proving PTY and event capabilities stay separately authorized |
| `src/lib/server/cave-event-plane-publisher.ts` | Typed `globalThis` publication facade for Next/server modules |
| `src/lib/server/cave-event-plane-publisher.test.ts` | Enabled, disabled, malformed, and unavailable bridge behavior |
| `src/app/api/events/capability/route.ts` | Daemon-independent event path, version, topics, kill switch, and per-platform rollout |
| `src/app/api/events/capability/route.test.ts` | Capability and malformed environment behavior |

### Browser and Tauri client

| File | Responsibility |
| --- | --- |
| `src/lib/cave-event-plane-client.ts` | Demand-driven socket manager, subscriptions, resume cursor, acknowledgements, coalescing, reconnect, and diagnostics |
| `src/lib/cave-event-plane-client.test.ts` | Fake-socket/fake-clock state-machine coverage |
| `src/lib/use-cave-event-plane.ts` | React subscription hook and topic-health selector |
| `src/lib/use-cave-event-plane.test.ts` | Hook lifecycle and reference-count behavior |
| `src/lib/use-pausable-poll.ts` | Separate recurring-poll and foreground-refresh gates |
| `src/lib/use-pausable-poll.test.ts` | Preserve manual/foreground behavior while covered intervals pause |
| `src/components/security/sidecar-auth-bridge.tsx` | Exact same-host token injection for `/api/events-ws` |
| `src/components/security/sidecar-auth-bridge.test.ts` | Event-socket token scope and constructor preservation |
| `src/lib/websocket-url.test.ts` | `ws:`/`wss:` derivation for the event path |
| `src/components/workspace.tsx` | Sessions, familiars, and daemon invalidation consumers and fallback gates |
| `src/components/board-view.tsx` | Board invalidation, interaction deferral, and fallback gate |
| `src/components/automations-view.tsx` | Run invalidation and unsettled-run fallback gate |

### Authoritative publisher domains

| File | Responsibility |
| --- | --- |
| `src/lib/cave-board.ts` | Publish `board` after successful atomic board mutations |
| `src/lib/cave-config.ts` | Publish `sessions` and `familiars` after successful config/session metadata writes |
| `src/lib/cave-conversations.ts` | Publish `sessions` after conversation save/delete |
| `src/lib/server/sessions-list-cache.ts` | Invalidate cached session snapshots before publishing |
| `src/lib/server/chat-stop-registry.ts` | Publish `sessions` when visible chat-run lifecycle changes |
| `src/lib/server/automation-runner.ts` | Publish `runs` after persisted automation run transitions |
| `src/lib/server/daemon-event-watcher.ts` | Poll the pull-only daemon source and publish classified transitions |
| `src/lib/server/daemon-event-watcher.test.ts` | Daemon transition, deduplication, and cleanup behavior |
| `src/lib/server/familiar-roster-watch.ts` | Observe multi-source familiar roster changes not owned by one route |
| `src/lib/server/familiar-roster-watch.test.ts` | Watch/coalesce/cleanup behavior |
| `src/instrumentation.ts` | Start and stop daemon/familiar watchers in the server runtime |

### Observability and packaged runtime

| File | Responsibility |
| --- | --- |
| `src/app/api/daemon/diagnostics/route.ts` | Include bounded event-plane diagnostics |
| `src/components/debug-pane.tsx` | Display browser/Tauri event health, fallback, coalescing, and avoided-poll counters |
| `src/components/debug-pane.test.ts` | Pin client diagnostics without exposing credentials or payloads |
| `scripts/sidecar-runtime-smoke.mjs` | Authenticated packaged event-socket round trip |
| `scripts/cave-performance-report.mjs` | Server event connection, publication, replay, and backpressure counters |
| `scripts/cave-performance-report.test.mjs` | Counter/report contract |
| `scripts/run-tests.mjs` | Wire all new TypeScript tests into the app suite |

### iOS client and integration

| File | Responsibility |
| --- | --- |
| `apps/ios/CovenCave/CovenCave/Networking/CaveEventSocketTransport.swift` | Injectable transport protocol and `URLSessionWebSocketTask` adapter |
| `apps/ios/CovenCave/CovenCave/Networking/CaveEventSocket.swift` | Actor-owned connection, subscriptions, resume, ack, backoff, and health |
| `apps/ios/CovenCave/CovenCave/Networking/CaveConnection.swift` | Secure HTTP/HTTPS to WS/WSS event URL derivation |
| `apps/ios/CovenCave/CovenCave/State/AppModel.swift` | Own the socket and route topic invalidations to existing single-flight loaders |
| `apps/ios/CovenCave/CovenCave/State/ConnectionBackgroundRefresh.swift` | Pause covered maintenance while event transport is healthy |
| `apps/ios/CovenCave/CovenCave/State/FamiliarDashboardSnapshot.swift` | Include event health in the dashboard poll policy |
| `apps/ios/CovenCave/CovenCave/State/FamiliarDashboardStore.swift` | Generation-guard familiar refreshes |
| `apps/ios/CovenCave/CovenCave/CovenCaveApp.swift` | Scene-active/background socket lifecycle |
| `apps/ios/CovenCave/CovenCaveTests/CaveEventSocketTests.swift` | Actor/transport lifecycle and fallback coverage |
| `apps/ios/CovenCave/CovenCaveTests/CaveConnectionTests.swift` | Secure event URL and origin tests |
| `apps/ios/CovenCave/CovenCaveTests/FamiliarDashboardStoreTests.swift` | Event-primary/fallback policy tests |
| `apps/ios/CovenCave/CovenCaveTests/AppModelProjectContextTests.swift` | Session/task/run invalidation single-flight integration |

## Phase boundaries

1. Tasks 1-4 establish a disabled-by-default server protocol and secure
   upgrade path.
2. Tasks 5-6 add the demand-driven browser/Tauri client primitives.
3. Tasks 7-8 add authoritative publishers without changing polling behavior.
4. Tasks 9-11 ship browser/Tauri shadow mode, then primary mode and packaged
   verification.
5. Tasks 12-14 add the iOS contract, actor, shadow mode, and primary mode.
6. Task 15 runs cross-platform regression gates and documents operational
   ownership.

### Task 1: Define protocol v1 and the shared golden fixture

**Files:**
- Create: `src/lib/cave-event-plane-protocol.ts`
- Create: `src/lib/cave-event-plane-protocol.test.ts`
- Create: `apps/ios/CovenCave/CovenCaveTests/Fixtures/cave-event-plane-v1.json`
- Modify: `scripts/run-tests.mjs:1738-1743`

- [ ] **Step 1: Write the failing TypeScript protocol tests and fixture**

Create the fixture with one example of every valid server/client message and
malformed examples:

```json
{
  "capability": {
    "enabled": true,
    "protocolVersion": 1,
    "path": "/api/events-ws",
    "topics": ["sessions", "board", "runs", "familiars", "daemon"],
    "rolloutMode": { "web": "shadow", "ios": "off" }
  },
  "closeCodes": {
    "protocol": 4400,
    "invalidFrame": 4402,
    "slowConsumer": 4408
  },
  "hello": {
    "type": "hello",
    "protocol": 1,
    "clientId": "browser-main",
    "topics": ["sessions", "board"],
    "resume": { "epoch": "boot-a", "seq": 41 }
  },
  "subscribe": {
    "type": "subscribe",
    "protocol": 1,
    "topics": ["runs"]
  },
  "ack": {
    "type": "ack",
    "protocol": 1,
    "epoch": "boot-a",
    "seq": 42
  },
  "ready": {
    "type": "ready",
    "protocol": 1,
    "epoch": "boot-a",
    "seq": 42,
    "topics": ["sessions", "board"],
    "versions": { "sessions": 3, "board": 8 }
  },
  "invalidate": {
    "type": "invalidate",
    "protocol": 1,
    "epoch": "boot-a",
    "seq": 43,
    "topic": "board",
    "version": 9,
    "entityIds": ["card-1"]
  },
  "resyncRequired": {
    "type": "resync-required",
    "protocol": 1,
    "epoch": "boot-b",
    "seq": 0,
    "topics": ["sessions", "board"],
    "reason": "server-restarted"
  },
  "malformed": {
    "unknownTopic": {
      "type": "invalidate",
      "protocol": 1,
      "epoch": "boot-a",
      "seq": 44,
      "topic": "secrets",
      "version": 1
    },
    "unsupportedProtocol": {
      "type": "hello",
      "protocol": 2,
      "clientId": "future",
      "topics": ["sessions"]
    }
  }
}
```

Write tests that call strict parsers and assert the bounds:

```ts
test("protocol v1 decodes the shared golden messages", () => {
  assert.equal(parseEventClientMessage(JSON.stringify(fixture.hello)).type, "hello");
  assert.equal(parseEventServerMessage(JSON.stringify(fixture.ready)).type, "ready");
  assert.equal(parseEventServerMessage(JSON.stringify(fixture.invalidate)).type, "invalidate");
});

test("unknown topics and protocols fail closed", () => {
  assert.throws(
    () => parseEventServerMessage(JSON.stringify(fixture.malformed.unknownTopic)),
    /unknown event topic/,
  );
  assert.throws(
    () => parseEventClientMessage(JSON.stringify(fixture.malformed.unsupportedProtocol)),
    /unsupported event protocol/,
  );
});

test("protocol bounds reject oversized input", () => {
  assert.throws(() => parseEventClientMessage("x".repeat(MAX_EVENT_MESSAGE_BYTES + 1)), /16 KiB/);
  assert.throws(
    () => normalizeEntityIds(Array.from({ length: MAX_EVENT_ENTITY_IDS + 1 }, (_, i) => `id-${i}`)),
    /at most 32 entity ids/,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types --test src/lib/cave-event-plane-protocol.test.ts
```

Expected: FAIL because `cave-event-plane-protocol.ts` does not exist.

- [ ] **Step 3: Implement the strict protocol module**

Define the exact public contract:

```ts
export const CAVE_EVENT_PROTOCOL = 1 as const;
export const CAVE_EVENT_PATH = "/api/events-ws" as const;
export const MAX_EVENT_MESSAGE_BYTES = 16 * 1024;
export const MAX_EVENT_ENTITY_IDS = 32;
export const MAX_EVENT_ENTITY_ID_BYTES = 256;
export const CAVE_EVENT_CLOSE = {
  protocol: 4_400,
  invalidFrame: 4_402,
  slowConsumer: 4_408,
} as const;

export const CAVE_EVENT_TOPICS = [
  "sessions",
  "board",
  "runs",
  "familiars",
  "daemon",
] as const;

export type CaveEventTopic = (typeof CAVE_EVENT_TOPICS)[number];
export type CaveEventRolloutMode = "off" | "shadow" | "primary";

export type CaveEventPlaneCapability = {
  enabled: boolean;
  protocolVersion: typeof CAVE_EVENT_PROTOCOL;
  path: typeof CAVE_EVENT_PATH;
  topics: CaveEventTopic[];
  rolloutMode: {
    web: CaveEventRolloutMode;
    ios: CaveEventRolloutMode;
  };
};
```

Implement `parseEventClientMessage`, `parseEventServerMessage`,
`normalizeTopics`, and `normalizeEntityIds` with:

- `TextEncoder().encode(raw).byteLength` before `JSON.parse`;
- plain-record checks;
- exact `protocol === 1`;
- finite non-negative safe integers for sequence/version fields;
- duplicate-free allowlisted topics;
- the entity count/byte bounds above; and
- rejection of an unknown `type`.

Document and test that `ready` is repeatable: the server sends it after
`hello` and after every complete-set `subscribe`, and clients replace topic
health only from the latest `ready`.

Add the test file to the app test list next to `src/lib/websocket-url.test.ts`.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --experimental-strip-types --test src/lib/cave-event-plane-protocol.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cave-event-plane-protocol.ts \
  src/lib/cave-event-plane-protocol.test.ts \
  apps/ios/CovenCave/CovenCaveTests/Fixtures/cave-event-plane-v1.json \
  scripts/run-tests.mjs
git commit -m "feat(events): define websocket event protocol"
```

### Task 2: Add the typed publication facade

**Files:**
- Create: `src/lib/server/cave-event-plane-publisher.ts`
- Create: `src/lib/server/cave-event-plane-publisher.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing facade tests**

Cover enabled, disabled, unavailable, malformed, and bounded entity IDs:

```ts
test("publishes through the installed bridge", () => {
  const seen: unknown[] = [];
  globalThis.__covenCaveEventPlanePublisher = {
    enabled: true,
    markResourceChanged: (topic, entityIds) => seen.push({ topic, entityIds }),
  };
  assert.equal(markResourceChanged("board", ["card-1"]), true);
  assert.deepEqual(seen, [{ topic: "board", entityIds: ["card-1"] }]);
});

test("explicitly disabled publication is a quiet no-op", () => {
  globalThis.__covenCaveEventPlanePublisher = {
    enabled: false,
    markResourceChanged: () => assert.fail("disabled bridge must not publish"),
  };
  assert.equal(markResourceChanged("sessions"), false);
});

test("missing bridge reports a diagnostic failure without failing the write", () => {
  delete globalThis.__covenCaveEventPlanePublisher;
  const errors: unknown[][] = [];
  assert.equal(markResourceChanged("daemon", undefined, (...args) => errors.push(args)), false);
  assert.match(String(errors[0]?.[0]), /event-plane publisher unavailable/);
});

test("entity overflow degrades to a full invalidation without throwing", () => {
  const seen: unknown[] = [];
  globalThis.__covenCaveEventPlanePublisher = {
    enabled: true,
    markResourceChanged: (topic, entityIds) => seen.push({ topic, entityIds }),
  };
  assert.equal(
    markResourceChanged(
      "board",
      Array.from({ length: 40 }, (_, index) => `card-${index}`),
    ),
    true,
  );
  assert.deepEqual(seen, [{ topic: "board", entityIds: undefined }]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types --test src/lib/server/cave-event-plane-publisher.test.ts
```

Expected: FAIL because the facade does not exist.

- [ ] **Step 3: Implement the facade**

Use one declared bridge and return whether a publish was accepted:

```ts
import {
  normalizeEntityIds,
  type CaveEventTopic,
} from "@/lib/cave-event-plane-protocol";

export type CaveEventPlanePublisher = {
  enabled: boolean;
  markResourceChanged(topic: CaveEventTopic, entityIds?: readonly string[]): void;
};

declare global {
  var __covenCaveEventPlanePublisher: CaveEventPlanePublisher | undefined;
}

export function markResourceChanged(
  topic: CaveEventTopic,
  entityIds?: readonly string[],
  report: (...args: unknown[]) => void = console.error,
): boolean {
  const publisher = globalThis.__covenCaveEventPlanePublisher;
  if (!publisher) {
    reportEventPublisherFailureOnce(report, "unavailable", topic);
    return false;
  }
  if (!publisher.enabled) return false;
  if (typeof publisher.markResourceChanged !== "function") {
    reportEventPublisherFailureOnce(report, "malformed", topic);
    return false;
  }
  try {
    const normalizedIds =
      entityIds && entityIds.length > MAX_EVENT_ENTITY_IDS
        ? undefined
        : normalizeEntityIds(entityIds);
    publisher.markResourceChanged(topic, normalizedIds);
    return true;
  } catch (error) {
    reportEventPublisherFailureOnce(report, "publish-failed", topic, error);
    return false;
  }
}
```

Use the same report-once helper for an unavailable bridge. Publication is
best-effort after a durable write: it must never turn a committed mutation into
an HTTP failure, and overflow must become a topic-wide invalidation rather than
an exception.

Wire the new test into `scripts/run-tests.mjs`.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --experimental-strip-types --test src/lib/server/cave-event-plane-publisher.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/cave-event-plane-publisher.ts \
  src/lib/server/cave-event-plane-publisher.test.ts \
  scripts/run-tests.mjs
git commit -m "feat(events): add server publication facade"
```

### Task 3: Implement the bounded server broker

**Files:**
- Modify: `server.ts`
- Create: `src/server-events-broker.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing isolated broker tests**

Follow `src/server-pty-ws.test.ts`'s established source-slice pattern: extract
the broker block from `server.ts`, compile it with `esbuild.transformSync`,
import it through a data URL, and drive it with fake sockets and an injected
clock.

Required cases:

```ts
test("hello installs topics and returns ready", async () => {
  const { broker, socket } = makeBrokerFixture();
  socket.receive(JSON.stringify({
    type: "hello",
    protocol: 1,
    clientId: "test-client",
    topics: ["board"],
  }));
  const ready = socket.lastJson();
  assert.deepEqual(ready.topics, ["board"]);
  assert.equal(ready.type, "ready");
  assert.equal(typeof ready.epoch, "string");
  assert.equal(ready.seq, 0);
});

test("replacement subscribe returns a new ready barrier", () => {
  const { broker, socket } = readyBroker(["sessions"]);
  socket.receive(JSON.stringify({
    type: "subscribe",
    protocol: 1,
    topics: ["board"],
  }));
  assert.deepEqual(socket.lastJson(), {
    type: "ready",
    protocol: 1,
    epoch: broker.epoch(),
    seq: 0,
    topics: ["board"],
    versions: { board: 0 },
  });
});

test("unsupported protocols close before broker details are disclosed", () => {
  const { socket } = makeBrokerFixture();
  socket.receive(JSON.stringify({
    type: "hello",
    protocol: 2,
    clientId: "future-client",
    topics: ["board"],
  }));
  const close = socket.lastClose();
  assert.equal(close.code, CAVE_EVENT_CLOSE.protocol);
  assert.doesNotMatch(close.reason, /epoch|sequence|topic version/i);
});
```

Also add tests for:

- monotonic global sequence and per-topic versions;
- topic filtering and retained replay;
- restart epoch and ring-gap resync;
- cumulative `ack`;
- binary/oversized/malformed frame rejection;
- heartbeat cleanup; and
- slow-consumer closure.

- [ ] **Step 2: Run the broker test to verify it fails**

Run:

```bash
node --experimental-strip-types --test src/server-events-broker.test.ts
```

Expected: FAIL because the broker block does not exist.

- [ ] **Step 3: Implement the inline broker in `server.ts`**

Add explicit constants and a factory before `app.prepare()`:

```ts
const EVENT_PLANE_PATH = "/api/events-ws";
const EVENT_PROTOCOL = 1;
const EVENT_RING_COUNT_LIMIT = boundedPositiveInt(
  process.env.COVEN_CAVE_EVENT_RING_COUNT,
  2_048,
  16_384,
);
const EVENT_RING_BYTE_LIMIT = 1024 * 1024;
const EVENT_INBOUND_LIMIT = 16 * 1024;
const EVENT_HEARTBEAT_MS = 25_000;
const EVENT_BUFFERED_AMOUNT_LIMIT = 256 * 1024;

type EventTopic = "sessions" | "board" | "runs" | "familiars" | "daemon";
type EventRecord = {
  type: "invalidate";
  protocol: 1;
  epoch: string;
  seq: number;
  topic: EventTopic;
  version: number;
  entityIds?: string[];
};
```

Define `boundedPositiveInt(raw, fallback, maximum)` beside these constants. It
must accept only finite positive safe integers, clamp valid values to the
explicit maximum, and return the fallback for missing or malformed input.

The broker factory must expose:

```ts
type EventBroker = {
  attach(ws: WebSocket): void;
  publish(topic: EventTopic, entityIds?: readonly string[]): void;
  diagnostics(): EventPlaneDiagnostics;
  epoch(): string;
  shutdown(): void;
};
```

Implementation rules:

- create one `randomUUID()` epoch per process;
- increment global `seq` and per-topic versions on publish;
- encode once, record byte length, append to the ring, and evict oldest until
  both bounds pass;
- keep `Map<WebSocket, ClientState>`;
- require `hello` before any other client message;
- replay only records matching the installed subscription set;
- send `resync-required` for epoch mismatch or a cursor older than the ring;
- treat `subscribe.topics` as complete replacement and answer with a new
  `ready` barrier containing the installed topics and current versions;
- store only the highest valid cumulative acknowledgement;
- call `ws.ping()` every 25 seconds and terminate clients that missed the prior
  pong;
- close slow consumers before `send`;
- remove all client state on close/error; and
- install:

```ts
globalThis.__covenCaveEventPlanePublisher = {
  enabled: eventPlaneEnabled,
  markResourceChanged: (topic, entityIds) => eventBroker.publish(topic, entityIds),
};
```

Do not import a new local server module: `build:server` remains unbundled.
The broker test must also pin the inline path, protocol number, topics, bounds,
and close codes against exports from `cave-event-plane-protocol.ts` so the
unbundled server copy cannot drift.

- [ ] **Step 4: Run the broker test and server build**

Run:

```bash
node --experimental-strip-types --test src/server-events-broker.test.ts
pnpm build:server
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add server.ts src/server-events-broker.test.ts scripts/run-tests.mjs
git commit -m "feat(events): add bounded websocket broker"
```

### Task 4: Route and authorize `/api/events-ws`

**Files:**
- Modify: `server.ts`
- Modify: `src/server-pty-ws.test.ts`
- Create: `scripts/event-plane-runtime-conformance.mjs`
- Create: `src/app/api/events/capability/route.ts`
- Create: `src/app/api/events/capability/route.test.ts`
- Modify: `src/components/security/sidecar-auth-bridge.tsx:34-53`
- Modify: `src/components/security/sidecar-auth-bridge.test.ts:91-129`
- Modify: `src/lib/websocket-url.test.ts:33-80`

- [ ] **Step 1: Write failing security, capability, and URL tests**

Add source/integration assertions that:

```ts
assert.match(serverSource, /pathname === "\/api\/events-ws"/);
assert.match(serverSource, /authorizeEventUpgrade/);
assert.match(serverSource, /authorizePtyUpgrade/);
assert.doesNotMatch(
  eventAuthorizationSlice,
  /COVEN_CAVE_PASSKEY_REQUIRED/,
  "read-only invalidation sockets must not inherit the PTY shell-presence gate",
);
assert.match(
  ptyAuthorizationSlice,
  /COVEN_CAVE_PASSKEY_REQUIRED/,
  "PTY remote access keeps passkey presence",
);
```

Add capability assertions:

```ts
assert.deepEqual(payload.eventPlane, {
  enabled: true,
  protocolVersion: 1,
  path: "/api/events-ws",
  topics: ["sessions", "board", "runs", "familiars", "daemon"],
  rolloutMode: { web: "shadow", ios: "off" },
});
```

The capability test calls the new route directly and proves it returns the same
payload while the daemon is unavailable. Add built-server conformance cases
for event handshake, disabled-upgrade refusal, remote paired credential
acceptance, unauthenticated remote refusal, and unchanged PTY passkey behavior.

Add sidecar coverage:

```ts
const ws = new win.WebSocket("ws://localhost:3210/api/events-ws");
assert.equal(
  ws.url,
  "ws://localhost:3210/api/events-ws?covenCaveToken=tok_ws",
);
```

Add `websocketUrl("/api/events-ws", ...)` cases for HTTP loopback and HTTPS
MagicDNS.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --experimental-strip-types src/server-pty-ws.test.ts
node --experimental-strip-types --test src/app/api/events/capability/route.test.ts
node --experimental-strip-types --test src/components/security/sidecar-auth-bridge.test.ts
node --experimental-strip-types src/lib/websocket-url.test.ts
pnpm build && node scripts/event-plane-runtime-conformance.mjs
```

Expected: FAIL on missing event route/capability/token scope.

- [ ] **Step 3: Implement capability-aware authorization**

Keep the existing PTY helper names and source-slice boundaries stable. Extract
only common source/origin/credential checks, then add two thin named wrappers:

```ts
function authorizeEventUpgrade(
  req: IncomingMessage,
  query: UpgradeQuery,
): { ok: true } | { ok: false; status: 400 | 401 | 403 } {
  const tokenAuthenticated = isPtyAuthRequired()
    ? isAuthorized(req, query)
    : false;
  if (!isAllowedUpgradeSource(req, tokenAuthenticated)) {
    return { ok: false, status: 403 };
  }
  if (shouldRejectUnauthenticatedPtyUpgrade({
    sidecarTokenConfigured: Boolean(SIDECAR_TOKEN),
    accessTokenConfigured: Boolean(accessToken()),
    tokenAuthenticated,
    directLoopback: isDirectLoopbackRequest(req),
  })) {
    return { ok: false, status: 401 };
  }
  return { ok: true };
}

function authorizePtyUpgrade(
  req: IncomingMessage,
  query: UpgradeQuery,
): { ok: true } | { ok: false; status: 400 | 401 | 403 } {
  const shared = authorizeEventUpgrade(req, query);
  if (!shared.ok) return shared;
  if (
    process.env.COVEN_CAVE_PASSKEY_REQUIRED === "1"
    && !isDirectLoopbackRequest(req)
    && !hasValidPasskeyPresence(req, resolveTailnetPeer(req))
  ) {
    return { ok: false, status: 401 };
  }
  return { ok: true };
}
```

Route `/api/events-ws` to `eventBroker.attach(ws)` and keep every other upgrade
forwarded to Next.

Implement the daemon-independent capability route. Normalize:

- `COVEN_CAVE_EVENT_PLANE_ENABLED` to the master boolean kill switch;
- `COVEN_CAVE_EVENT_WEB_MODE` to `off | shadow | primary`; and
- `COVEN_CAVE_EVENT_IOS_MODE` to `off | shadow | primary`.

Both platform modes default to `off`. An invalid value fails closed to `off`
and is covered by the route test.

Change the sidecar bridge path check to:

```js
const websocketPaths = new Set(["/api/pty-ws", "/api/events-ws"]);
const websocketProtocol = nextUrl.protocol === "ws:" || nextUrl.protocol === "wss:";
if (sameHost && websocketProtocol && websocketPaths.has(nextUrl.pathname)) {
  nextUrl.searchParams.set(tokenParam, token);
  return new NativeWebSocket(nextUrl, protocols);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run the Step 2 commands again, then:

```bash
pnpm build
node scripts/event-plane-runtime-conformance.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server.ts \
  src/server-pty-ws.test.ts \
  scripts/event-plane-runtime-conformance.mjs \
  src/app/api/events/capability/route.ts \
  src/app/api/events/capability/route.test.ts \
  src/components/security/sidecar-auth-bridge.tsx \
  src/components/security/sidecar-auth-bridge.test.ts \
  src/lib/websocket-url.test.ts
git commit -m "feat(events): secure and advertise event websocket"
```

### Task 5: Build the demand-driven browser/Tauri client manager

**Files:**
- Create: `src/lib/cave-event-plane-client.ts`
- Create: `src/lib/cave-event-plane-client.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing fake-socket and fake-clock tests**

Define injected dependencies and verify:

```ts
test("zero subscribers create zero sockets", () => {
  const fx = createFixture();
  fx.clock.advance(60_000);
  assert.equal(fx.sockets.length, 0);
});

test("first subscriber opens once and final unsubscribe closes after grace", async () => {
  const fx = createFixture();
  const unsubscribe = fx.client.subscribe("sessions", fx.listener);
  assert.equal(fx.sockets.length, 1);
  fx.sockets[0]!.open();
  fx.sockets[0]!.message(fixture.ready);
  unsubscribe();
  fx.clock.advance(14_999);
  assert.equal(fx.sockets[0]!.readyState, OPEN);
  fx.clock.advance(1);
  assert.equal(fx.sockets[0]!.closeReason, "idle");
});

test("topic changes send the complete subscription set", () => {
  const fx = readyFixture(["sessions"]);
  const offBoard = fx.client.subscribe("board", fx.listener);
  assert.deepEqual(fx.sockets[0]!.lastJson(), {
    type: "subscribe",
    protocol: 1,
    topics: ["sessions", "board"],
  });
  offBoard();
  assert.deepEqual(fx.sockets[0]!.lastJson().topics, ["sessions"]);
});

test("a late topic is unhealthy until the replacement ready arrives", () => {
  const fx = readyFixture(["sessions"]);
  fx.client.subscribe("board", fx.listener);
  assert.equal(fx.client.topicReady("board"), false);
  fx.sockets[0]!.message({
    ...fixture.ready,
    topics: ["sessions", "board"],
    versions: { sessions: 3, board: 8 },
  });
  assert.equal(fx.client.topicReady("board"), true);
});

test("shadow mode records invalidations without notifying refresh owners", () => {
  const fx = readyFixture(["board"], { webMode: "shadow" });
  fx.sockets[0]!.message(fixture.invalidate);
  fx.clock.advance(100);
  assert.equal(fx.listener.calls.length, 0);
  assert.equal(fx.client.diagnostics().invalidationsObserved.board, 1);
});

test("hidden clients coalesce dirty topics without fetching", () => {
  const fx = readyFixture(["board"]);
  fx.visibility.hide();
  fx.sockets[0]!.message(fixture.invalidate);
  assert.equal(fx.listener.calls.length, 0);
  fx.visibility.show();
  assert.deepEqual(fx.listener.calls, [{ topic: "board", entityIds: ["card-1"] }]);
});
```

Also cover connect timeout, one active connection, replay cursor, ack throttling,
100 ms coalescing, entity-ID overflow, foreground immediate reconnect,
0.8-1.2 jitter, 30-second cap, slow/invalid server messages, and state changes.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types --test src/lib/cave-event-plane-client.test.ts
```

Expected: FAIL because the manager does not exist.

- [ ] **Step 3: Implement the client factory and singleton**

Expose:

```ts
export type CaveEventInvalidation = {
  topic: CaveEventTopic;
  version: number;
  entityIds?: readonly string[];
};

export type CaveEventPlaneClient = {
  subscribe(
    topic: CaveEventTopic,
    listener: (event: CaveEventInvalidation) => void,
  ): () => void;
  topicReady(topic: CaveEventTopic): boolean;
  state(): CaveEventPlaneState;
  diagnostics(): CaveEventPlaneClientDiagnostics;
  refreshCapabilities(): Promise<void>;
  dispose(): void;
};

export function createCaveEventPlaneClient(
  dependencies: CaveEventPlaneDependencies,
): CaveEventPlaneClient;

export const caveEventPlaneClient = createCaveEventPlaneClient(browserDependencies);
```

Implementation rules:

- load `/api/events/capability` once and on a rejected/unsupported connection;
- open through `websocketUrl(capability.path)`;
- use `capability.rolloutMode.web` and stay disconnected when it is `off`;
- one socket per manager;
- reference-count listeners per topic;
- send `hello` on open and replacement `subscribe` messages afterward;
- clear readiness for a changed topic set until the server's replacement
  `ready` confirms the installed complete set;
- store epoch/sequence only in memory;
- mark replay/resync topics dirty but notify subscribers only after `ready`;
- coalesce topic invalidations for 100 ms;
- hold dirty topics while hidden and flush once on visible/focus;
- acknowledge the highest processed sequence at most once per second;
- use an 8-second connect timeout;
- back off 500 ms to 30 seconds with injected jitter;
- cancel backoff on final unsubscribe; and
- expose `topicReady` only after `ready` includes the topic.

In `shadow`, parse, validate, sequence, acknowledge, and count invalidations but
do not notify refresh listeners. In `primary`, deliver through the coalescing
and visibility rules above.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --experimental-strip-types --test src/lib/cave-event-plane-client.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cave-event-plane-client.ts \
  src/lib/cave-event-plane-client.test.ts \
  scripts/run-tests.mjs
git commit -m "feat(events): add demand-driven web client"
```

### Task 6: Add the React subscription hook

**Files:**
- Create: `src/lib/use-cave-event-plane.ts`
- Create: `src/lib/use-cave-event-plane.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing hook lifecycle tests**

Use a fake client:

```ts
test("subscribes on mount and releases on unmount", () => {
  const client = createFakeClient();
  const root = create(<Harness client={client} topic="board" />);
  assert.deepEqual(client.subscriptions(), ["board"]);
  root.unmount();
  assert.deepEqual(client.subscriptions(), []);
});

test("returns topic health for polling gates", () => {
  const client = createFakeClient({ ready: ["sessions"] });
  const result = renderHook(() =>
    useCaveEventPlane("sessions", () => {}, { client }),
  );
  assert.equal(result.current.ready, true);
  assert.equal(result.current.rolloutMode, "primary");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types --test src/lib/use-cave-event-plane.test.ts
```

Expected: FAIL because the hook does not exist.

- [ ] **Step 3: Implement the hook without owning fetches**

Expose:

```ts
export function useCaveEventPlane(
  topic: CaveEventTopic,
  onInvalidate: (event: CaveEventInvalidation) => void,
  options: { enabled?: boolean; client?: CaveEventPlaneClient } = {},
): {
  ready: boolean;
  rolloutMode: CaveEventRolloutMode;
  state: CaveEventPlaneState;
};
```

Use a callback ref so changing render identities do not resubscribe. Subscribe
only when `enabled !== false`. Use `useSyncExternalStore` for manager state so
polling gates update when the connection changes.

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
node --experimental-strip-types --test src/lib/use-cave-event-plane.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/use-cave-event-plane.ts \
  src/lib/use-cave-event-plane.test.ts \
  scripts/run-tests.mjs
git commit -m "feat(events): add react event subscription hook"
```

### Task 7: Publish board and session invalidations after durable commits

**Files:**
- Modify: `src/lib/cave-board.ts:505-551,625-691,720-1096,1138-1902`
- Modify: `src/lib/cave-config.ts:944-1406`
- Modify: `src/lib/cave-conversations.ts:618-860`
- Modify: `src/lib/server/sessions-list-cache.ts`
- Create: `src/lib/cave-board-publisher.test.ts`
- Create: `src/lib/server/sessions-publisher.test.ts`
- Modify: `scripts/event-plane-runtime-conformance.mjs`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing publish-after-commit tests**

Install a recording publisher and prove success/no-op/failure ordering:

```ts
test("createCard publishes only after the atomic write resolves", async () => {
  const order: string[] = [];
  installPublisher((topic, ids) => order.push(`publish:${topic}:${ids?.[0]}`));
  await withAtomicWriteSpy(async () => {
    order.push("write:start");
    const card = await createCard(validCardInput());
    order.push(`returned:${card.id}`);
  }, () => order.push("write:done"));
  assert.deepEqual(order.slice(0, 3), [
    "write:start",
    "write:done",
    `publish:board:${createdCardId}`,
  ]);
});

test("failed and no-op board mutations publish nothing", async () => {
  const seen = installRecordingPublisher();
  await assert.rejects(() => updateCard("missing", {}), /not found/);
  await restoreCards([]);
  assert.deepEqual(seen, []);
});

test("conversation save invalidates the read cache before publication", async () => {
  const order: string[] = [];
  installSessionsCacheInvalidationSpy(() => order.push("cache:invalidate"));
  installPublisher((topic) => order.push(`publish:${topic}`));
  await saveConversation(conversationFixture("session-1"));
  assert.deepEqual(order, ["cache:invalidate", "publish:sessions"]);
});

test("conversation save and delete publish sessions after persistence", async () => {
  const seen = installRecordingPublisher();
  await saveConversation(conversationFixture("session-1"));
  await deleteConversation("session-1");
  assert.deepEqual(seen, [
    { topic: "sessions", entityIds: ["session-1"] },
    { topic: "sessions", entityIds: ["session-1"] },
  ]);
});
```

Cover board create/update/lifecycle/delete/restore/clear/unlink and session
create/title/archive/summon/pin/keep/sacrifice/conversation settlement/delete.
Extend `scripts/event-plane-runtime-conformance.mjs` with real
publisher-backed transport coverage:

```ts
test("resume replays the retained board suffix", async () => {
  const first = await subscribe(server.url, ["board"]);
  const ready = await nextJson(first);
  await mutateBoard(server.url, { title: "one" });
  const event = await nextJson(first);
  first.close();

  const resumed = await connectEventSocket(server.url);
  resumed.send(JSON.stringify({
    type: "hello",
    protocol: 1,
    clientId: "test-client",
    topics: ["board"],
    resume: { epoch: ready.epoch, seq: event.seq - 1 },
  }));
  assert.equal((await nextJson(resumed)).seq, event.seq);
});
```

Add topic-filtering, server-restart, and small-ring replay-gap cases here.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test --test-concurrency=1 \
  src/lib/cave-board-publisher.test.ts \
  src/lib/server/sessions-publisher.test.ts
```

Expected: FAIL because the mutators do not publish.

- [ ] **Step 3: Add publication at the mutation chokepoints**

Import the facade into the authoritative modules and publish after successful
write completion:

```ts
await writeBoard(next);
markResourceChanged("board", [card.id]);
return card;
```

For multi-card operations:

```ts
if (changedIds.length > 0) {
  markResourceChanged("board", changedIds);
}
```

For session metadata and conversation persistence:

```ts
await writeJsonAtomic(path, next);
invalidateSessionsListCache();
markResourceChanged("sessions", [sessionId]);
```

Do not publish from route handlers that call these functions. Return early
before publication when the normalized state is unchanged.

Every event-triggered REST snapshot must bypass stale process-local cache.
Invalidate `sessions-list-cache` before publishing `sessions`; where another
publisher has a cached read model, add the same `invalidate cache -> publish`
ordering and pin it in the publisher test.

- [ ] **Step 4: Run focused and existing regression tests**

Run:

```bash
node --experimental-strip-types --test --test-concurrency=1 \
  src/lib/cave-board-publisher.test.ts \
  src/lib/server/sessions-publisher.test.ts \
  src/lib/cave-board-atomic.test.ts \
  src/lib/cave-board-orchestration.test.ts \
  src/lib/cave-board-retention.test.ts \
  src/lib/cave-config.test.ts \
  src/lib/cave-conversations.test.ts \
  src/lib/server/sessions-list-cache.test.ts
pnpm build
node scripts/event-plane-runtime-conformance.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cave-board.ts \
  src/lib/cave-config.ts \
  src/lib/cave-conversations.ts \
  src/lib/server/sessions-list-cache.ts \
  src/lib/cave-board-publisher.test.ts \
  src/lib/server/sessions-publisher.test.ts \
  scripts/event-plane-runtime-conformance.mjs \
  scripts/run-tests.mjs
git commit -m "feat(events): publish board and session changes"
```

### Task 8: Publish run, daemon, and familiar invalidations

**Files:**
- Modify: `src/lib/server/chat-stop-registry.ts`
- Modify: `src/lib/server/chat-stop-registry.test.ts`
- Modify: `src/lib/server/automation-runner.ts`
- Modify: `src/lib/server/automation-runner.test.ts`
- Create: `src/lib/server/daemon-event-watcher.ts`
- Create: `src/lib/server/daemon-event-watcher.test.ts`
- Modify: `src/lib/cave-config.ts`
- Modify: `src/app/api/familiars/route.ts:185-302`
- Modify: `src/app/api/familiars/[id]/route.ts:31-69`
- Modify: `src/app/api/familiars/removed/route.ts:1-91`
- Create: `src/lib/server/familiar-roster-watch.ts`
- Create: `src/lib/server/familiar-roster-watch.test.ts`
- Modify: `src/instrumentation.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing transition and watcher tests**

Chat runs:

```ts
test("visible chat-run transitions publish sessions", () => {
  const seen = installRecordingPublisher();
  const handle = registerChatRun(["session:run-1"], () => undefined);
  markChatRunTransportSettled(handle);
  markChatRunProjectionSettled(handle);
  unregisterChatRun(handle);
  assert.ok(seen.every((event) => event.topic === "sessions"));
});
```

Automation runs:

```ts
test("persisted automation run transitions publish runs", async () => {
  const seen = installRecordingPublisher();
  const run = await startAutomationRun(automationFixture());
  await settleAutomationRun(run.id, { status: "completed" });
  assert.deepEqual(seen, [
    { topic: "runs", entityIds: [run.id] },
    { topic: "runs", entityIds: [run.id] },
  ]);
});
```

Daemon watcher:

```ts
test("publishes only when the server-observed classification changes", async () => {
  const seen = installRecordingPublisher();
  const watcher = createDaemonEventWatcher({
    loadSnapshot: sequence(healthyResponse(), healthyResponse(), offlineResponse()),
    publish: () => seen.push({ topic: "daemon" }),
    clock,
  });
  await watcher.tick();
  await watcher.tick();
  await watcher.tick();
  assert.deepEqual(seen.map((event) => event.topic), ["daemon", "daemon"]);
});
```

Familiar watcher:

```ts
test("coalesces config, roster, and tombstone changes into one invalidation", async () => {
  const fx = createWatchFixture();
  fx.emit("cave-config.json");
  fx.emit("familiars.toml");
  fx.emit("familiar-tombstones.json");
  fx.clock.advance(100);
  assert.deepEqual(fx.published, [{ topic: "familiars" }]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test --test-concurrency=1 \
  src/lib/server/chat-stop-registry.test.ts \
  src/lib/server/automation-runner.test.ts \
  src/lib/server/daemon-event-watcher.test.ts \
  src/lib/server/familiar-roster-watch.test.ts
```

Expected: FAIL on missing publications/watcher.

- [ ] **Step 3: Implement transition-aware publishers**

Chat-run rules:

- publish from `registerChatRun`, `addChatRunKeys`,
  `markChatRunProjectionSettled`, and `unregisterChatRun`;
- do not publish from stop intent alone;
- do not publish from transport settlement until visible projected state
  changes; and
- publish `sessions`, because chat-run liveness is consumed through the session
  surfaces rather than the automation-run history endpoint.

Automation-run rules:

- publish `runs` after queued, running, terminal, and cancelled state is
  persisted;
- publish no event for a failed or unchanged persistence attempt; and
- include the automation run ID when it is within protocol bounds.

Daemon watcher rules:

```ts
if (!sameDaemonClassification(previous, next)) {
  markResourceChanged("daemon");
}
```

Use the existing server daemon snapshot loader through an injected dependency.
The watcher retains the pull needed to observe a pull-only daemon, but publishes
only offline/connecting/healthy/degraded/restarted transitions.

Familiar rules:

- publish after successful config/role/tombstone writes;
- start one watcher alongside server startup;
- watch the config, roster, and tombstone parent directories;
- filter events to the three source files;
- coalesce for 100 ms;
- publish a full `familiars` invalidation without entity IDs when the changed
  familiar cannot be proved; and
- close all watchers during packaged server shutdown.

Start both watchers from `src/instrumentation.ts` using the existing
server-runtime registration and shutdown patterns. Do not import them into the
unbundled `server.ts`.

- [ ] **Step 4: Run focused and existing regression tests**

Run:

```bash
node --experimental-strip-types --test --test-concurrency=1 \
  src/lib/server/chat-stop-registry.test.ts \
  src/lib/server/automation-runner.test.ts \
  src/lib/server/daemon-event-watcher.test.ts \
  src/lib/server/familiar-roster-watch.test.ts \
  src/app/api/familiars/route.test.ts \
  src/lib/familiar-removal.test.ts \
  src/lib/cave-config.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/chat-stop-registry.ts \
  src/lib/server/chat-stop-registry.test.ts \
  src/lib/server/automation-runner.ts \
  src/lib/server/automation-runner.test.ts \
  src/lib/server/daemon-event-watcher.ts \
  src/lib/server/daemon-event-watcher.test.ts \
  src/lib/cave-config.ts \
  src/app/api/familiars/route.ts \
  src/app/api/familiars/'[id]'/route.ts \
  src/app/api/familiars/removed/route.ts \
  src/lib/server/familiar-roster-watch.ts \
  src/lib/server/familiar-roster-watch.test.ts \
  src/instrumentation.ts \
  scripts/run-tests.mjs
git commit -m "feat(events): publish runtime and familiar changes"
```

### Task 9: Wire browser/Tauri shadow-mode consumers

**Files:**
- Modify: `src/components/workspace.tsx:1381-1467,1723-1976`
- Modify: `src/components/board-view.tsx:212-305`
- Modify: `src/components/automations-view.tsx:225-340,794-810`
- Modify: `src/components/workspace-feedback.test.ts:44-45`
- Modify: `src/components/board-ux-polish.test.ts:39`
- Modify: `src/components/automations-view.test.ts:198-338`

- [ ] **Step 1: Write failing shadow-mode consumer tests**

Pin the subscription and guarded refresh behavior:

```ts
assert.match(
  workspace,
  /useCaveEventPlane\("sessions",[\s\S]*?loadSessions/,
  "Workspace subscribes the session list owner",
);
assert.match(
  workspace,
  /useCaveEventPlane\("familiars",[\s\S]*?loadFamiliars/,
  "Workspace subscribes the familiar roster owner",
);
assert.match(
  board,
  /useCaveEventPlane\("board",[\s\S]*?invalidateSurfaceResources\("board:cards"\)/,
);
```

Behavior tests must assert that shadow mode receives and counts invalidations
without calling loaders, while every existing polling path remains enabled.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
node --experimental-strip-types \
  src/components/workspace-feedback.test.ts
node --experimental-strip-types \
  src/components/board-ux-polish.test.ts
node --experimental-strip-types --test \
  src/components/automations-view.test.ts
```

Expected: FAIL on missing event subscriptions.

- [ ] **Step 3: Add subscriptions without changing poll enablement**

Workspace:

```ts
const sessionsEvents = useCaveEventPlane(
  "sessions",
  () => void loadSessions(),
);
const familiarEvents = useCaveEventPlane(
  "familiars",
  () => void loadFamiliars(),
);
const daemonEvents = useCaveEventPlane(
  "daemon",
  () => void daemonConnectionSupervisorRef.current?.refresh({ fresh: true }),
);
```

Board:

```ts
useCaveEventPlane("board", () => {
  invalidateSurfaceResources("board:cards");
  if (interactingRef.current) {
    boardEventDirtyRef.current = true;
    return;
  }
  void load({ quiet: true, force: true });
});
```

Automations follow the same rule: call the existing quiet refresh function; do
not add a second fetch implementation.

The client manager suppresses these callbacks in shadow mode. Record event
reception/version counters and leave every current poll enabled; shadow adds no
event-triggered REST reads.

- [ ] **Step 4: Run focused tests and app suite**

Run:

```bash
node --experimental-strip-types \
  src/components/workspace-feedback.test.ts
node --experimental-strip-types \
  src/components/board-ux-polish.test.ts
node --experimental-strip-types --test \
  src/components/automations-view.test.ts
pnpm test:app
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace.tsx \
src/components/board-view.tsx \
src/components/automations-view.tsx \
src/components/workspace-feedback.test.ts \
src/components/board-ux-polish.test.ts \
src/components/automations-view.test.ts
git commit -m "feat(events): connect web surfaces in shadow mode"
```

### Task 10: Make browser/Tauri polling adaptive in primary mode

**Files:**
- Modify: `src/components/workspace.tsx:1795-1976`
- Modify: `src/components/board-view.tsx:286-305`
- Modify: `src/components/automations-view.tsx:794-810`
- Modify: `src/lib/use-pausable-poll.ts`
- Modify: `src/lib/use-pausable-poll.test.ts`
- Create: `src/components/event-plane-polling.test.ts`
- Create: `scripts/event-plane-request-count.test.mjs`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write failing fallback and request-count tests**

Use fake timers/fetch counters:

```ts
test("healthy primary topics pause recurring polls", async () => {
  const fx = renderWorkspace({
    eventMode: "primary",
    readyTopics: ["sessions", "daemon"],
  });
  fx.clock.advance(60_000);
  assert.equal(fx.fetchCount("/api/sessions/list"), 1);
  assert.equal(fx.daemonRefreshCount(), 1);
});

test("disconnect restores the existing fallback cadence", async () => {
  const fx = renderWorkspace({
    eventMode: "primary",
    readyTopics: ["sessions"],
  });
  fx.eventClient.close(1012, "restart");
  fx.clock.advance(4_000);
  assert.equal(fx.fetchCount("/api/sessions/list"), 2);
});

test("one invalidation burst causes one replacement fetch", async () => {
  const fx = readyBoard();
  fx.invalidate("board");
  fx.invalidate("board");
  fx.invalidate("board");
  fx.clock.advance(100);
  await fx.flush();
  assert.equal(fx.fetchCount("/api/board"), 2);
});

test("foreground flushes one dirty topic and does not refetch a clean topic", async () => {
  const fx = readyBoard();
  fx.hide();
  fx.invalidate("board");
  fx.show();
  await fx.flush();
  assert.equal(fx.fetchCount("/api/board"), 2);
  fx.hide();
  fx.show();
  await fx.flush();
  assert.equal(fx.fetchCount("/api/board"), 2);
});
```

The request-count script must assert zero recurring covered reads after initial
settlement during a simulated 60-second healthy window.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --experimental-strip-types --test \
  src/components/event-plane-polling.test.ts
node scripts/event-plane-request-count.test.mjs
```

Expected: FAIL because polling ignores topic health.

- [ ] **Step 3: Gate only recurring polls**

Use:

```ts
const sessionsEventPrimary =
  sessionsEvents.rolloutMode === "primary" && sessionsEvents.ready;

usePausablePoll(() => void loadSessions(), 4_000, {
  enabled: true,
  intervalEnabled: !sessionsEventPrimary,
  refreshOnFocusEnabled: !sessionsEventPrimary,
  pauseWhileInputActive: true,
});
```

Extend `usePausablePoll` with separate `intervalEnabled` and
`refreshOnFocusEnabled` options while preserving the existing `enabled` master
gate. Add hook tests proving interval-only pause does not accidentally change
unrelated callers.

Apply the equivalent gate to:

- Workspace sessions and the daemon supervisor's recurring refresh owner;
- Board's 15-second quiet poll, preserving `!interacting`;
- unsettled automation-run polling.

There is no healthy-state familiar roster poll to pause. Keep its
error-recovery loop enabled; a transient failed fetch does not produce an
invalidation that could clear the error.

Do not gate:

- mount loads;
- explicit Retry/Refresh;
- covered-topic foreground reconciliation from the event manager;
- error-retry polling;
- GitHub/Asana/provider polling; or
- chat/inbox/research SSE.

When Board receives an invalidation during interaction, flush exactly once when
the interaction gate becomes false. Add an explicit ref synchronized from the
existing `interacting` value; do not invent a second interaction state.

- [ ] **Step 4: Run focused tests and performance gate**

Run:

```bash
node --experimental-strip-types --test \
  src/components/event-plane-polling.test.ts
node scripts/event-plane-request-count.test.mjs
pnpm test:app
```

Expected: PASS, with the request-count test reporting zero recurring covered
reads while healthy.

- [ ] **Step 5: Commit**

```bash
git add src/components/workspace.tsx \
  src/components/board-view.tsx \
  src/components/automations-view.tsx \
src/lib/use-pausable-poll.ts \
src/lib/use-pausable-poll.test.ts \
  src/components/event-plane-polling.test.ts \
  scripts/event-plane-request-count.test.mjs \
  scripts/run-tests.mjs
git commit -m "perf(events): pause covered polls while healthy"
```

### Task 11: Add diagnostics and packaged-sidecar verification

**Files:**
- Modify: `src/app/api/daemon/diagnostics/route.ts`
- Modify: `src/components/debug-pane.tsx`
- Modify: `src/components/debug-pane.test.ts`
- Modify: `scripts/cave-performance-report.mjs`
- Modify: `scripts/cave-performance-report.test.mjs`
- Modify: `scripts/sidecar-runtime-smoke.mjs:301-747`
- Modify: `server.ts`

- [ ] **Step 1: Write failing diagnostics and smoke assertions**

Diagnostics must expose only counters/state:

```ts
assert.deepEqual(payload.eventPlane, {
  enabled: true,
  activeConnections: 1,
  readyConnections: 1,
  subscriptions: { board: 1 },
  replayGaps: 0,
  slowConsumerCloses: 0,
});
assert.equal(JSON.stringify(payload).includes("covenCaveToken"), false);
assert.equal(JSON.stringify(payload).includes("entityIds"), false);
```

The browser debug pane separately reads
`caveEventPlaneClient.diagnostics()` and shows reconnects, coalesced
invalidations, fallback activations, and polls avoided.

Extend the sidecar smoke script to:

1. read `/api/events/capability`;
2. build the advertised same-host WS URL;
3. attach the sidecar credential;
4. complete `hello` -> `ready`;
5. perform one real board mutation;
6. receive one `board` invalidation; and
7. close cleanly.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test scripts/cave-performance-report.test.mjs
node --experimental-strip-types --test src/components/debug-pane.test.ts
pnpm test:sidecar-runtime
```

Expected: FAIL on missing diagnostics and event round trip.

- [ ] **Step 3: Implement bounded diagnostics**

Expose an immutable broker/client diagnostics snapshot through a second
`globalThis` bridge:

```ts
globalThis.__covenCaveEventPlaneDiagnostics = () => ({
  enabled: eventPlaneEnabled,
  ...eventBroker.diagnostics(),
});
```

The diagnostics route must return aggregate counts only. The performance report
adds:

- invalidations by topic;
- replay gaps;
- active connections;
- subscription counts; and
- slow-consumer closures.

The debug pane renders the client-side reconnect, coalescing, fallback, and
avoided-poll counters from the manager snapshot. Neither surface receives
credentials, entity IDs, or resource payloads.

Keep the smoke mutation inside its temporary Cave home and remove it during the
existing smoke cleanup.

- [ ] **Step 4: Run diagnostics, smoke, and server build**

Run:

```bash
node --test scripts/cave-performance-report.test.mjs
node --experimental-strip-types --test src/components/debug-pane.test.ts
pnpm build:server
pnpm test:sidecar-runtime
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server.ts \
  src/app/api/daemon/diagnostics/route.ts \
  src/components/debug-pane.tsx \
  src/components/debug-pane.test.ts \
  scripts/cave-performance-report.mjs \
  scripts/cave-performance-report.test.mjs \
  scripts/sidecar-runtime-smoke.mjs
git commit -m "test(events): verify packaged event transport"
```

### Task 12: Add the Swift wire contract and secure URL derivation

**Files:**
- Create: `apps/ios/CovenCave/CovenCave/Models/CaveEventWire.swift`
- Create: `apps/ios/CovenCave/CovenCaveTests/CaveEventWireTests.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Networking/CaveConnection.swift:13-58,217-246`
- Modify: `apps/ios/CovenCave/CovenCaveTests/CaveConnectionTests.swift:5-44`

- [ ] **Step 1: Write failing Swift fixture and URL tests**

Fixture loading:

```swift
private func fixtureData() throws -> Data {
    let url = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .appendingPathComponent("Fixtures/cave-event-plane-v1.json")
    return try Data(contentsOf: url)
}

func testGoldenMessagesDecode() throws {
    let fixture = try JSONDecoder().decode(
        CaveEventFixture.self,
        from: fixtureData()
    )
    XCTAssertEqual(fixture.capability.rolloutMode.ios, .off)
    XCTAssertEqual(fixture.closeCodes.slowConsumer, 4408)
    XCTAssertEqual(fixture.ready.protocol, 1)
    XCTAssertEqual(fixture.invalidate.topic, .board)
}
```

Connection tests:

```swift
func testHTTPSDerivesSecureEventSocket() {
    let connection = CaveConnection(host: "https://cave.example.test:8443")
    XCTAssertEqual(
        connection.eventSocketURL?.absoluteString,
        "wss://cave.example.test:8443/api/events-ws"
    )
}

func testLoopbackHTTPDerivesPlainEventSocket() {
    let connection = CaveConnection(host: "http://127.0.0.1:3020")
    XCTAssertEqual(
        connection.eventSocketURL?.absoluteString,
        "ws://127.0.0.1:3020/api/events-ws"
    )
}

func testCredentialedRemotePlaintextEventSocketIsRefused() {
    let connection = CaveConnection(host: "http://100.64.0.8:3020")
    XCTAssertNil(connection.eventSocketURLForCredentialedRequest)
}
```

- [ ] **Step 2: Generate the project and run tests to verify failure**

Run:

```bash
pnpm mobile:ios:xcodegen
cd apps/ios/CovenCave
xcodebuild test -project CovenCave.xcodeproj -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:CovenCaveTests/CaveEventWireTests \
  -only-testing:CovenCaveTests/CaveConnectionTests
```

Expected: FAIL because the Swift wire types and event URL properties do not
exist.

- [ ] **Step 3: Implement matching Swift wire types and URL mapping**

Define:

```swift
enum CaveEventTopic: String, Codable, CaseIterable, Sendable {
    case sessions, board, runs, familiars, daemon
}

enum CaveEventResyncReason: String, Codable, Sendable {
    case serverRestarted = "server-restarted"
    case replayGap = "replay-gap"
}

enum CaveEventRolloutMode: String, Codable, Sendable {
    case off, shadow, primary
}

struct CaveEventRolloutModes: Codable, Equatable, Sendable {
    let web: CaveEventRolloutMode
    let ios: CaveEventRolloutMode
}

struct CaveEventCapability: Codable, Equatable, Sendable {
    let enabled: Bool
    let protocolVersion: Int
    let path: String
    let topics: [CaveEventTopic]
    let rolloutMode: CaveEventRolloutModes
}

struct CaveEventCloseCodes: Codable, Equatable, Sendable {
    let `protocol`: Int
    let invalidFrame: Int
    let slowConsumer: Int
}

struct CaveEventInvalidation: Codable, Equatable, Sendable {
    let type: String
    let `protocol`: Int
    let epoch: String
    let seq: Int
    let topic: CaveEventTopic
    let version: Int
    let entityIds: [String]?
}

struct CaveEventReady: Codable, Equatable, Sendable {
    let type: String
    let `protocol`: Int
    let epoch: String
    let seq: Int
    let topics: [CaveEventTopic]
    let versions: [CaveEventTopic: Int]
}

struct CaveEventFixture: Codable {
    let capability: CaveEventCapability
    let closeCodes: CaveEventCloseCodes
    let ready: CaveEventReady
    let invalidate: CaveEventInvalidation
}
```

Give `CaveEventReady` a custom `Codable` implementation that decodes the wire
`versions` object as `[String: Int]`, validates every key as a
`CaveEventTopic`, and then stores `[CaveEventTopic: Int]`. Swift's synthesized
dictionary encoding does not preserve string-enum keys as a JSON object.

Use a custom discriminated decoder for `EventServerMessage` so unknown `type`,
topic, or protocol values throw.

Add:

```swift
var eventSocketURL: URL? {
    guard let baseURL,
          var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
    else { return nil }
    switch components.scheme?.lowercased() {
    case "https": components.scheme = "wss"
    case "http": components.scheme = "ws"
    default: return nil
    }
    components.path = "/api/events-ws"
    components.query = nil
    components.fragment = nil
    return components.url
}

var eventSocketURLForCredentialedRequest: URL? {
    guard let url = eventSocketURL,
          Self.isCredentialTransportSecure(url)
    else { return nil }
    return url
}
```

- [ ] **Step 4: Regenerate and run tests to verify pass**

Run the Step 2 command again.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/CovenCave/CovenCave/Models/CaveEventWire.swift \
  apps/ios/CovenCave/CovenCave/Networking/CaveConnection.swift \
  apps/ios/CovenCave/CovenCaveTests/CaveEventWireTests.swift \
  apps/ios/CovenCave/CovenCaveTests/CaveConnectionTests.swift
git commit -m "feat(ios): add websocket event contract"
```

### Task 13: Implement the iOS event-socket actor

**Files:**
- Create: `apps/ios/CovenCave/CovenCave/Networking/CaveEventSocketTransport.swift`
- Create: `apps/ios/CovenCave/CovenCave/Networking/CaveEventSocket.swift`
- Create: `apps/ios/CovenCave/CovenCaveTests/CaveEventSocketTests.swift`

- [ ] **Step 1: Write failing actor tests with an injected transport**

Define a fake transport and cover:

```swift
func testZeroSubscribersKeepsSocketClosed() async {
    let transport = FakeCaveEventSocketTransport()
    let socket = CaveEventSocket(transportFactory: { transport })
    await socket.setSceneActive(true)
    XCTAssertEqual(transport.openCount, 0)
}

func testFirstSubscriberOpensAndSendsHello() async throws {
    let transport = FakeCaveEventSocketTransport()
    let socket = CaveEventSocket(transportFactory: { transport })
    await socket.setSceneActive(true)
    let token = await socket.subscribe(topics: [.sessions]) { _ in }
    XCTAssertEqual(transport.openCount, 1)
    try await transport.completeOpen()
    XCTAssertEqual(transport.lastSentType, "hello")
    await socket.unsubscribe(token)
}

func testBackgroundCancelsAndForegroundResumesCursor() async throws {
    let fixture = readySocket(epoch: "boot-a", seq: 42)
    await fixture.socket.setSceneActive(false)
    XCTAssertEqual(fixture.transport.closeCode, .goingAway)
    await fixture.socket.setSceneActive(true)
    try await fixture.transport.completeOpen()
    XCTAssertEqual(fixture.transport.lastHelloResume?.seq, 42)
}
```

Also cover complete-set subscription replacement, ack throttle, replay gap,
invalid frame degradation, connect timeout, jittered backoff, duplicate/older
version suppression, credential-origin mismatch, a late topic remaining
unhealthy until the replacement `ready`, and shadow mode recording without
calling handlers.

- [ ] **Step 2: Run the focused test to verify failure**

Run:

```bash
pnpm mobile:ios:xcodegen
cd apps/ios/CovenCave
xcodebuild test -project CovenCave.xcodeproj -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:CovenCaveTests/CaveEventSocketTests
```

Expected: FAIL because the actor and transport do not exist.

- [ ] **Step 3: Implement the transport abstraction and actor**

Transport contract:

```swift
protocol CaveEventSocketTransport: Sendable {
    func open(_ request: URLRequest) async throws
    func send(_ message: URLSessionWebSocketTask.Message) async throws
    func receive() async throws -> URLSessionWebSocketTask.Message
    func sendPing() async throws
    func close(code: URLSessionWebSocketTask.CloseCode, reason: Data?)
}
```

The concrete `URLSessionWebSocketTask` adapter implements `sendPing()` by
wrapping `sendPing(pongReceiveHandler:)` in
`withCheckedThrowingContinuation`; do not assume an async Foundation overload
exists.

Actor public API:

```swift
actor CaveEventSocket {
    enum State: Equatable, Sendable {
        case disabled
        case idle
        case connecting
        case ready
        case backingOff(attempt: Int)
        case degraded(String)
    }

    struct SubscriptionToken: Hashable, Sendable {
        let id: UUID
    }

    func setSceneActive(_ active: Bool)
    func subscribe(
        topics: Set<CaveEventTopic>,
        handler: @escaping @Sendable (CaveEventInvalidation) async -> Void
    ) -> SubscriptionToken
    func unsubscribe(_ token: SubscriptionToken)
    func stateSnapshot() -> State
    func topicReady(_ topic: CaveEventTopic) -> Bool
}
```

Implementation requirements:

- one transport while scene-active and subscribed;
- bearer credential on the `URLRequest`;
- exact credential-origin check before open;
- 8-second open timeout;
- full-set subscriptions;
- clear changed-topic readiness until the server's replacement `ready`
  confirms the installed set;
- in-memory epoch/sequence resume;
- highest-sequence ack at most once per second;
- 25-second ping task;
- cancellation of receive/ping/backoff tasks on background or zero subscribers;
- 500 ms to 30-second backoff with injected jitter; and
- typed health callbacks to `AppModel`.

Initialize the actor with `capability.rolloutMode.ios`. In `shadow`, validate,
sequence, acknowledge, and count events without invoking store handlers. In
`primary`, deliver handlers through the duplicate/version and scene gates.

- [ ] **Step 4: Run the actor tests to verify pass**

Run the Step 2 command again.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/CovenCave/CovenCave/Networking/CaveEventSocketTransport.swift \
  apps/ios/CovenCave/CovenCave/Networking/CaveEventSocket.swift \
  apps/ios/CovenCave/CovenCaveTests/CaveEventSocketTests.swift
git commit -m "feat(ios): add demand-driven event socket"
```

### Task 14: Integrate iOS stores, scene lifecycle, and adaptive fallback

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/State/AppModel.swift:388,443,4237-4240,4677-5176,5552-5700`
- Modify: `apps/ios/CovenCave/CovenCave/State/ConnectionBackgroundRefresh.swift:23-94`
- Modify: `apps/ios/CovenCave/CovenCave/State/FamiliarDashboardSnapshot.swift:206-214`
- Modify: `apps/ios/CovenCave/CovenCave/State/FamiliarDashboardStore.swift:42-151`
- Modify: `apps/ios/CovenCave/CovenCave/CovenCaveApp.swift:17,76-144`
- Modify: `apps/ios/CovenCave/CovenCave/Views/FamiliarHubView.swift:51-167`
- Modify: `apps/ios/CovenCave/CovenCave/Views/FamiliarThreadsView.swift:153-155`
- Modify: `apps/ios/CovenCave/CovenCave/Views/TaskDetailView.swift:80-82`
- Modify: `apps/ios/CovenCave/CovenCave/LiveActivity/LiveActivityManager.swift:9-40`
- Modify: `apps/ios/CovenCave/CovenCaveTests/FamiliarDashboardStoreTests.swift`
- Modify: `apps/ios/CovenCave/CovenCaveTests/AppModelProjectContextTests.swift:4703-6082`

- [ ] **Step 1: Write failing store and lifecycle tests**

Add:

```swift
func testHealthyEventSocketPausesFamiliarDashboardPoll() {
    XCTAssertFalse(
        FamiliarDashboardRefreshPolicy.shouldPoll(
            hubVisible: true,
            sceneActive: true,
            endpointConfigured: true,
            eventTopicReady: true,
            rolloutMode: .primary
        )
    )
}

func testDisconnectedSocketRestoresFamiliarDashboardPoll() {
    XCTAssertTrue(
        FamiliarDashboardRefreshPolicy.shouldPoll(
            hubVisible: true,
            sceneActive: true,
            endpointConfigured: true,
            eventTopicReady: false,
            rolloutMode: .primary
        )
    )
}

func testSessionInvalidationUsesExistingSingleFlightLoader() async {
    let model = makeModel(eventMode: .primary)
    await model.receiveEvent(.invalidate(topic: .sessions, version: 2))
    await model.receiveEvent(.invalidate(topic: .sessions, version: 3))
    XCTAssertEqual(model.client.sessionLoadCount, 1)
}
```

Also test task/run/familiar/daemon routing, background cancellation, foreground
resync, preserved optimistic task mutation state, and duplicate/older version
suppression.

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
pnpm mobile:ios:xcodegen
cd apps/ios/CovenCave
xcodebuild test -project CovenCave.xcodeproj -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:CovenCaveTests/FamiliarDashboardStoreTests \
  -only-testing:CovenCaveTests/AppModelProjectContextTests \
  -only-testing:CovenCaveTests/CaveEventSocketTests
```

Expected: FAIL because stores and scene lifecycle do not consume socket health.

- [ ] **Step 3: Integrate through existing single-flight owners**

`AppModel` owns one socket:

```swift
private let eventSocket: CaveEventSocket
private(set) var eventTopicHealth: [CaveEventTopic: Bool] = [:]

private func handleEventInvalidation(_ event: CaveEventInvalidation) async {
    switch event.topic {
    case .sessions:
        await loadSessions()
    case .board:
        await loadTasks()
    case .runs:
        await loadSessions()
        await liveActivityManager.reconcile()
    case .familiars:
        await loadFamiliars()
    case .daemon:
        requestConnectionRecovery(.streamFailure)
    }
}
```

Scene lifecycle:

```swift
.onChange(of: scenePhase) { _, phase in
    Task {
        await model.setEventSceneActive(phase == .active)
    }
}
```

Fallback policy:

```swift
static func shouldPoll(
    hubVisible: Bool,
    sceneActive: Bool,
    endpointConfigured: Bool,
    eventTopicReady: Bool,
    rolloutMode: CaveEventRolloutMode
) -> Bool {
    hubVisible
        && sceneActive
        && endpointConfigured
        && !(rolloutMode == .primary && eventTopicReady)
}
```

Keep RootView's theme poll, manual refresh, initial loads, and provider polling
unchanged.

Load `/api/events/capability` through the existing authenticated request path
when a connection becomes usable, initialize the socket from
`rolloutMode.ios`, and fail closed to `off` when discovery or decoding fails.
Do not derive iOS behavior from the web rollout field.

- [ ] **Step 4: Run focused and mobile suites**

Run:

```bash
cd apps/ios/CovenCave
xcodebuild test -project CovenCave.xcodeproj -scheme CovenCave \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' \
  -only-testing:CovenCaveTests/CaveEventWireTests \
  -only-testing:CovenCaveTests/CaveEventSocketTests \
  -only-testing:CovenCaveTests/CaveConnectionTests \
  -only-testing:CovenCaveTests/FamiliarDashboardStoreTests \
  -only-testing:CovenCaveTests/AppModelProjectContextTests
cd ../../..
pnpm test:mobile
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/ios/CovenCave/CovenCave/State/AppModel.swift \
  apps/ios/CovenCave/CovenCave/State/ConnectionBackgroundRefresh.swift \
  apps/ios/CovenCave/CovenCave/State/FamiliarDashboardSnapshot.swift \
  apps/ios/CovenCave/CovenCave/State/FamiliarDashboardStore.swift \
  apps/ios/CovenCave/CovenCave/CovenCaveApp.swift \
  apps/ios/CovenCave/CovenCave/Views/FamiliarHubView.swift \
  apps/ios/CovenCave/CovenCave/Views/FamiliarThreadsView.swift \
  apps/ios/CovenCave/CovenCave/Views/TaskDetailView.swift \
  apps/ios/CovenCave/CovenCave/LiveActivity/LiveActivityManager.swift \
  apps/ios/CovenCave/CovenCaveTests/FamiliarDashboardStoreTests.swift \
  apps/ios/CovenCave/CovenCaveTests/AppModelProjectContextTests.swift
git commit -m "perf(ios): use event invalidations with polling fallback"
```

### Task 15: Run cross-platform conformance and finalize operations docs

**Files:**
- Modify: `docs/superpowers/specs/2026-08-28-demand-driven-websocket-event-plane-design.md`
- Create: `docs/event-plane-operations.md`
- Modify: `docs/mobile-readiness.md`
- Modify: `src/lib/cave-event-plane-protocol.test.ts`
- Modify: `apps/ios/CovenCave/CovenCaveTests/CaveEventWireTests.swift`

- [ ] **Step 1: Add failing final conformance assertions**

TypeScript and Swift must both:

- decode every golden message;
- reject every malformed message;
- assert the exact five-topic set;
- assert protocol version `1`;
- assert the exact `/api/events-ws` path; and
- assert the fixed `4400`, `4402`, and `4408` close codes;
- assert independent web/iOS `off | shadow | primary` rollout modes; and
- assert `ready` remains valid after both `hello` and replacement `subscribe`.

Add a docs contract test if an existing documentation test suite covers
operational docs; otherwise use the existing UI consistency/test-wiring checks
without creating a new docs framework.

- [ ] **Step 2: Run the full targeted matrix before docs finalization**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test:app
pnpm test:api
pnpm test:mobile
pnpm build
node scripts/event-plane-runtime-conformance.mjs
pnpm test:sidecar-runtime
node scripts/event-plane-request-count.test.mjs
```

Then run the focused Xcode matrix from Task 14.

Expected: PASS. Any missing platform decoder, unwired test, undefined token,
packaging import, or fallback regression fails before documentation is marked
complete.

- [ ] **Step 3: Write the operations documentation**

`docs/event-plane-operations.md` must document:

```text
Capability:
  GET /api/events/capability

Endpoint:
  /api/events-ws on the existing Cave HTTP server

Modes:
  web and iOS configured independently
  off     - no connection; polling authoritative
  shadow  - socket observed; no event-triggered reads; polling authoritative
  primary - socket healthy pauses covered polls

Topics:
  sessions, board, runs, familiars, daemon

Security:
  same-host + Origin checks
  direct loopback allowed
  signed mobile or sidecar credential required remotely
  PTY alone requires remote passkey presence

Recovery:
  reconnect with epoch/sequence
  replay when retained
  full REST resync on restart/gap
  adaptive polling whenever topic health is not ready

Diagnostics:
  server report: connections, subscriptions, publications, replay gaps, backpressure
  client debug: reconnects, coalescing, fallback activations, polls avoided

Kill switch:
  COVEN_CAVE_EVENT_PLANE_ENABLED=0
  COVEN_CAVE_EVENT_WEB_MODE=off
  COVEN_CAVE_EVENT_IOS_MODE=off
```

Update `docs/mobile-readiness.md` with iOS foreground/background and credential
transport behavior. Update the design only for final exact names that changed
during implementation; do not rewrite approved decisions.

- [ ] **Step 4: Re-run the complete validation matrix**

Run the commands from Step 2 again after documentation/test wiring.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/event-plane-operations.md \
  docs/mobile-readiness.md \
  docs/superpowers/specs/2026-08-28-demand-driven-websocket-event-plane-design.md \
  src/lib/cave-event-plane-protocol.test.ts \
  apps/ios/CovenCave/CovenCaveTests/CaveEventWireTests.swift
git commit -m "docs(events): document websocket operations"
```

## Pull request sequence

Use one PR per independently verifiable boundary:

1. Protocol, broker, upgrade security, and disabled capability.
2. Authoritative publishers.
3. Browser/Tauri shadow mode and diagnostics.
4. Browser/Tauri primary mode and request-count gates.
5. iOS wire contract and socket actor.
6. iOS integration and primary fallback.
7. Operational documentation and final consolidation.

Each PR must keep the event plane killable and leave REST snapshots functional.
Do not combine polling removal with the first transport PR.

## Completion evidence

Before closing implementation children under `cave-qjvbb`, record:

- exact branch, worktree, owner, and PR;
- protocol fixture version;
- targeted and full validation commands;
- healthy 60-second request-count result;
- packaged-sidecar event round trip;
- iOS foreground/background reconnect result;
- fallback restoration result; and
- final `pnpm beads:worktrees` disposition after merge.
