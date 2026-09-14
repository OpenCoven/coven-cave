// Device access must not decide whether the server exists (cave-9jt60).
//
// Four release candidates failed with "packaged server did not answer within
// 90000 ms" because server.ts awaited createDeviceAccessStore() at module
// scope, and that initialization hardens four paths through a per-file
// PowerShell ACL probe on Windows. What is pinned here is the trade that
// replaced it: the server boots, and the FEATURE fails closed.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import { deferDeviceAccessStore } from "./deferred.ts";
import { DeviceAccessError, type DeviceAccessStore } from "./store.ts";

const never = <T,>(): Promise<T> => new Promise<T>(() => {});

function fakeStore(overrides: Partial<DeviceAccessStore> = {}): DeviceAccessStore {
  return {
    policy: async () => ({ enabled: true, allowedTailnets: ["tail"] }),
    snapshot: async () => ({}) as never,
    setAllowedTailnets: async () => {},
    request: async () => ({}) as never,
    inspect: async () => null,
    verify: async () => null,
    decide: async () => ({}) as never,
    recordAccess: async () => {},
    close: () => {},
    ...overrides,
  };
}

test("initialization does not block the caller", async () => {
  // The whole point: a store that never finishes initializing must not stop
  // the surrounding module from finishing its own evaluation.
  let returned = false;
  const deferred = deferDeviceAccessStore(() => never<DeviceAccessStore>(), { warn: () => {} });
  returned = true;
  assert.equal(returned, true, "deferDeviceAccessStore returned without awaiting init");
  assert.ok(deferred.store, "a usable store handle exists immediately");
  assert.equal(deferred.failure(), null, "nothing has failed yet");
});

test("a request that arrives mid-initialization gets the real answer", async () => {
  let release: (store: DeviceAccessStore) => void = () => {};
  const pending = new Promise<DeviceAccessStore>((resolve) => {
    release = resolve;
  });
  const { store } = deferDeviceAccessStore(() => pending, { warn: () => {} });

  const inFlight = store.policy();
  release(fakeStore());
  assert.deepEqual(await inFlight, { enabled: true, allowedTailnets: ["tail"] });
});

test("when initialization fails, anything that could grant access refuses", async () => {
  const warnings: string[] = [];
  const { store, settled } = deferDeviceAccessStore(
    () => Promise.reject(new Error("ACL probe timed out")),
    { warn: (message) => warnings.push(message) },
  );
  await settled;

  const peer = { nodeId: "n1" } as never;
  const granting: Array<[string, () => Promise<unknown>]> = [
    ["snapshot", () => store.snapshot()],
    ["setAllowedTailnets", () => store.setAllowedTailnets([], "actor")],
    ["request", () => store.request(peer, { installationId: "i", label: "l" })],
    ["inspect", () => store.inspect("c", peer)],
    ["verify", () => store.verify("c", peer)],
    ["decide", () => store.decide("id", "allowed", "actor")],
    ["recordAccess", () => store.recordAccess("d", { requestId: "r", method: "GET", path: "/", status: 200 })],
  ];
  for (const [name, call] of granting) {
    await assert.rejects(call, {
      name: "DeviceAccessError",
      code: "unavailable",
      status: 503,
      message: /Device access is unavailable/,
    }, `${name} refuses`);
  }
  // …and the reason travels with the refusal, so the log and the response agree.
  await assert.rejects(() => store.verify("c", peer), /ACL probe timed out/);
});

test("verify refuses rather than returning null when the store never opened", async () => {
  // `verify` returning null means "that credential is not valid". Returning
  // null here would say the same thing about a credential nobody could check,
  // and a caller treating null as a clean negative would be reasoning from an
  // answer the host never gave.
  const { store, settled } = deferDeviceAccessStore(
    () => Promise.reject(new Error("no")),
    { warn: () => {} },
  );
  await settled;
  await assert.rejects(() => store.verify("c", {} as never), /unavailable/);
});

test("the policy read reports UNAVAILABLE, not 'off'", async () => {
  // The original version of this test asserted { enabled: false } and called it
  // fail-closed. That was wrong, and the test is what made it look right: the
  // gateway reads `enabled: false` as "configured off" and runs in LEGACY mode,
  // which passes remote requests through without pairing
  // (gateway.ts, the `if (!policy.enabled)` branch after `if (direct)`).
  // So the old answer turned a failed security check into an open door.
  const { store, settled } = deferDeviceAccessStore(
    () => Promise.reject(new Error("ACL probe timed out")),
    { warn: () => {} },
  );
  await settled;
  assert.deepEqual(await store.policy(), {
    enabled: false,
    allowedTailnets: [],
    unavailable: true,
  });
});

test("a policy read does not wait forever on a stalled initialization", async (t) => {
  // The gateway awaits policy() on EVERY request, before the direct-loopback
  // bypass. An unbounded wait here is the same outage as blocking boot, moved
  // one layer down: the server listens and answers nothing.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { store } = deferDeviceAccessStore(() => never<DeviceAccessStore>(), { warn: () => {} });
  let answered = false;
  const pending = store.policy().then((policy) => {
    answered = true;
    return policy;
  });
  t.mock.timers.tick(4_999);
  await Promise.resolve();
  assert.equal(answered, false, "initialization gets the full five-second window");
  t.mock.timers.tick(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(answered, true, "answers at the five-second bound");
  const policy = await pending;
  assert.equal(policy.unavailable, true, "a pending store refuses rather than hanging");
});

for (const fails of [false, true]) {
  test(`initialization ${fails ? "failure" : "success"} clears the shared policy timer`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const timers = t.mock.method(globalThis, "setTimeout");
    const clears = t.mock.method(globalThis, "clearTimeout");
    let release!: (store: DeviceAccessStore) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<DeviceAccessStore>((resolve, fail) => {
      release = resolve;
      reject = fail;
    });
    const { store } = deferDeviceAccessStore(() => pending, { warn: () => {} });
    const policies = Array.from({ length: 20 }, () => store.policy());
    assert.equal(timers.mock.callCount(), 1, "concurrent reads share one timer");
    if (fails) reject(new Error("no"));
    else release(fakeStore());
    await Promise.all(policies);
    assert.equal(clears.mock.callCount(), 1);
    assert.equal(clears.mock.calls[0].arguments[0], timers.mock.calls[0].result);
    await store.policy();
    assert.equal(timers.mock.callCount(), 1, "settled reads create no timers");
  });
}

test("all deferred operations refuse at the shared bound and recover after initialization", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const timers = t.mock.method(globalThis, "setTimeout");
  let release!: (store: DeviceAccessStore) => void;
  const pending = new Promise<DeviceAccessStore>((resolve) => { release = resolve; });
  const { store, settled } = deferDeviceAccessStore(() => pending, { warn: () => {} });
  const calls = [
    store.snapshot(),
    store.setAllowedTailnets([], "actor"),
    store.request({} as never, { installationId: "i", label: "l" }),
    store.inspect("c", {} as never),
    store.verify("c", {} as never),
    store.decide("id", "allowed", "actor"),
    store.recordAccess("d", { requestId: "r", method: "GET", path: "/", status: 200 }),
  ];
  const refusals = calls.map((call) => assert.rejects(call, (error: unknown) =>
    error instanceof DeviceAccessError && error.code === "unavailable" && error.status === 503));
  t.mock.timers.tick(5_000);
  await Promise.all(refusals);
  assert.equal((await store.policy()).unavailable, true);
  await assert.rejects(store.snapshot(), { code: "unavailable", status: 503 });
  assert.equal(timers.mock.callCount(), 1, "timed-out reads reuse the elapsed bound");
  release(fakeStore());
  await settled;
  assert.deepEqual(await store.policy(), { enabled: true, allowedTailnets: ["tail"] });
  assert.deepEqual(await store.snapshot(), {});
});

test("the failure is reported once, in full, and names the consequence", async () => {
  const warnings: string[] = [];
  const { settled } = deferDeviceAccessStore(
    () => Promise.reject(new Error("ACL probe timed out")),
    { warn: (message) => warnings.push(message) },
  );
  await settled;
  assert.equal(warnings.length, 1, "said once, not per request");
  assert.match(warnings[0], /the server is running and device access is refused/);
  assert.match(warnings[0], /Pairing, approvals and device credentials will not work/);
  assert.match(warnings[0], /ACL probe timed out/, "and carries the underlying cause");
});

test("close is safe when nothing ever opened, and closes what did", async () => {
  const dead = deferDeviceAccessStore(() => Promise.reject(new Error("no")), { warn: () => {} });
  await dead.settled;
  assert.doesNotThrow(() => dead.store.close());

  let closed = false;
  const live = deferDeviceAccessStore(
    async () => fakeStore({ close: () => { closed = true; } }),
    { warn: () => {} },
  );
  await live.settled;
  live.store.close();
  assert.equal(closed, true);
});

test("server.ts no longer blocks boot on device access", () => {
  const server = readFileSync(new URL("../../../../server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(
    server,
    /const deviceAccessStore = await createDeviceAccessStore\(\)/,
    "the module-scope await that stalled boot is gone",
  );
  assert.match(server, /deferDeviceAccessStore\(/, "boot goes through the deferred wrapper");

  // server.mjs is the built artifact the packaged sidecar actually runs, and it
  // is committed. A source fix that never reached it would fix nothing.
  const built = readFileSync(new URL("../../../../server.mjs", import.meta.url), "utf8");
  assert.match(built, /deferDeviceAccessStore/, "the built server carries the fix");
  assert.doesNotMatch(built, /await createDeviceAccessStore\(\)/, "and not the blocking await");
});

console.log("deferred.test.ts OK");
