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
import type { DeviceAccessStore } from "./store.ts";

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
    await assert.rejects(call, /Device access is unavailable/, `${name} refuses`);
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

test("a policy read does not wait forever on a stalled initialization", async () => {
  // The gateway awaits policy() on EVERY request, before the direct-loopback
  // bypass. An unbounded wait here is the same outage as blocking boot, moved
  // one layer down: the server listens and answers nothing.
  const { store } = deferDeviceAccessStore(() => never<DeviceAccessStore>(), { warn: () => {} });
  const started = Date.now();
  const policy = await store.policy();
  assert.equal(policy.unavailable, true, "a pending store refuses rather than hanging");
  assert.ok(Date.now() - started < 30_000, "and answers within the bound");
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
