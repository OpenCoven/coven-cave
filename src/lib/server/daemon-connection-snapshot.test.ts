import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { CaveConfig } from "../cave-config.ts";
import { daemonTargetForConfig, type DaemonResponse, type DaemonTarget } from "../coven-daemon.ts";
import { daemonHealthRequest } from "./daemon-health-request.ts";
import {
  createDaemonConnectionSnapshotBroker,
  daemonConnectionTargetKey,
  daemonConnectionTargetSummary,
  type DaemonConnectionSnapshot,
} from "./daemon-connection-snapshot.ts";

const source = await readFile(new URL("./daemon-connection-snapshot.ts", import.meta.url), "utf8");

type SnapshotConfig = Pick<CaveConfig, "multiHost">;
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

function localConfig(): SnapshotConfig {
  return { multiHost: { mode: "local", hubUrl: "", executorUrls: [] } };
}

function hubConfig(hubUrl = "server.tailnet:8787"): SnapshotConfig {
  return { multiHost: { mode: "hub", hubUrl, executorUrls: [] } };
}

function onlineResponse(status = 200): DaemonResponse<unknown> {
  return { ok: true, status, data: { ok: true } };
}

function offlineResponse(): DaemonResponse<unknown> {
  return { ok: false, status: 0, data: null, error: "daemon offline" };
}

function hubUnauthorizedResponse(): DaemonResponse<unknown> {
  return { ok: false, status: 401, data: null, error: "unauthorized" };
}

function hubUnhealthyResponse(): DaemonResponse<unknown> {
  return { ok: false, status: 503, data: null, error: "maintenance" };
}

function hubUnreachableResponse(): DaemonResponse<unknown> {
  return { ok: false, status: 0, data: null, error: "daemon timeout" };
}

function expectedSnapshot(
  target: DaemonTarget,
  checkedAt: string,
  fields: Pick<DaemonConnectionSnapshot, "running" | "availability"> & { reason?: string },
): DaemonConnectionSnapshot {
  return {
    running: fields.running,
    availability: fields.availability,
    checkedAt,
    target: daemonConnectionTargetSummary(target),
    ...(fields.reason ? { reason: fields.reason } : {}),
  };
}

test("concurrent ordinary reads share exactly one probe", async () => {
  const pending = deferred<DaemonResponse<unknown>>();
  let calls = 0;
  let now = 1_000;
  const broker = createDaemonConnectionSnapshotBroker({
    loadConfig: async () => localConfig(),
    callTarget: async () => {
      calls += 1;
      return pending.promise;
    },
    now: () => now,
  });

  const first = broker.read();
  const second = broker.read();
  const third = broker.read();
  await flushMicrotasks();
  assert.equal(calls, 1);

  const target = daemonTargetForConfig(localConfig());
  pending.resolve(onlineResponse());
  const [a, b, c] = await Promise.all([first, second, third]);
  const expected = expectedSnapshot(target, new Date(now).toISOString(), {
    running: true,
    availability: "online",
  });
  assert.deepEqual(a, expected);
  assert.deepEqual(b, expected);
  assert.deepEqual(c, expected);
});

test("cache reuses values before ttl and reprobes at and after ttl", async () => {
  const pending = deferred<DaemonResponse<unknown>>();
  let now = 10_000;
  let calls = 0;
  const broker = createDaemonConnectionSnapshotBroker({
    loadConfig: async () => localConfig(),
    callTarget: async () => {
      calls += 1;
      return calls === 1 ? pending.promise : onlineResponse();
    },
    now: () => now,
  });

  const target = daemonTargetForConfig(localConfig());
  const firstRead = broker.read();
  await flushMicrotasks();
  now = 10_500;
  pending.resolve(onlineResponse());
  const first = await firstRead;
  assert.deepEqual(first, expectedSnapshot(target, new Date(now).toISOString(), {
    running: true,
    availability: "online",
  }));
  assert.equal(calls, 1);

  now = 11_499;
  const cached = await broker.read();
  assert.equal(calls, 1);
  assert.deepEqual(cached, first);

  now = 11_500;
  const refreshedAtTtl = await broker.read();
  assert.equal(calls, 2);
  assert.deepEqual(refreshedAtTtl, expectedSnapshot(target, new Date(now).toISOString(), {
    running: true,
    availability: "online",
  }));

  now = 12_501;
  await broker.read();
  assert.equal(calls, 3);
});

test("cache entries stay separated when the resolved target changes", async () => {
  let config = localConfig();
  let calls = 0;
  let now = 20_000;
  const seenKeys: string[] = [];
  const broker = createDaemonConnectionSnapshotBroker({
    loadConfig: async () => config,
    callTarget: async (target) => {
      calls += 1;
      seenKeys.push(daemonConnectionTargetKey(target));
      return onlineResponse();
    },
    now: () => now,
  });

  const localTarget = daemonTargetForConfig(localConfig());
  const hubTarget = daemonTargetForConfig(hubConfig());

  const localSnapshot = await broker.read();
  assert.deepEqual(localSnapshot, expectedSnapshot(localTarget, new Date(now).toISOString(), {
    running: true,
    availability: "online",
  }));

  now = 20_100;
  config = hubConfig();
  const hubSnapshot = await broker.read();
  assert.deepEqual(hubSnapshot, expectedSnapshot(hubTarget, new Date(now).toISOString(), {
    running: true,
    availability: "online",
  }));
  assert.equal(calls, 2);

  now = 20_200;
  config = localConfig();
  const localCachedAgain = await broker.read();
  assert.deepEqual(localCachedAgain, localSnapshot);
  assert.equal(calls, 2);
  assert.deepEqual(seenKeys, [
    daemonConnectionTargetKey(localTarget),
    daemonConnectionTargetKey(hubTarget),
  ]);
});

test("fresh reads bypass a live cached value", async () => {
  let now = 30_000;
  let calls = 0;
  const broker = createDaemonConnectionSnapshotBroker({
    loadConfig: async () => localConfig(),
    callTarget: async () => {
      calls += 1;
      return onlineResponse();
    },
    now: () => now,
  });

  const first = await broker.read();
  now = 30_050;
  const fresh = await broker.read({ fresh: true });
  assert.equal(calls, 2);
  assert.notDeepEqual(fresh, first);
  assert.equal(fresh.checkedAt, new Date(now).toISOString());
});

test("fresh probes outrank older pending work and older completion never overwrites the cache", async () => {
  const older = deferred<DaemonResponse<unknown>>();
  const newer = deferred<DaemonResponse<unknown>>();
  let calls = 0;
  let now = 40_000;
  const broker = createDaemonConnectionSnapshotBroker({
    loadConfig: async () => localConfig(),
    callTarget: async () => {
      calls += 1;
      return calls === 1 ? older.promise : newer.promise;
    },
    now: () => now,
  });

  const oldRead = broker.read();
  await flushMicrotasks();
  assert.equal(calls, 1);

  now = 40_100;
  const freshRead = broker.read({ fresh: true });
  await flushMicrotasks();
  assert.equal(calls, 2);

  const target = daemonTargetForConfig(localConfig());
  newer.resolve(onlineResponse());
  const freshSnapshot = await freshRead;
  assert.deepEqual(freshSnapshot, expectedSnapshot(target, new Date(now).toISOString(), {
    running: true,
    availability: "online",
  }));

  now = 40_200;
  older.resolve(offlineResponse());
  const oldSnapshot = await oldRead;
  assert.deepEqual(oldSnapshot, expectedSnapshot(target, new Date(now).toISOString(), {
    running: false,
    availability: "offline",
    reason: "daemon offline",
  }));

  now = 40_250;
  const cached = await broker.read();
  assert.deepEqual(cached, freshSnapshot);
});

test("clear while pending prevents the older completion from repopulating cache", async () => {
  const pending = deferred<DaemonResponse<unknown>>();
  let calls = 0;
  let now = 50_000;
  const broker = createDaemonConnectionSnapshotBroker({
    loadConfig: async () => localConfig(),
    callTarget: async () => {
      calls += 1;
      return calls === 1 ? pending.promise : onlineResponse();
    },
    now: () => now,
  });

  const staleRead = broker.read();
  await flushMicrotasks();
  assert.equal(calls, 1);

  broker.clear();
  pending.resolve(offlineResponse());
  await staleRead;

  now = 50_010;
  const target = daemonTargetForConfig(localConfig());
  const freshAfterClear = await broker.read();
  assert.equal(calls, 2);
  assert.deepEqual(freshAfterClear, expectedSnapshot(target, new Date(now).toISOString(), {
    running: true,
    availability: "online",
  }));
});

test("connection snapshot broker imports and uses the shared daemon health request contract", () => {
  assert.match(
    source,
    /import \{[^}]*daemonHealthRequest[^}]*\} from "\.\/daemon-health-request\.ts";/,
    "the snapshot broker should import the shared daemon health request helper",
  );
  assert.match(
    source,
    /dependencies\.callTarget\(target, daemonHealthRequest\(\)\)/,
    "the snapshot broker should call the daemon with the shared health request contract",
  );
});

test("configured targets use the exact shared health request contract", async () => {
  const seenRequests: unknown[] = [];
  const broker = createDaemonConnectionSnapshotBroker({
    loadConfig: async () => hubConfig(),
    callTarget: async (_target, request) => {
      seenRequests.push(request);
      return onlineResponse();
    },
    now: () => 60_000,
  });

  await broker.read();
  assert.deepEqual(seenRequests, [daemonHealthRequest()]);
});

test("classifies local and hub outcomes without extra daemon side effects", async () => {
  let now = 70_000;
  let unconfiguredCalls = 0;
  const unconfiguredBroker = createDaemonConnectionSnapshotBroker({
    loadConfig: async () => hubConfig(""),
    callTarget: async () => {
      unconfiguredCalls += 1;
      return onlineResponse();
    },
    now: () => now,
  });
  const unconfiguredTarget = daemonTargetForConfig(hubConfig(""));
  assert.deepEqual(
    await unconfiguredBroker.read(),
    expectedSnapshot(unconfiguredTarget, new Date(now).toISOString(), {
      running: false,
      availability: "misconfigured",
      reason: "server hub URL is not configured",
    }),
  );
  assert.equal(unconfiguredCalls, 0);

  const cases: Array<{
    name: string;
    config: SnapshotConfig;
    response: DaemonResponse<unknown>;
    expected: Omit<DaemonConnectionSnapshot, "checkedAt" | "target">;
  }> = [
    {
      name: "local online",
      config: localConfig(),
      response: onlineResponse(),
      expected: { running: true, availability: "online" },
    },
    {
      name: "local offline",
      config: localConfig(),
      response: offlineResponse(),
      expected: { running: false, availability: "offline", reason: "daemon offline" },
    },
    {
      name: "hub unauthorized",
      config: hubConfig(),
      response: hubUnauthorizedResponse(),
      expected: { running: false, availability: "unauthorized", reason: "hub unauthorized: unauthorized" },
    },
    {
      name: "hub unhealthy",
      config: hubConfig(),
      response: hubUnhealthyResponse(),
      expected: { running: false, availability: "unhealthy", reason: "hub unhealthy: maintenance" },
    },
    {
      name: "hub unreachable",
      config: hubConfig(),
      response: hubUnreachableResponse(),
      expected: { running: false, availability: "unreachable", reason: "hub unreachable: daemon timeout" },
    },
  ];

  for (const scenario of cases) {
    now += 100;
    const broker = createDaemonConnectionSnapshotBroker({
      loadConfig: async () => scenario.config,
      callTarget: async () => scenario.response,
      now: () => now,
    });
    const target = daemonTargetForConfig(scenario.config);
    assert.deepEqual(
      await broker.read(),
      expectedSnapshot(target, new Date(now).toISOString(), scenario.expected),
      scenario.name,
    );
  }
});

test("target keys and summaries never expose hub access tokens", () => {
  const target = daemonTargetForConfig(hubConfig(
    "https://cave.tailnet.example.ts.net/?coven_access_token=v1.secret-token&other=1",
  ));
  if (target.mode !== "hub") {
    assert.fail(`expected a hub target, received ${target.mode}`);
  }

  const summary = daemonConnectionTargetSummary(target);
  const key = daemonConnectionTargetKey(target);
  const serializedSummary = JSON.stringify(summary);

  if (summary.mode !== "hub") {
    assert.fail(`expected a hub summary, received ${summary.mode}`);
  }
  assert.equal(summary.url, "https://cave.tailnet.example.ts.net");
  assert.doesNotMatch(serializedSummary, /secret-token|coven_access_token/);
  assert.doesNotMatch(key, /secret-token|coven_access_token/);
});

test("target keys and summaries redact hub URL credentials while preserving target identity", () => {
  const target = daemonTargetForConfig(hubConfig(
    "https://witch:forest-secret@cave.tailnet.example.ts.net:8787/daemon/health",
  ));
  if (target.mode !== "hub") {
    assert.fail(`expected a hub target, received ${target.mode}`);
  }

  const summary = daemonConnectionTargetSummary(target);
  const key = daemonConnectionTargetKey(target);
  const serializedSummary = JSON.stringify(summary);
  const expectedUrl = "https://cave.tailnet.example.ts.net:8787/daemon/health";

  if (summary.mode !== "hub") {
    assert.fail(`expected a hub summary, received ${summary.mode}`);
  }
  assert.equal(summary.url, expectedUrl);
  assert.equal(key, `hub:${expectedUrl}`);
  assert.equal(new URL(summary.url).username, "");
  assert.equal(new URL(summary.url).password, "");
  assert.doesNotMatch(serializedSummary, /witch|forest-secret|@/);
  assert.doesNotMatch(key, /witch|forest-secret|@/);
});

test("config load rejection propagates without probing the daemon", async () => {
  const expected = new Error("config unavailable");
  let calls = 0;
  const broker = createDaemonConnectionSnapshotBroker({
    loadConfig: async () => {
      throw expected;
    },
    callTarget: async () => {
      calls += 1;
      return onlineResponse();
    },
    now: () => 80_000,
  });

  await assert.rejects(broker.read(), expected);
  assert.equal(calls, 0);
});

test("unexpected probe rejections are rethrown and do not seed the cache", async () => {
  const expected = new Error("boom");
  let calls = 0;
  const broker = createDaemonConnectionSnapshotBroker({
    loadConfig: async () => localConfig(),
    callTarget: async () => {
      calls += 1;
      if (calls === 1) throw expected;
      return onlineResponse();
    },
    now: () => 90_000 + calls,
  });

  await assert.rejects(broker.read(), expected);
  const recovered = await broker.read();
  assert.equal(calls, 2);
  assert.equal(recovered.availability, "online");
});

console.log("daemon-connection-snapshot.test.ts: ok");
