# Daemon Connection and Request-Noise Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace overlapping heavyweight daemon-status polling with a pure, coalesced connection heartbeat and a serial adaptive client supervisor, then remove the remaining verified full-status polling noise.

**Architecture:** A server-side connection snapshot module resolves the current target, performs one bounded health probe without the generic GET retry, and shares equivalent concurrent work through a short target-keyed cache. A pure client supervisor schedules exactly one request at a time, backs off with bounded jitter, pauses in the background, and supports fresh explicit retries; Workspace consumes it while detailed Settings diagnostics keep the existing full status route.

**Tech Stack:** Next.js App Router, React 19, TypeScript 6, Node HTTP/HTTPS, `node:test`, repository source-contract tests, pnpm.

---

## File Map

- Create `src/lib/server/daemon-connection-snapshot.ts`
  - Pure connection response shape, target keying, single-flight probe broker,
    short TTL cache, fresh bypass, and availability classification.
- Create `src/lib/server/daemon-connection-snapshot.test.ts`
  - Executable broker tests for coalescing, TTL, target isolation, fresh bypass,
    timeout budget, and storage-unavailable behavior.
- Create `src/app/api/daemon/connection/route.ts`
  - Narrow GET endpoint for shell and summary heartbeat consumers.
- Create `src/app/api/daemon/connection/route.test.ts`
  - Route contract test proving it delegates only to the connection snapshot.
- Create `src/lib/daemon-connection-supervisor.ts`
  - Framework-free serial scheduler and lifecycle controller.
- Create `src/lib/daemon-connection-supervisor.test.ts`
  - Deterministic scheduler tests with fake timers, requests, visibility, and
    randomness.
- Modify `src/lib/coven-daemon.ts`
  - Add an explicit `retryTransportFailure` request option; preserve retry as
    the default for ordinary GET callers.
- Modify `src/lib/coven-daemon.test.ts`
  - Pin default retry behavior and the heartbeat opt-out.
- Modify `src/components/workspace.tsx`
  - Replace the fixed five-second full-status interval with the supervisor and
    the connection endpoint while preserving classification, auto-start, auth,
    banner, and healthy-streak behavior.
- Modify `src/components/workspace-daemon-status.test.ts`
  - Pin the connection endpoint, serial supervisor, trusted fresh refresh, and
    removal of recurring full-status polling.
- Modify `src/components/settings-overview.tsx`
  - Use the lightweight connection endpoint for its recurring daemon summary.
- Modify `src/lib/settings-general-summary.test.ts`
  - Pin the lightweight summary request.
- Modify `scripts/run-tests.mjs`
  - Wire every new test into the correct suite.
- Modify `docs/superpowers/specs/2026-08-01-daemon-connection-request-noise-design.md`
  - Add measured before/after evidence and the final list of audited producers.

### Task 1: Make transport retry explicit

**Files:**
- Modify: `src/lib/coven-daemon.ts`
- Modify: `src/lib/coven-daemon.test.ts`

- [ ] **Step 1: Write the failing no-retry regression**

Add a test beside the existing GET retry coverage:

```ts
test("connection heartbeat can disable the transport retry", async () => {
  let attempts = 0;
  const server = createServer((_req, res) => {
    attempts += 1;
    res.destroy();
  });
  const target = await listenAsHub(server);

  const result = await callDaemonTarget(target, {
    path: "/api/v1/health",
    timeoutMs: 25,
    retryTransportFailure: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.equal(attempts, 1);
  await closeServer(server);
});
```

Keep the existing test that proves an ordinary failed GET makes two attempts.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --experimental-strip-types src/lib/coven-daemon.test.ts
```

Expected: TypeScript/runtime failure because `retryTransportFailure` is not
part of `DaemonRequest`.

- [ ] **Step 3: Add the request option without changing defaults**

Extend the request type:

```ts
export type DaemonRequest = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  timeoutMs?: number;
  maxResponseBytes?: number;
  retryTransportFailure?: boolean;
};
```

Thread it through `callDaemon()` and `callDaemonTarget()`, defaulting to `true`:

```ts
export async function callDaemonTarget<T = unknown>(
  target: DaemonTarget,
  {
    method = "GET",
    path: reqPath,
    body,
    timeoutMs = 4000,
    maxResponseBytes,
    retryTransportFailure = true,
  }: DaemonRequest,
): Promise<DaemonResponse<T>> {
  // ...
  if (
    retryTransportFailure &&
    !first.ok &&
    first.status === 0 &&
    method === "GET"
  ) {
    // existing retry
  }
}
```

The option controls only the outer retry. Idle and hard deadlines remain
unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --experimental-strip-types src/lib/coven-daemon.test.ts
```

Expected: PASS, including both default retry and explicit no-retry cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/coven-daemon.ts src/lib/coven-daemon.test.ts
git commit -S -m "fix(daemon): make health retry policy explicit"
git push -u origin fix/cave-a5594-daemon-connection-noise
```

### Task 2: Build the target-keyed connection snapshot broker

**Files:**
- Create: `src/lib/server/daemon-connection-snapshot.ts`
- Create: `src/lib/server/daemon-connection-snapshot.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write broker tests**

Cover these executable cases:

```ts
test("equivalent concurrent reads share one probe", async () => {
  const pending = deferred<DaemonResponse<Health>>();
  let calls = 0;
  const broker = createDaemonConnectionSnapshotBroker({
    loadConfig: async () => localConfig,
    callTarget: async () => {
      calls += 1;
      return pending.promise;
    },
    now: () => 100,
  });

  const first = broker.read();
  const second = broker.read();
  assert.equal(calls, 1);
  pending.resolve(healthyResponse);
  assert.deepEqual(await first, await second);
});

test("cache is separated by resolved target identity", async () => {
  let config = localConfig;
  const targets: string[] = [];
  const broker = createDaemonConnectionSnapshotBroker({
    loadConfig: async () => config,
    callTarget: async (target) => {
      targets.push(daemonConnectionTargetKey(target));
      return healthyResponse;
    },
    now: () => 100,
  });

  await broker.read();
  config = hubConfig("https://hub.example");
  await broker.read();
  assert.equal(targets.length, 2);
});

test("fresh reads bypass a live cache entry", async () => {
  let calls = 0;
  const broker = createDaemonConnectionSnapshotBroker({
    loadConfig: async () => localConfig,
    callTarget: async () => {
      calls += 1;
      return healthyResponse;
    },
    now: () => 100,
  });

  await broker.read();
  await broker.read({ fresh: true });
  assert.equal(calls, 2);
});

test("heartbeat disables duplicate GET retry and uses a short timeout", async () => {
  const requests: DaemonRequest[] = [];
  const broker = createDaemonConnectionSnapshotBroker({
    loadConfig: async () => localConfig,
    callTarget: async (_target, request) => {
      requests.push(request);
      return offlineResponse;
    },
  });

  await broker.read();
  assert.deepEqual(requests, [{
    path: "/api/v1/health",
    timeoutMs: 750,
    retryTransportFailure: false,
  }]);
});
```

Also test TTL expiry, unauthorized/unhealthy/unreachable classification, exact
local offline classification, unconfigured hub, and a rejected config load.

- [ ] **Step 2: Wire and run the tests to verify RED**

Append `src/lib/server/daemon-connection-snapshot.test.ts` to the `api` suite in
`scripts/run-tests.mjs`.

Run:

```bash
node --experimental-strip-types src/lib/server/daemon-connection-snapshot.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the response contract and target key**

Create:

```ts
export type DaemonConnectionSnapshot = {
  running: boolean;
  availability: DaemonAvailability;
  checkedAt: string;
  target: ReturnType<typeof daemonConnectionTargetSummary>;
  reason?: string;
};

export function daemonConnectionTargetKey(target: DaemonTarget): string {
  if (target.mode === "local") return `local:${target.socketPath}`;
  if (target.mode === "hub") return `hub:${target.url}`;
  return "unconfigured-hub";
}
```

Do not include access tokens in the key or response.

- [ ] **Step 4: Implement a bounded broker**

Use one shared entry per target:

```ts
type CacheEntry = {
  expiresAt: number;
  value?: DaemonConnectionSnapshot;
  pending?: Promise<DaemonConnectionSnapshot>;
};

export function createDaemonConnectionSnapshotBroker(
  deps: DaemonConnectionSnapshotDependencies,
) {
  const entries = new Map<string, CacheEntry>();

  async function read(options: { fresh?: boolean } = {}) {
    const config = await deps.loadConfig();
    const target = daemonTargetForConfig(config);
    const key = daemonConnectionTargetKey(target);
    const now = deps.now?.() ?? Date.now();
    const current = entries.get(key);
    if (!options.fresh && current?.pending) return current.pending;
    if (!options.fresh && current?.value && current.expiresAt > now) {
      return current.value;
    }

    const pending = probeDaemonConnection(target, deps).then((value) => {
      entries.set(key, {
        value,
        expiresAt: (deps.now?.() ?? Date.now()) + 1_000,
      });
      return value;
    }).catch((error) => {
      entries.delete(key);
      throw error;
    });
    entries.set(key, { expiresAt: 0, pending });
    return pending;
  }

  return { read, clear: () => entries.clear() };
}
```

If a fresh read arrives while a background probe is pending, it starts a new
probe and becomes the cache authority. Fence the older completion with a
generation/token check so it cannot overwrite the fresh result.

- [ ] **Step 5: Implement pure probing and classification**

For a configured target call:

```ts
await deps.callTarget(target, {
  path: "/api/v1/health",
  timeoutMs: 750,
  retryTransportFailure: false,
});
```

Reuse `classifyDaemonFailureAvailability()`, `extractDaemonError()`, and
`classifyHubFailure()`. Return an explicit `misconfigured` snapshot for an
unconfigured hub. Let unexpected config/storage exceptions reject so the route
can return the existing `status-unavailable` shape rather than inventing an
offline result.

- [ ] **Step 6: Run focused tests and test wiring**

Run:

```bash
node --experimental-strip-types src/lib/server/daemon-connection-snapshot.test.ts
pnpm check:tests-wired
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/daemon-connection-snapshot.ts \
  src/lib/server/daemon-connection-snapshot.test.ts scripts/run-tests.mjs
git commit -S -m "feat(daemon): coalesce connection health probes"
git push
```

### Task 3: Expose the lightweight connection endpoint

**Files:**
- Create: `src/app/api/daemon/connection/route.ts`
- Create: `src/app/api/daemon/connection/route.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the route contract test**

The source test must prove the route:

```ts
assert.match(source, /loadDaemonConnectionSnapshot\(\{ fresh \}\)/);
assert.match(source, /searchParams\.get\("fresh"\) === "1"/);
assert.match(source, /status-unavailable/);
assert.doesNotMatch(source, /executorStatusesForConfig/);
assert.doesNotMatch(source, /syncOfflineTravelQueue/);
assert.doesNotMatch(source, /startLocalDaemon/);
assert.doesNotMatch(source, /installedCovenVersion/);
```

- [ ] **Step 2: Wire and run the route test to verify RED**

Append `src/app/api/daemon/connection/route.test.ts` to the `api` suite.

Run:

```bash
node --experimental-strip-types src/app/api/daemon/connection/route.test.ts
```

Expected: FAIL with ENOENT.

- [ ] **Step 3: Implement the route**

Create:

```ts
import { NextRequest, NextResponse } from "next/server";
import { loadDaemonConnectionSnapshot } from "@/lib/server/daemon-connection-snapshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const fresh = request.nextUrl.searchParams.get("fresh") === "1";
  try {
    return NextResponse.json(await loadDaemonConnectionSnapshot({ fresh }));
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as NodeJS.ErrnoException).code ?? "")
      : "connection-snapshot";
    console.warn("[daemon-connection] snapshot unavailable", { code });
    return NextResponse.json({
      running: false,
      availability: "status-unavailable",
      reason: "Daemon connection status is temporarily unavailable",
      checkedAt: new Date().toISOString(),
    });
  }
}
```

The unavailable response intentionally omits `target`; the existing client
classifier treats it as unavailable, never local-offline.

- [ ] **Step 4: Run focused API tests**

Run:

```bash
node --experimental-strip-types src/app/api/daemon/connection/route.test.ts
node --experimental-strip-types src/lib/server/daemon-connection-snapshot.test.ts
pnpm check:tests-wired
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/daemon/connection/route.ts \
  src/app/api/daemon/connection/route.test.ts scripts/run-tests.mjs
git commit -S -m "feat(api): add lightweight daemon connection status"
git push
```

### Task 4: Build the serial adaptive connection supervisor

**Files:**
- Create: `src/lib/daemon-connection-supervisor.ts`
- Create: `src/lib/daemon-connection-supervisor.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write deterministic scheduler tests**

Use a fake scheduler and deferred fetches to prove:

```ts
test("never overlaps requests", async () => {
  const first = deferred<DaemonConnectionPoll>();
  let calls = 0;
  const supervisor = createDaemonConnectionSupervisor({
    request: async () => {
      calls += 1;
      return first.promise;
    },
    schedule: fake.schedule,
    cancelSchedule: fake.cancel,
    random: () => 0.5,
    isVisible: () => true,
    publish: () => {},
  });

  supervisor.start();
  supervisor.refresh();
  fake.runDue();
  assert.equal(calls, 1);
  first.resolve(runningPoll);
  await supervisor.settled();
});
```

Add cases for:

- online cadence is 5,000 ms;
- consecutive unavailable/offline results schedule 5s, 10s, 20s, then cap at
  30s before jitter;
- jitter stays within 80%-120% of the base delay;
- hidden state cancels the timer and does not publish a failure;
- foreground triggers one immediate request;
- `refresh({ fresh: true })` aborts/supersedes an old request and appends
  `?fresh=1`;
- an abort does not increment failures or publish offline;
- stop aborts and clears all work;
- stale completion cannot publish after a fresh request.

- [ ] **Step 2: Wire and run the test to verify RED**

Append `src/lib/daemon-connection-supervisor.test.ts` to the `app` suite.

Run:

```bash
node --experimental-strip-types src/lib/daemon-connection-supervisor.test.ts
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement framework-free types**

Create:

```ts
export type DaemonConnectionPoll = {
  responseStatus: number;
  responseOk: boolean;
  payload: unknown;
  error?: string;
};

export type DaemonConnectionSupervisor = {
  start(): void;
  stop(): void;
  refresh(options?: { fresh?: boolean }): Promise<void>;
  setVisible(visible: boolean): void;
};
```

Dependencies must include:

```ts
request(input: {
  signal: AbortSignal;
  fresh: boolean;
}): Promise<DaemonConnectionPoll>;
publish(
  poll: DaemonConnectionPoll,
  context: { fresh: boolean },
): void;
```

They also include schedule, cancelSchedule, random, and visibility seams. Do
not import React or access `document` in this module.

- [ ] **Step 4: Implement serial scheduling**

Use a one-shot timer scheduled only in `finally` after the authoritative
request settles. Track:

```ts
let active: { generation: number; controller: AbortController } | null = null;
let timer: unknown = null;
let failures = 0;
let generation = 0;
let started = false;
let visible = deps.isVisible();
```

`refresh()` clears the timer and returns the authoritative request promise. If
a request is active, ordinary refreshes return that promise; a fresh refresh
increments generation, aborts the old request, and starts immediately.

Compute delay with:

```ts
export function daemonConnectionPollDelay(
  failures: number,
  random: () => number,
): number {
  const base = failures <= 1
    ? 5_000
    : failures <= 3
      ? 10_000
      : failures <= 7
        ? 20_000
        : 30_000;
  return Math.round(base * (0.8 + random() * 0.4));
}
```

Reset failures only on a classified running result. Increment for offline or
unavailable results. Auth-expired remains a failure for cadence but retains its
classification for Workspace.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --experimental-strip-types src/lib/daemon-connection-supervisor.test.ts
pnpm check:tests-wired
```

Expected: PASS with peak in-flight count exactly one.

- [ ] **Step 6: Commit**

```bash
git add src/lib/daemon-connection-supervisor.ts \
  src/lib/daemon-connection-supervisor.test.ts scripts/run-tests.mjs
git commit -S -m "feat(daemon): supervise connection polling serially"
git push
```

### Task 5: Integrate Workspace and remove recurring full-status reads

**Files:**
- Modify: `src/components/workspace.tsx`
- Modify: `src/components/workspace-daemon-status.test.ts`
- Modify: `src/components/settings-overview.tsx`
- Modify: `src/lib/settings-general-summary.test.ts`

- [ ] **Step 1: Write Workspace source-contract regressions**

Add assertions:

```ts
assert.match(source, /createDaemonConnectionSupervisor/);
assert.match(source, /"\/api\/daemon\/connection"/);
assert.match(source, /fresh \? "\/api\/daemon\/connection\?fresh=1"/);
assert.match(source, /document\.addEventListener\("visibilitychange"/);
assert.match(source, /window\.addEventListener\("focus"/);
assert.doesNotMatch(
  daemonPollingBlock,
  /usePausablePoll\([\s\S]*?refreshDaemonStatus\(\), 5000/,
);
assert.doesNotMatch(daemonPollingBlock, /"\/api\/daemon\/status"/);
```

Preserve existing assertions for auto-start, request-generation fencing,
auth-expired state, offline classification, trusted refresh, and two-success
hysteresis.

- [ ] **Step 2: Write the Settings summary regression**

Change the expected daemon summary URL:

```ts
assert.match(source, /fetch\("\/api\/daemon\/connection", \{ cache: "no-store"/);
assert.doesNotMatch(summaryHook, /fetch\("\/api\/daemon\/status"/);
```

- [ ] **Step 3: Run both tests to verify RED**

Run:

```bash
node --experimental-strip-types src/components/workspace-daemon-status.test.ts
node --experimental-strip-types src/lib/settings-general-summary.test.ts
```

Expected: FAIL because both components still use `/api/daemon/status`.

- [ ] **Step 4: Integrate the supervisor into Workspace**

Keep `refreshDaemonStatus` as the single publisher of classified state, but
make its request injectable by the supervisor:

```ts
const applyDaemonPoll = useCallback((
  poll: DaemonConnectionPoll,
  context: { fresh: boolean },
) => {
  const result = classifyDaemonStatusPoll(poll);
  // existing accepted-status, auto-start, auth, unavailable, offline,
  // running, and healthy-streak updates
}, []);
```

Create the supervisor once in a ref. Its request function must call:

```ts
const url = fresh
  ? "/api/daemon/connection?fresh=1"
  : "/api/daemon/connection";
const response = await fetch(url, {
  cache: "no-store",
  signal,
});
return {
  responseStatus: response.status,
  responseOk: response.ok,
  payload: await response.json().catch(() => null),
};
```

Mount lifecycle:

```ts
useEffect(() => {
  const supervisor = daemonConnectionSupervisorRef.current!;
  const syncVisibility = () => supervisor.setVisible(!document.hidden);
  const refreshOnFocus = () => supervisor.refresh();
  supervisor.start();
  document.addEventListener("visibilitychange", syncVisibility);
  window.addEventListener("focus", refreshOnFocus);
  return () => {
    document.removeEventListener("visibilitychange", syncVisibility);
    window.removeEventListener("focus", refreshOnFocus);
    supervisor.stop();
  };
}, []);
```

Pass `supervisor.refresh({ fresh: true })` to `runWorkspaceDaemonStart()` as
the trusted post-Start refresh. `applyDaemonPoll()` treats `context.fresh` as
the existing trusted flag, so the successful fresh result clears the healthy
streak immediately. A failed Start awaits `supervisor.refresh()` without the
fresh flag.

Remove only the daemon-specific fixed `usePausablePoll`; do not alter other
Workspace polls.

- [ ] **Step 5: Point Settings overview at the connection endpoint**

Change only the daemon summary request:

```ts
read(fetch("/api/daemon/connection", { cache: "no-store" }))
```

Voice and backup summary behavior stays unchanged.

- [ ] **Step 6: Run focused integration tests**

Run:

```bash
node --experimental-strip-types src/components/workspace-daemon-status.test.ts
node --experimental-strip-types src/lib/daemon-desktop-auto-start.test.ts
node --experimental-strip-types src/lib/daemon-status-classification.test.ts
node --experimental-strip-types src/lib/settings-general-summary.test.ts
node --experimental-strip-types src/lib/daemon-connection-supervisor.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/workspace.tsx \
  src/components/workspace-daemon-status.test.ts \
  src/components/settings-overview.tsx \
  src/lib/settings-general-summary.test.ts
git commit -S -m "perf(shell): decouple heartbeat from daemon diagnostics"
git push
```

### Task 6: Audit evidence, cumulative review, gates, PR, and merge

**Files:**
- Modify: `docs/superpowers/specs/2026-08-01-daemon-connection-request-noise-design.md`
- Modify only additional request producers that meet the spec's evidence test.
- Add one focused test for each additional producer changed.

- [ ] **Step 1: Generate a current request-producer inventory**

Run:

```bash
rg -n 'setInterval|setTimeout|usePausablePoll|visibilitychange|window\.addEventListener\("focus"|fetch\(' \
  src/components src/lib > /tmp/cave-request-producers.txt
```

Classify each recurring or mount-time producer in the Bead notes as:

- explicit user action/stream — preserve;
- already serial/cancelled/backed off — no change;
- duplicate or overlapping — patch;
- expensive full read for a small signal — replace with a narrow read.

Do not commit the temporary inventory.

- [ ] **Step 2: Apply only evidenced adjacent fixes with TDD**

For every additional changed producer:

1. add a failing focused test proving overlap, duplicate fetch, stale
   completion, missing abort, or inappropriate full-detail endpoint;
2. run it and record the expected failure;
3. implement cancellation, single-flight, adaptive scheduling, or the narrow
   endpoint;
4. run the focused test to green;
5. commit the coherent fix with a signed commit and push.

If no additional producer meets the evidence threshold, record that outcome in
the design evidence section and make no speculative change.

- [ ] **Step 3: Add before/after evidence to the design**

Append a `## Implementation Evidence` section containing:

```md
- Before: a fixed 5,000 ms interval could start another shell status request
  while the previous failed GET was still inside its retry/deadline window.
- After: the supervisor's deterministic test records peak in-flight requests
  of 1 and schedules the next attempt only after settlement.
- Before: each shell heartbeat executed executor/travel/replay/start/version
  status work.
- After: recurring shell and Settings summary reads use
  `/api/daemon/connection`; `/api/daemon/status` remains explicit diagnostics.
- Audited producers:
  - `src/components/workspace.tsx`: replace overlapping five-second full
    status polling with the serial connection supervisor.
  - `src/components/settings-overview.tsx`: replace recurring full status with
    the connection endpoint.
  - `src/components/settings-daemon.tsx`: preserve its abortable,
    surface-scoped detailed status load and explicit refresh.
  - `src/components/settings-shell.tsx`: preserve its one-time abortable
    workspace-path load unless measurement shows repeated mounting.
  - `src/components/settings-about.tsx`: preserve its abortable active-section
    diagnostics load.
```

Use measured test output for any timing/count values added.

- [ ] **Step 4: Run the targeted validation set**

Run:

```bash
node --experimental-strip-types src/lib/coven-daemon.test.ts
node --experimental-strip-types src/lib/server/daemon-connection-snapshot.test.ts
node --experimental-strip-types src/app/api/daemon/connection/route.test.ts
node --experimental-strip-types src/lib/daemon-connection-supervisor.test.ts
node --experimental-strip-types src/components/workspace-daemon-status.test.ts
node --experimental-strip-types src/lib/daemon-desktop-auto-start.test.ts
node --experimental-strip-types src/lib/daemon-status-classification.test.ts
node --experimental-strip-types src/lib/settings-general-summary.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run repository gates**

Run:

```bash
pnpm check:tests-wired
pnpm typecheck
pnpm lint
pnpm test:api
pnpm test:app
pnpm build
git diff --check origin/main...HEAD
```

Expected: all pass. If a full suite exposes a pre-existing failure, reproduce
it on clean `origin/main` before classifying it as unrelated.

- [ ] **Step 6: Request cumulative code review**

Use the code-review agent with:

- requirements: the committed design and this implementation plan;
- base SHA: `origin/main`;
- head SHA: current `HEAD`;
- focus: request overlap, cache races, stale completion, auth classification,
  target-key secrecy, background lifecycle, and Start freshness.

Fix every Critical and Important finding, rerun affected focused tests, commit,
and push. Request a follow-up review if the fix changes concurrency semantics.

- [ ] **Step 7: Update the Bead before PR**

Record:

- branch and worktree;
- changed request producers;
- before/after evidence;
- exact validation commands and results;
- upstream PTY reaper/compaction explicitly excluded.

- [ ] **Step 8: Create one PR**

Run:

```bash
git push -u origin fix/cave-a5594-daemon-connection-noise
printf '%s\n' \
  '## Summary' \
  '- split the lightweight daemon heartbeat from detailed status diagnostics' \
  '- serialize and back off shell connection polling with fresh Start/Retry recovery' \
  '- remove recurring full-status reads from the Settings summary' \
  '' \
  '## Evidence' \
  '- peak heartbeat requests in flight: 1' \
  '- full executor/travel/replay/start/version work is absent from recurring heartbeats' \
  '' \
  '## Tests' \
  '- pnpm check:tests-wired' \
  '- pnpm typecheck' \
  '- pnpm lint' \
  '- pnpm test:api' \
  '- pnpm test:app' \
  '- pnpm build' \
  '' \
  'Bead: cave-a5594' \
  '' \
  'Upstream Coven daemon PTY reaping and SQLite compaction remain out of scope.' \
  > /tmp/cave-a5594-pr-body.md
gh pr create \
  --base main \
  --head fix/cave-a5594-daemon-connection-noise \
  --title "perf(daemon): bound connection polling and request noise" \
  --body-file /tmp/cave-a5594-pr-body.md
```

The PR body must include Summary, Before/After evidence, Tests, Bead
`cave-a5594`, and the upstream daemon non-goal. Do not include AI attribution.

- [ ] **Step 9: Wait for required checks and resolve review threads**

Required checks are:

- Frontend build
- Rust check
- E2E (Playwright)
- Cross-environment required
- Sidecar runtime required

Read every review thread, fix real findings, reply with the fixing commit, and
resolve the thread. Do not use `--admin`.

- [ ] **Step 10: Squash-merge with an explicit clean message**

Run:

```bash
PR_NUMBER="$(gh pr view --json number --jq .number)"
gh pr merge "$PR_NUMBER" --squash --delete-branch \
  --subject "perf(daemon): bound connection polling and request noise" \
  --body "Fixes cave-a5594."
```

The squash message must not contain AI attribution.

- [ ] **Step 11: Reconcile clean main and retire the worktree**

From the primary checkout:

```bash
git fetch origin main
git pull --ff-only origin main
pnpm beads:worktrees
git worktree remove .worktrees/cave-a5594-daemon-connection-noise
git branch -D fix/cave-a5594-daemon-connection-noise
git worktree list
git status --short
```

Close `cave-a5594` only after verifying the merged commit is on `origin/main`
and the acceptance criteria are satisfied.
