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
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { setImmediate } from "node:timers/promises";

import { deferDeviceAccessStore } from "./deferred.ts";
import { createDeviceAccessGateway } from "./gateway.ts";
import type { DeviceAccessStore } from "./store.ts";
import { DEVICE_GRANT_HEADER, DEVICE_MANAGED_HEADER, DEVICE_PAIRING_PAGE_HEADER } from "../../device-access-markers.ts";

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
    ["policy", () => store.policy()],
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

test("unavailable policy is not disabled enforcement", async () => {
  const { store, settled } = deferDeviceAccessStore(
    () => Promise.reject(new Error("ACL probe timed out")),
    { warn: () => {} },
  );
  await settled;
  await assert.rejects(store.policy(), { code: "unavailable", status: 503 });
});

for (const outcome of ["failed", "legacy", "managed"] as const) {
  test(`pending initialization gates remote requests, then settles ${outcome}`, async (t) => {
    const initialization = Promise.withResolvers<DeviceAccessStore>();
    const deferred = deferDeviceAccessStore(() => initialization.promise, { warn: () => {} });
    const gateway = createDeviceAccessGateway({
      store: deferred.store,
      inventory: async () => ({ host: "desktop.example.ts.net", tailnet: "example.ts.net", peers: new Map() }),
      isDirectLoopback: (req) => req.headers.host === "localhost" && !req.headers["x-forwarded-for"],
      sidecarToken: "synthetic-desktop", packaged: true, stampSecret: "synthetic-stamp",
    });
    t.after(() => gateway.close());
    const request = (local: boolean, path = "/api/github/comments") => {
      const req = new IncomingMessage(new Socket());
      req.method = "GET";
      req.url = path;
      req.headers = {
        host: local ? "localhost" : "desktop.example.ts.net",
        ...(local ? {} : { "x-forwarded-for": "100.64.0.2" }),
        [DEVICE_GRANT_HEADER]: "forged",
        [DEVICE_MANAGED_HEADER]: "forged",
        [DEVICE_PAIRING_PAGE_HEADER]: "forged",
      };
      return req;
    };
    const local = request(true);
    const localResult = gateway.handle(local, new ServerResponse(local));
    let localHandled: boolean | undefined;
    void localResult.then((handled) => { localHandled = handled; });
    const remote = request(false);
    const response = new ServerResponse(remote);
    let remoteHandled: boolean | undefined;
    const remoteResult = gateway.handle(remote, response).then((handled) => { remoteHandled = handled; });
    const handoff = request(true, "/api/mobile-handoff");
    const handoffResponse = new ServerResponse(handoff);
    let handoffHandled: boolean | undefined;
    const handoffResult = gateway.handle(handoff, handoffResponse).then((handled) => { handoffHandled = handled; });
    const upgradeResult = gateway.blocksUpgrade(request(false)).then(
      (blocked) => ({ blocked, error: null }),
      (error: unknown) => ({ blocked: true, error }),
    );
    let upgradeSettled = false;
    void upgradeResult.then(() => { upgradeSettled = true; });
    await setImmediate();
    assert.equal(remoteHandled, undefined, "pending policy cannot admit remote HTTP");
    assert.equal(upgradeSettled, false, "pending policy cannot admit remote upgrades");
    assert.equal(handoffHandled, undefined, "local invite issuance also needs a loaded policy");
    const localWhilePending = localHandled;
    // Settle before assertions about local availability so a RED failure leaves no pending requests.
    if (outcome === "failed") initialization.reject(new Error("synthetic ACL failure"));
    else initialization.resolve(fakeStore({
      policy: async () => ({ enabled: outcome === "managed", allowedTailnets: [] }),
    }));
    await deferred.settled;
    await remoteResult;
    await handoffResult;
    const upgrade = await upgradeResult;
    assert.equal(localWhilePending, false, "local application requests must not wait for device initialization");
    for (const marker of [DEVICE_GRANT_HEADER, DEVICE_MANAGED_HEADER, DEVICE_PAIRING_PAGE_HEADER]) {
      assert.equal(local.headers[marker], undefined, "local fast path still strips forged markers");
    }
    assert.equal(await gateway.blocksUpgrade(request(true)), false, "local upgrades remain independent");
    assert.equal(remoteHandled, outcome !== "legacy");
    assert.equal(upgrade.blocked, outcome !== "legacy");
    assert.equal(handoffHandled, outcome === "failed");
    assert.equal(handoff.headers[DEVICE_MANAGED_HEADER], outcome === "managed" ? "synthetic-stamp" : undefined);
    if (outcome === "failed") {
      assert.equal(handoffResponse.statusCode, 503);
      assert.equal(response.statusCode, 503);
      assert.ok(upgrade.error instanceof Error);
      await assert.rejects(deferred.store.policy(), /synthetic ACL failure/, "failure remains permanent");
      const admin = request(true, "/api/device-access/admin");
      const adminResponse = new ServerResponse(admin);
      assert.equal(await gateway.handle(admin, adminResponse), true);
      assert.equal(adminResponse.statusCode, 503, "local management must report unavailability");
    }
  });
}

test("the failure is reported once, in full, and names the consequence", async () => {
  const warnings: string[] = [];
  const { settled } = deferDeviceAccessStore(
    () => Promise.reject(new Error("ACL probe timed out")),
    { warn: (message) => warnings.push(message) },
  );
  await settled;
  assert.equal(warnings.length, 1, "said once, not per request");
  assert.match(warnings[0], /the server is running and device access is refused/);
  assert.match(warnings[0], /Remote access, pairing, approvals and device credentials will not work/);
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
  for (const source of [server, built]) {
    assert.match(source,
      /server\.on\("upgrade", async \(req, socket, head\) => \{\s*try \{[\s\S]*?await deviceAccess\.blocksUpgrade\(req\)[\s\S]*?\} catch \(error\) \{\s*console\.error\("\[device-access\] Upgrade refused:", error\);\s*socket\.destroy\(\);\s*return;\s*\}/,
      "source and packaged server both destroy failed-policy upgrades before routing");
  }
});

console.log("deferred.test.ts OK");
