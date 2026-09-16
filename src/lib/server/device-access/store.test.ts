import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { DEVICE_CREDENTIAL_PREFIX, type DevicePeer } from "./contract.ts";
import { createDeviceAccessStore, DeviceAccessError, type DeviceAccessStore } from "./store.ts";

const execFileAsync = promisify(execFile);
const fixtureParent = fileURLToPath(new URL("../../../../.tmp/", import.meta.url));
const storeUrl = new URL("./store.ts", import.meta.url).href;
const initialTime = 1_800_000_000_000;
const peer: DevicePeer = {
  tailnet: "test-tailnet.ts.net",
  nodeId: "node-one",
  userId: "user-one",
  loginName: "reader@example.test",
  deviceName: "phone",
};
const input = { installationId: "browser-one", label: "My phone" };

async function fixture(t: TestContext) {
  const root = join(fixtureParent, `device-access-${randomUUID()}`);
  await mkdir(root, { recursive: true, mode: 0o700 });
  let at = initialTime;
  const stores = new Set<DeviceAccessStore>();
  t.after(async () => {
    for (const store of stores) store.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    file: join(root, "device-access.sqlite"),
    now: () => at,
    advance: (ms: number) => { at += ms; },
    open: async () => {
      const store = await createDeviceAccessStore({ root, now: () => at });
      stores.add(store);
      return store;
    },
    close: (store: DeviceAccessStore) => {
      store.close();
      stores.delete(store);
    },
  };
}

function errorIs(code: string, status: number) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof DeviceAccessError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  };
}

test("DeviceAccessError accepts an explicit gateway HTTP status while preserving store defaults", () => {
  const error = new DeviceAccessError("invalid_request", "Expected application/json.", 415);
  assert.equal(error.code, "invalid_request");
  assert.equal(error.status, 415);
  assert.equal(error.message, "Expected application/json.");
  assert.equal(new DeviceAccessError("forbidden", "Denied").status, 403);
});

test("a new store denies every tailnet and contains no grants or policy", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  assert.deepEqual(await store.snapshot(), { enabled: false, allowedTailnets: [], devices: [], events: [] });
  await assert.rejects(store.request(peer, input), errorIs("forbidden", 403));
  assert.equal(await store.verify("not-a-credential", peer), null);
  assert.equal((await store.snapshot()).devices.length, 0);
});

test("saving an empty allowlist permanently enables deny-all across connections and reopening", async (t) => {
  const f = await fixture(t);
  const [first, second] = await Promise.all([f.open(), f.open()]);
  assert.equal((await second.snapshot()).enabled, false);
  await first.setAllowedTailnets([], "desktop:owner");
  const enabled = await second.snapshot();
  assert.equal(enabled.enabled, true);
  assert.deepEqual(enabled.allowedTailnets, []);
  assert.equal(enabled.events.find((event) => event.event === "policy.enabled")?.actor, "desktop:owner");
  await assert.rejects(second.request(peer, input), errorIs("forbidden", 403));
  f.close(first);
  f.close(second);
  const reopened = await f.open();
  assert.equal((await reopened.snapshot()).enabled, true);
  await reopened.setAllowedTailnets([], "desktop");
  assert.equal((await reopened.snapshot()).events.filter((event) => event.event === "policy.enabled").length, 1);
});

test("removing the last tailnet remains enabled and never revives existing credentials", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.setAllowedTailnets([peer.tailnet], "desktop");
  const allowed = await store.request(peer, input);
  const pending = await store.request(peer, input);
  await store.decide(allowed.device.id, "allowed", "desktop");
  await store.setAllowedTailnets([], "desktop");
  f.close(store);
  const reopened = await f.open();
  const snapshot = await reopened.snapshot();
  assert.equal(snapshot.enabled, true);
  assert.deepEqual(snapshot.allowedTailnets, []);
  assert.equal((await reopened.inspect(allowed.credential, peer))?.status, "revoked");
  assert.equal((await reopened.inspect(pending.credential, peer))?.status, "denied");
  assert.equal(await reopened.verify(allowed.credential, peer), null);
  await assert.rejects(reopened.request(peer, input), errorIs("forbidden", 403));
});

test("disabled mode refuses pairing even when an out-of-band allowlist entry exists", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  const raw = new DatabaseSync(f.file);
  try {
    raw.prepare("INSERT INTO allowed_tailnets (tailnet) VALUES (?)").run(peer.tailnet);
    assert.equal((await store.snapshot()).enabled, false);
    await assert.rejects(store.request(peer, input), errorIs("forbidden", 403));
    await store.setAllowedTailnets([peer.tailnet], "desktop");
    assert.equal((await store.request(peer, input)).device.status, "pending");
  } finally {
    raw.close();
  }
});

test("failed policy audit rolls back activation rather than silently changing legacy mode", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  const raw = new DatabaseSync(f.file);
  try {
    raw.exec(`
      CREATE TRIGGER fail_policy_audit BEFORE INSERT ON audit WHEN NEW.event = 'policy.updated'
      BEGIN SELECT RAISE(ABORT, 'policy audit unavailable'); END;
    `);
    await assert.rejects(store.setAllowedTailnets([], "desktop"), /policy audit unavailable/);
    assert.deepEqual(await store.snapshot(), { enabled: false, allowedTailnets: [], devices: [], events: [] });
  } finally {
    raw.close();
  }
});

test("missing policy mode fails closed instead of reporting legacy mode", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  const raw = new DatabaseSync(f.file);
  try {
    raw.exec("DELETE FROM policy");
    await assert.rejects(store.policy(), /policy mode is missing or invalid/);
    await assert.rejects(store.snapshot(), /policy mode is missing or invalid/);
    await assert.rejects(store.request(peer, input), /policy mode is missing or invalid/);
    await assert.rejects(store.setAllowedTailnets([], "desktop"), /policy mode is missing or invalid/);
  } finally {
    raw.close();
  }
});

test("policy reads only committed mode and tailnets without blocking a concurrent writer", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  assert.deepEqual(await store.policy(), { enabled: false, allowedTailnets: [] });
  const raw = new DatabaseSync(f.file);
  try {
    raw.exec("BEGIN IMMEDIATE; UPDATE policy SET enabled = 1");
    raw.prepare("INSERT INTO allowed_tailnets (tailnet) VALUES (?)").run(peer.tailnet);
    assert.deepEqual(await store.policy(), { enabled: false, allowedTailnets: [] });
    raw.exec("COMMIT");
    assert.deepEqual(await store.policy(), { enabled: true, allowedTailnets: [peer.tailnet] });
    await store.setAllowedTailnets([], "desktop");
    assert.deepEqual(await store.policy(), { enabled: true, allowedTailnets: [] });
  } finally {
    if (raw.isTransaction) raw.exec("ROLLBACK");
    raw.close();
  }
});

test("policy does not list devices, load audit events, or expire pending requests", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.setAllowedTailnets([peer.tailnet], "desktop");
  await store.request(peer, input);
  f.advance(300_000);
  const raw = new DatabaseSync(f.file);
  try {
    raw.exec("ALTER TABLE devices RENAME TO unavailable_devices; ALTER TABLE audit RENAME TO unavailable_audit");
    assert.deepEqual(await store.policy(), { enabled: true, allowedTailnets: [peer.tailnet] });
    assert.equal(raw.prepare("SELECT status FROM unavailable_devices").get()?.status, "pending");
  } finally {
    raw.close();
  }
});

test("version-one migration preserves explicit empty policy saves and leaves unconfigured stores disabled", async (t) => {
  for (const configured of [false, true]) {
    const f = await fixture(t);
    const store = await f.open();
    if (configured) await store.setAllowedTailnets([], "desktop");
    f.close(store);
    const raw = new DatabaseSync(f.file);
    raw.exec("DROP TABLE policy; DELETE FROM audit WHERE event = 'policy.enabled'; PRAGMA user_version = 1");
    raw.close();
    const reopened = await f.open();
    assert.equal((await reopened.snapshot()).enabled, configured);
    assert.deepEqual((await reopened.snapshot()).allowedTailnets, []);
    await assert.rejects(reopened.request(peer, input), errorIs("forbidden", 403));
  }
});

test("tailnets are canonical exact DNS suffixes, never URLs, wildcards or partial matches", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  for (const invalid of [
    "", "ts.net", "*.test.ts.net", "https://test.ts.net", "test.ts.net/", "test.ts.net:443",
    "test.ts.net.evil.test", ".test.ts.net", "test..ts.net", "-test.ts.net", "test-.ts.net",
    "test_name.ts.net", "test.ts.net.", `${"a".repeat(64)}.ts.net`, "test\n.ts.net",
  ]) {
    await assert.rejects(store.setAllowedTailnets([invalid], "desktop"), errorIs("invalid_request", 400));
  }
  await assert.rejects(store.setAllowedTailnets(null as unknown as string[], "desktop"), errorIs("invalid_request", 400));
  assert.equal((await store.snapshot()).enabled, false);
  await store.setAllowedTailnets([" TEST-TAILNET.TS.NET ", peer.tailnet], "desktop");
  assert.equal((await store.snapshot()).enabled, true);
  assert.deepEqual((await store.snapshot()).allowedTailnets, [peer.tailnet]);
  const requested = await store.request({ ...peer, tailnet: " TEST-TAILNET.TS.NET " }, input);
  assert.equal(requested.device.peer.tailnet, peer.tailnet);
  await assert.rejects(
    store.request({ ...peer, tailnet: `sub.${peer.tailnet}` }, input),
    errorIs("forbidden", 403),
  );
  await assert.rejects(store.request({ ...peer, tailnet: "*.ts.net" }, input), errorIs("invalid_request", 400));
});

test("requests require explicit approval and approved credentials have no lifetime limit", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.setAllowedTailnets([peer.tailnet], "desktop:owner");
  const { device, credential } = await store.request(peer, input);
  assert.equal(device.status, "pending");
  assert.equal(device.pairingExpiresAt, f.now() + 300_000);
  assert.equal(device.decidedAt, null);
  assert.equal(device.decidedBy, null);
  assert.equal(device.lastSeenAt, null);
  assert.equal(device.revokedAt, null);
  assert.match(credential, /^cave-device-v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(await store.verify(credential, peer), null);
  assert.deepEqual(await store.inspect(credential, peer), device);
  const allowed = await store.decide(device.id, "allowed", "desktop:owner");
  assert.equal(allowed.status, "allowed");
  assert.equal(allowed.decidedAt, f.now());
  assert.equal(allowed.decidedBy, "desktop:owner");
  f.advance(20 * 365 * 24 * 60 * 60_000);
  assert.equal((await store.verify(credential, peer))?.status, "allowed");
  assert.equal((await store.inspect(credential, peer))?.status, "allowed");
});

test("denial and revocation are terminal, expose status only to the matching bearer, and cannot resurrect", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.setAllowedTailnets([peer.tailnet], "desktop");
  const denied = await store.request(peer, input);
  await store.decide(denied.device.id, "denied", "desktop");
  assert.equal(await store.verify(denied.credential, peer), null);
  assert.equal((await store.inspect(denied.credential, peer))?.status, "denied");
  for (const decision of ["allowed", "denied", "revoked"] as const) {
    await assert.rejects(store.decide(denied.device.id, decision, "desktop"), errorIs("conflict", 409));
  }
  const allowed = await store.request(peer, { ...input, installationId: "second-browser" });
  await assert.rejects(store.decide(allowed.device.id, "revoked", "desktop"), errorIs("conflict", 409));
  await store.decide(allowed.device.id, "allowed", "desktop");
  await assert.rejects(store.decide(allowed.device.id, "denied", "desktop"), errorIs("conflict", 409));
  f.advance(1000);
  const revoked = await store.decide(allowed.device.id, "revoked", "desktop:revoker");
  assert.equal(revoked.revokedAt, f.now());
  assert.equal(revoked.decidedBy, "desktop:revoker");
  assert.equal(await store.verify(allowed.credential, peer), null);
  assert.equal((await store.inspect(allowed.credential, peer))?.status, "revoked");
  await assert.rejects(store.decide(allowed.device.id, "allowed", "desktop"), errorIs("conflict", 409));
  await assert.rejects(store.decide(randomUUID(), "allowed", "desktop"), errorIs("not_found", 404));
});

test("forged secrets, token substitution, and mismatched peer identities cannot inspect or verify", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.setAllowedTailnets([peer.tailnet, "other.ts.net"], "desktop");
  const first = await store.request(peer, input);
  const second = await store.request(peer, { ...input, installationId: "other-browser" });
  await store.decide(first.device.id, "allowed", "desktop");
  const forged = `${DEVICE_CREDENTIAL_PREFIX}${first.device.id}.${"a".repeat(43)}`;
  const substituted = `${DEVICE_CREDENTIAL_PREFIX}${first.device.id}.${second.credential.split(".").at(-1)}`;
  for (const credential of [forged, substituted, `${first.credential}=`, "bad", ""]) {
    assert.equal(await store.inspect(credential, peer), null);
    assert.equal(await store.verify(credential, peer), null);
  }
  for (const mismatch of [
    { tailnet: "other.ts.net" }, { nodeId: "other-node" }, { userId: "other-user" },
    { tailnet: "*.ts.net" }, { nodeId: "" },
  ]) {
    assert.equal(await store.inspect(first.credential, { ...peer, ...mismatch }), null);
    assert.equal(await store.verify(first.credential, { ...peer, ...mismatch }), null);
  }
  assert.equal((await store.verify(first.credential, {
    ...peer, loginName: "renamed@example.test", deviceName: "Renamed device",
  }))?.id, first.device.id);
  await store.decide(first.device.id, "revoked", "desktop");
  assert.equal(await store.inspect(forged, peer), null);
  assert.equal(await store.inspect(first.credential, { ...peer, nodeId: "other-node" }), null);
});

test("fresh requests never inherit approval, including identical installations and matching display labels", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.setAllowedTailnets([peer.tailnet], "desktop");
  const approved = await store.request(peer, input);
  await store.decide(approved.device.id, "allowed", "desktop");
  const sameInstallation = await store.request(peer, input);
  const otherInstallation = await store.request(peer, { ...input, installationId: "browser-two" });
  const otherNode = await store.request({ ...peer, nodeId: "node-two" }, input);
  for (const requested of [sameInstallation, otherInstallation, otherNode]) {
    assert.equal(requested.device.status, "pending");
    assert.notEqual(requested.credential, approved.credential);
    assert.equal(await store.verify(requested.credential, requested.device.peer), null);
  }
  assert.equal((await store.verify(approved.credential, peer))?.status, "allowed");
});

test("pairing expires inclusively at five minutes, with one durable expiry audit", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.setAllowedTailnets([peer.tailnet], "desktop");
  const request = await store.request(peer, input);
  f.advance(299_999);
  assert.equal((await store.inspect(request.credential, peer))?.status, "pending");
  f.advance(1);
  await assert.rejects(store.decide(request.device.id, "allowed", "desktop"), errorIs("conflict", 409));
  assert.equal((await store.inspect(request.credential, peer))?.status, "expired");
  assert.equal(await store.verify(request.credential, peer), null);
  f.close(store);
  const reopened = await f.open();
  const snapshot = await reopened.snapshot();
  assert.equal(snapshot.devices[0].status, "expired");
  assert.equal(snapshot.devices[0].decidedAt, initialTime + 300_000);
  assert.deepEqual(
    snapshot.events.filter((event) => event.event === "device.expired").map((event) => event.actor),
    ["system:expiry"],
  );
});

test("allowlisting, pending requests, approved credentials, and audit survive reopening", async (t) => {
  const f = await fixture(t);
  const initial = await f.open();
  await initial.setAllowedTailnets([peer.tailnet], "desktop");
  const approved = await initial.request(peer, input);
  const pending = await initial.request(peer, { ...input, installationId: "pending-browser" });
  await initial.decide(approved.device.id, "allowed", "desktop");
  const before = await initial.snapshot();
  f.close(initial);
  const reopened = await f.open();
  assert.deepEqual(await reopened.snapshot(), before);
  assert.equal((await reopened.verify(approved.credential, peer))?.status, "allowed");
  assert.equal((await reopened.inspect(pending.credential, peer))?.status, "pending");
});

test("a stale store instance observes revocation immediately and shares bounded last-seen writes", async (t) => {
  const f = await fixture(t);
  const [first, second] = await Promise.all([f.open(), f.open()]);
  await first.setAllowedTailnets([peer.tailnet], "desktop");
  const requested = await second.request(peer, input);
  await first.decide(requested.device.id, "allowed", "desktop");
  assert.equal((await second.verify(requested.credential, peer))?.lastSeenAt, initialTime);
  f.advance(59_999);
  assert.equal((await first.verify(requested.credential, peer))?.lastSeenAt, initialTime);
  f.advance(1);
  assert.equal((await second.verify(requested.credential, peer))?.lastSeenAt, initialTime + 60_000);
  await first.decide(requested.device.id, "revoked", "desktop");
  assert.equal(await second.verify(requested.credential, peer), null);
  assert.equal((await second.inspect(requested.credential, peer))?.status, "revoked");
});

test("tailnet removal atomically revokes allowed devices and denies pending ones; readding restores nothing", async (t) => {
  const f = await fixture(t);
  const [first, second] = await Promise.all([f.open(), f.open()]);
  const otherPeer = { ...peer, tailnet: "retained.ts.net" };
  await first.setAllowedTailnets([peer.tailnet, otherPeer.tailnet], "desktop");
  const allowed = await second.request(peer, input);
  const pending = await second.request(peer, input);
  const retained = await second.request(otherPeer, input);
  await first.decide(allowed.device.id, "allowed", "desktop");
  await first.decide(retained.device.id, "allowed", "desktop");
  f.advance(1000);
  await first.setAllowedTailnets([otherPeer.tailnet], "desktop:policy");
  assert.equal(await second.verify(allowed.credential, peer), null);
  assert.equal((await second.inspect(allowed.credential, peer))?.status, "revoked");
  assert.equal((await second.inspect(pending.credential, peer))?.status, "denied");
  assert.equal((await second.verify(retained.credential, otherPeer))?.status, "allowed");
  await assert.rejects(second.request(peer, input), errorIs("forbidden", 403));
  await assert.rejects(first.decide(pending.device.id, "allowed", "desktop"), errorIs("conflict", 409));
  const events = (await second.snapshot()).events;
  for (const id of [allowed.device.id, pending.device.id]) {
    const event = events.find((event) => event.deviceId === id && event.actor === "desktop:policy");
    assert.ok(event);
    assert.equal(event.at, f.now());
  }
  await first.setAllowedTailnets([peer.tailnet, otherPeer.tailnet], "desktop");
  assert.equal(await second.verify(allowed.credential, peer), null);
  assert.equal(await second.verify(pending.credential, peer), null);
  assert.equal((await second.request(peer, input)).device.status, "pending");
});

test("five requests per node per ten minutes is shared across connections and survives terminal decisions", async (t) => {
  const f = await fixture(t);
  const [first, second] = await Promise.all([f.open(), f.open()]);
  await first.setAllowedTailnets([peer.tailnet], "desktop");
  for (let i = 0; i < 5; i++) {
    const store = i % 2 ? first : second;
    const requested = await store.request(peer, { ...input, installationId: `browser-${i}` });
    await store.decide(requested.device.id, "denied", "desktop");
  }
  await assert.rejects(first.request(peer, input), errorIs("rate_limited", 429));
  await assert.rejects(second.request({ ...peer, userId: "renamed-user" }, input), errorIs("rate_limited", 429));
  assert.equal((await second.request({ ...peer, nodeId: "another-node" }, input)).device.status, "pending");
  f.advance(599_999);
  await assert.rejects(second.request(peer, input), errorIs("rate_limited", 429));
  f.advance(1);
  assert.equal((await first.request(peer, input)).device.status, "pending");
});

test("independent processes racing the request limit commit exactly five requests and five audits", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.setAllowedTailnets([peer.tailnet], "desktop");
  const worker = `
    import { createDeviceAccessStore, DeviceAccessError } from ${JSON.stringify(storeUrl)};
    const store = await createDeviceAccessStore({
      root: process.env.DEVICE_STORE_TEST_ROOT,
      now: () => Number(process.env.DEVICE_STORE_TEST_NOW),
    });
    try {
      const result = await store.request(JSON.parse(process.env.DEVICE_STORE_TEST_PEER), {
        installationId: process.env.DEVICE_STORE_TEST_INSTALLATION, label: "Phone",
      });
      console.log(JSON.stringify({ id: result.device.id }));
    } catch (error) {
      if (!(error instanceof DeviceAccessError)) throw error;
      console.log(JSON.stringify({ code: error.code }));
    } finally { store.close(); }
  `;
  const results = await Promise.all(Array.from({ length: 10 }, async (_, i) => {
    const result = await execFileAsync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", worker], {
      cwd: fileURLToPath(new URL("../../../../", import.meta.url)),
      env: {
        ...process.env,
        DEVICE_STORE_TEST_ROOT: f.root,
        DEVICE_STORE_TEST_NOW: String(f.now()),
        DEVICE_STORE_TEST_PEER: JSON.stringify(peer),
        DEVICE_STORE_TEST_INSTALLATION: `process-browser-${i}`,
      },
      timeout: 30_000,
    });
    return JSON.parse(result.stdout.trim()) as { id?: string; code?: string };
  }));
  assert.equal(results.filter((result) => result.id).length, 5);
  assert.equal(results.filter((result) => result.code === "rate_limited").length, 5);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.devices.length, 5);
  assert.equal(snapshot.events.filter((event) => event.event === "request.created").length, 5);
});

test("the 64-pending cap is global and expiry frees capacity across connections", async (t) => {
  const f = await fixture(t);
  const [first, second] = await Promise.all([f.open(), f.open()]);
  await first.setAllowedTailnets([peer.tailnet], "desktop");
  for (let i = 0; i < 64; i++) {
    await (i % 2 ? first : second).request({ ...peer, nodeId: `node-${i}` }, input);
  }
  await assert.rejects(second.request({ ...peer, nodeId: "node-65" }, input), errorIs("rate_limited", 429));
  f.advance(300_000);
  assert.equal((await first.request({ ...peer, nodeId: "node-65" }, input)).device.status, "pending");
  assert.equal((await second.snapshot()).devices.filter((device) => device.status === "pending").length, 1);
});

test("competing approvals and denials cannot overwrite one another", async (t) => {
  const f = await fixture(t);
  const [first, second] = await Promise.all([f.open(), f.open()]);
  await first.setAllowedTailnets([peer.tailnet], "desktop");
  const requested = await first.request(peer, input);
  const decisions = await Promise.allSettled([
    first.decide(requested.device.id, "allowed", "desktop:one"),
    second.decide(requested.device.id, "denied", "desktop:two"),
  ]);
  assert.equal(decisions.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = decisions.find((result) => result.status === "rejected");
  assert.ok(rejected?.status === "rejected");
  errorIs("conflict", 409)(rejected.reason);
  assert.equal((await second.snapshot()).events.filter((event) => event.event.startsWith("device.")).length, 1);
});

test("audit failures roll back a decision and policy removal rather than granting unaudited authority", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.setAllowedTailnets([peer.tailnet], "desktop");
  const requested = await store.request(peer, input);
  const raw = new DatabaseSync(f.file);
  try {
    raw.exec(`
      CREATE TRIGGER fail_approval_audit BEFORE INSERT ON audit WHEN NEW.event = 'device.allowed'
      BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;
    `);
    await assert.rejects(store.decide(requested.device.id, "allowed", "desktop"), /audit unavailable/);
    assert.equal((await store.inspect(requested.credential, peer))?.status, "pending");
    assert.equal(await store.verify(requested.credential, peer), null);
    raw.exec("DROP TRIGGER fail_approval_audit");
    await store.decide(requested.device.id, "allowed", "desktop");
    const before = await store.snapshot();
    raw.exec(`
      CREATE TRIGGER fail_revocation_audit BEFORE INSERT ON audit WHEN NEW.event = 'device.revoked'
      BEGIN SELECT RAISE(ABORT, 'revocation audit unavailable'); END;
    `);
    await assert.rejects(store.setAllowedTailnets([], "desktop"), /revocation audit unavailable/);
    assert.deepEqual(await store.snapshot(), before);
    assert.equal((await store.verify(requested.credential, peer))?.status, "allowed");
  } finally {
    raw.close();
  }
});

test("approval rechecks current policy even if a pending record outlives an out-of-band policy edit", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.setAllowedTailnets([peer.tailnet], "desktop");
  const pending = await store.request(peer, input);
  const allowed = await store.request(peer, input);
  await store.decide(allowed.device.id, "allowed", "desktop");
  const raw = new DatabaseSync(f.file);
  try {
    raw.exec("DELETE FROM allowed_tailnets");
    await assert.rejects(store.decide(pending.device.id, "allowed", "desktop"), errorIs("forbidden", 403));
    assert.equal(await store.verify(allowed.credential, peer), null);
    await assert.rejects(store.recordAccess(allowed.device.id, {
      requestId: "removed-tailnet", method: "GET", path: "/api", status: 0,
    }), errorIs("forbidden", 403));
  } finally {
    raw.close();
  }
});

test("an unauditable request leaves no credential or consumed quota behind", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.setAllowedTailnets([peer.tailnet], "desktop");
  const before = await store.snapshot();
  const raw = new DatabaseSync(f.file);
  try {
    raw.exec(`
      CREATE TRIGGER fail_request_audit BEFORE INSERT ON audit WHEN NEW.event = 'request.created'
      BEGIN SELECT RAISE(ABORT, 'request audit unavailable'); END;
    `);
    await assert.rejects(store.request(peer, input), /request audit unavailable/);
    assert.deepEqual(await store.snapshot(), before);
    raw.exec("DROP TRIGGER fail_request_audit");
    for (let i = 0; i < 5; i++) await store.request(peer, input);
    await assert.rejects(store.request(peer, input), errorIs("rate_limited", 429));
  } finally {
    raw.close();
  }
});

test("only hashes are persisted; snapshots never expose hashes or credentials", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.setAllowedTailnets([peer.tailnet], "desktop");
  const requested = await store.request(peer, input);
  await store.decide(requested.device.id, "allowed", "desktop");
  await store.recordAccess(requested.device.id, {
    requestId: "trace-one",
    method: "GET",
    path: `/api/familiars?credential=${requested.credential}#${requested.credential}`,
    status: 200,
  });
  const snapshot = await store.snapshot();
  const serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes(requested.credential));
  assert.ok(!serialized.includes("credentialHash"));
  assert.ok(!serialized.includes(requested.credential.split(".").at(-1)!));
  const event = snapshot.events[0];
  assert.equal(event.deviceId, requested.device.id);
  assert.equal(event.requestId, "trace-one");
  assert.equal(event.path, "/api/familiars");
  assert.equal(event.method, "GET");
  assert.equal(event.status, 200);
  assert.equal(event.actor, `device:${requested.device.id}`);
  const raw = new DatabaseSync(f.file);
  try {
    assert.equal(raw.prepare("SELECT credentialHash FROM devices").get()?.credentialHash,
      createHash("sha256").update(requested.credential).digest("hex"));
  } finally {
    raw.close();
  }
  for (const name of await readdir(f.root)) {
    const bytes = await readFile(join(f.root, name));
    assert.equal(bytes.includes(requested.credential), false);
    assert.equal(bytes.includes(requested.credential.split(".").at(-1)!), false);
  }
});

test("access metadata is validated and query/fragment contents never enter the audit", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.setAllowedTailnets([peer.tailnet], "desktop");
  const requested = await store.request(peer, input);
  const valid = { requestId: "trace-one", method: "GET", path: "/api", status: 403 };
  for (const path of [
    "https://example.test/api", "//example.test/api", "api", "/api\\escape", "/api\nspoof",
    "/api%0aspoof", "/api%zz", `/${requested.credential}`, `/${encodeURIComponent(requested.credential)}`,
  ]) {
    await assert.rejects(store.recordAccess(requested.device.id, { ...valid, path }), errorIs("invalid_request", 400));
  }
  for (const invalid of [
    { requestId: "" }, { requestId: requested.credential }, { method: "get" }, { method: "GET\n" },
    { status: -1 }, { status: 99 }, { status: 600 }, { status: 200.5 },
  ]) {
    await assert.rejects(store.recordAccess(requested.device.id, { ...valid, ...invalid }), errorIs("invalid_request", 400));
  }
  await assert.rejects(store.recordAccess(randomUUID(), valid), errorIs("not_found", 404));
  await store.recordAccess(requested.device.id, { ...valid, path: `/api#secret?token=${requested.credential}` });
  assert.equal((await store.snapshot()).events[0].path, "/api");
});

test("admission status zero is durable, correlated with the final response, and rechecks revocation", async (t) => {
  const f = await fixture(t);
  const [store, revoker] = await Promise.all([f.open(), f.open()]);
  await store.setAllowedTailnets([peer.tailnet], "desktop");
  const requested = await store.request(peer, input);
  const access = { requestId: "trace-admitted", method: "GET", path: "/api/familiars?secret=discard", status: 0 };
  await assert.rejects(store.recordAccess(requested.device.id, access), errorIs("forbidden", 403));
  await store.decide(requested.device.id, "allowed", "desktop");
  await store.recordAccess(requested.device.id, access);
  assert.equal((await revoker.snapshot()).events[0].status, 0);
  await store.recordAccess(requested.device.id, { ...access, status: 200 });
  const events = (await revoker.snapshot()).events.filter((event) => event.requestId === access.requestId);
  assert.deepEqual(events.map((event) => event.status), [200, 0]);
  assert.ok(events.every((event) => event.deviceId === requested.device.id && event.path === "/api/familiars"));
  assert.equal((await store.verify(requested.credential, peer))?.status, "allowed");
  await revoker.decide(requested.device.id, "revoked", "desktop");
  await assert.rejects(store.recordAccess(requested.device.id, access), errorIs("forbidden", 403));
  assert.equal((await store.snapshot()).events.filter((event) => event.requestId === access.requestId).length, 2);
  await store.recordAccess(requested.device.id, { ...access, status: 403 });
  const completion = (await store.snapshot()).events[0];
  assert.equal(completion.status, 403);
  assert.equal(completion.requestId, access.requestId);
  assert.equal(completion.at, f.now());
});

test("audit order is deterministic for equal timestamps, snapshots cap at 200, storage retains every event", async (t) => {
  const f = await fixture(t);
  const store = await f.open();
  await store.setAllowedTailnets([peer.tailnet], "desktop");
  const requested = await store.request(peer, input);
  await store.decide(requested.device.id, "allowed", "desktop");
  const initial = (await store.snapshot()).events.length;
  for (let i = 0; i < 210; i++) {
    await store.recordAccess(requested.device.id, {
      requestId: `trace-${i}`, method: "GET", path: "/api", status: 200,
    });
  }
  const events = (await store.snapshot()).events;
  assert.equal(events.length, 200);
  assert.deepEqual(events.map((event) => event.requestId), Array.from({ length: 200 }, (_, i) => `trace-${209 - i}`));
  assert.equal(new Set(events.map((event) => event.id)).size, 200);
  assert.ok(events.every((event) => event.at === initialTime));
  const raw = new DatabaseSync(f.file);
  try {
    assert.equal(raw.prepare("SELECT count(*) AS count FROM audit").get()?.count, initial + 210);
  } finally {
    raw.close();
  }
});

test("the database and its sidecars are private and WAL is durable", async (t) => {
  const f = await fixture(t);
  await chmod(f.root, 0o777);
  const store = await f.open();
  await store.setAllowedTailnets([peer.tailnet], "desktop");
  await store.request(peer, input);
  if (process.platform !== "win32") {
    assert.equal((await lstat(f.root)).mode & 0o777, 0o700);
    for (const name of await readdir(f.root)) {
      assert.equal((await lstat(join(f.root, name))).mode & 0o777, 0o600);
    }
  }
  const raw = new DatabaseSync(f.file);
  try {
    assert.equal(raw.prepare("PRAGMA journal_mode").get()?.journal_mode, "wal");
    assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, 2);
  } finally {
    raw.close();
  }
});

test("root and database symlinks are refused before following them", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  const target = join(f.root, "target");
  await mkdir(target, { mode: 0o700 });
  const link = join(f.root, "root-link");
  await symlink(target, link, "dir");
  await assert.rejects(createDeviceAccessStore({ root: link, now: f.now }), /not a symlink/);
  const sentinel = join(f.root, "sentinel");
  await writeFile(sentinel, "unchanged", { mode: 0o600 });
  await symlink(sentinel, join(target, "device-access.sqlite"));
  await assert.rejects(createDeviceAccessStore({ root: target, now: f.now }), /without symlinks or hardlinks/);
  assert.equal(await readFile(sentinel, "utf8"), "unchanged");
});

test("preexisting SQLite sidecar symlinks are refused", { skip: process.platform === "win32" }, async (t) => {
  const f = await fixture(t);
  const sentinel = join(f.root, "sentinel");
  await writeFile(sentinel, "unchanged", { mode: 0o600 });
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecar = f.file + suffix;
    await symlink(sentinel, sidecar);
    await assert.rejects(f.open(), /without symlinks or hardlinks/);
    await rm(sidecar);
  }
  assert.equal(await readFile(sentinel, "utf8"), "unchanged");
});

test("corrupt and unsupported databases fail closed without resetting authority", async (t) => {
  const f = await fixture(t);
  await writeFile(f.file, "not a database", { mode: 0o600 });
  await assert.rejects(f.open(), /not a database/);
  assert.equal(await readFile(f.file, "utf8"), "not a database");
  await rm(f.file);
  const store = await f.open();
  f.close(store);
  const raw = new DatabaseSync(f.file);
  raw.exec("PRAGMA user_version = 999");
  raw.close();
  await assert.rejects(f.open(), /Unsupported device access database schema/);
});
