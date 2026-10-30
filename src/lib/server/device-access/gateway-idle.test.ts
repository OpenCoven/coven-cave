// The revalidation tick exists to act on connections that are already open
// (#6119 second measured-cost cut). New requests and upgrades read the policy
// themselves, so with nothing live the tick has nothing to do and must not run.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, mock, test } from "node:test";
import { createDeviceAccessGateway } from "./gateway.ts";
import { DeviceAccessInitializationError, type DeviceAccessStore } from "./store.ts";

let policy: { enabled: boolean; allowedTailnets: string[] } | Error = { enabled: false, allowedTailnets: [] };
let reads = 0;

function stubStore(): DeviceAccessStore {
  return {
    async policy() {
      reads += 1;
      if (policy instanceof Error) throw policy;
      return policy;
    },
  } as unknown as DeviceAccessStore;
}

function gateway(onPolicyChanged = () => {}) {
  return createDeviceAccessGateway({
    store: stubStore(),
    inventory: async () => { throw new Error("no inventory in this fixture"); },
    isDirectLoopback: () => false,
    sidecarToken: "test-desktop-secret",
    packaged: true,
    stampSecret: "test-internal-stamp",
    onPolicyChanged,
  });
}

/** A remote response the gateway records as legacy while managed access is off. */
function remoteResponse() {
  const emitter = new EventEmitter();
  const res = Object.assign(emitter, {
    destroyed: false,
    destroy() { res.destroyed = true; emitter.emit("close"); },
  });
  const req = { headers: {}, url: "/", method: "GET" };
  return { req: req as unknown as IncomingMessage, res: res as unknown as ServerResponse & { destroyed: boolean } };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Advance one second at a time: the gateway skips a tick while one is in flight. */
async function seconds(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    mock.timers.tick(1_000);
    await settle();
  }
}

beforeEach(() => {
  policy = { enabled: false, allowedTailnets: [] };
  reads = 0;
  mock.timers.enable({ apis: ["setInterval"] });
});
afterEach(() => mock.timers.reset());

test("an idle gateway reads no policy and owns no running tick", async () => {
  const subject = gateway();
  await seconds(10);
  assert.equal(reads, 0, "nothing is live, so nothing is revalidated");
  await subject.close();
});

test("a remote WebSocket hold runs the tick, and releasing the last hold stops it", async () => {
  const subject = gateway();
  const release = subject.holdRemoteConnection();
  await seconds(3);
  assert.equal(reads, 3, "one policy read per second while a remote client is live");
  release();
  release();
  await seconds(5);
  assert.equal(reads, 3, "the tick stops with the last hold; a repeated release is harmless");
  await subject.close();
});

test("switching managed access on terminates held remote WebSockets within one tick", async () => {
  let changed = 0;
  const subject = gateway(() => { changed += 1; });
  const release = subject.holdRemoteConnection();
  await seconds(1);
  assert.equal(changed, 0);
  policy = { enabled: true, allowedTailnets: [] };
  await seconds(1);
  assert.equal(changed, 1, "onPolicyChanged reaches remote PTY and event clients");
  release();
  await subject.close();
});

test("a legacy remote response keeps the tick alive until it closes, and a policy flip closes it", async () => {
  const subject = gateway();
  const first = remoteResponse();
  assert.equal(await subject.handle(first.req, first.res), false, "legacy remote traffic passes through");
  const afterHandle = reads;
  await seconds(2);
  assert.equal(reads - afterHandle, 2, "the open legacy response is revalidated");
  first.res.destroy();
  await seconds(3);
  assert.equal(reads - afterHandle, 2, "no tick after the legacy response closed");

  const second = remoteResponse();
  await subject.handle(second.req, second.res);
  policy = { enabled: true, allowedTailnets: [] };
  await seconds(1);
  assert.equal(second.res.destroyed, true, "managed access closes legacy remote responses within one tick");
  await subject.close();
});

test("an unreadable policy closes everything, and an initialization failure never restarts the tick", async () => {
  let changed = 0;
  const subject = gateway(() => { changed += 1; });
  const legacy = remoteResponse();
  await subject.handle(legacy.req, legacy.res);
  const release = subject.holdRemoteConnection();
  policy = new DeviceAccessInitializationError("store hardening failed");
  await seconds(1);
  assert.equal(legacy.res.destroyed, true, "fail closed");
  assert.ok(changed >= 1, "remote WebSockets are terminated too");
  const afterFailure = reads;
  release();
  const again = subject.holdRemoteConnection();
  await seconds(5);
  assert.equal(reads, afterFailure, "a permanently failed store is not polled again");
  again();
  await subject.close();
});

test("close() stops a running tick", async () => {
  const subject = gateway();
  subject.holdRemoteConnection();
  await subject.close();
  await seconds(5);
  assert.equal(reads, 0);
});
