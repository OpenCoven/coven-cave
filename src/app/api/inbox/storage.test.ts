import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, mock, test } from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "inbox-api-storage-"));
process.env.COVEN_HOME = path.join(root, "coven");
process.env.COVEN_CAVE_HOME = path.join(root, "cave");
process.env.COVEN_CAVE_AUTH_TOKEN = "synthetic-inbox-storage-test";
const file = path.join(process.env.COVEN_CAVE_HOME, "inbox.json");
// Call through to real timers, retaining handles solely for fixture cleanup.
const intervals = mock.method(globalThis, "setInterval");
after(async () => {
  for (const call of intervals.mock.calls) clearInterval(call.result);
  intervals.mock.restore();
  await rm(root, { recursive: true, force: true });
});
const { loadInbox, withInboxLock } = await import("../../../lib/cave-inbox.ts");
const { subscribe } = await import("../../../lib/inbox-scheduler.ts");
const { GET, POST } = await import("./route.ts");
const { GET: stream } = await import("./stream/route.ts");
before(async () => {
  await loadInbox();
  // Drain the import-time scheduler tick before mutating the fixture.
  await withInboxLock(async () => undefined);
});
beforeEach(async () => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '{"private-sentinel-6153":');
});
const request = (host = "localhost") => new Request("http://localhost/api/inbox", {
  method: "POST", headers: { Host: host, "x-coven-cave-token": "synthetic-inbox-storage-test", "Content-Type": "application/json" },
  body: JSON.stringify({ kind: "agent", title: "synthetic notification" }),
});

test("GET exposes fixed recovery guidance instead of an empty successful inbox", async () => {
  const response = await GET(new Request("http://localhost/api/inbox"));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, "inbox_invalid");
  assert.match(body.error, /Restore a valid inbox\.json backup/);
  assert.doesNotMatch(JSON.stringify(body), /private-sentinel-6153/);
});

test("POST preserves failed storage and does not publish a created notification", async () => {
  const original = await readFile(file, "utf8");
  let unsubscribe = () => {};
  let delivered = false;
  const observed = new ReadableStream<Uint8Array>({ start(controller) { unsubscribe = subscribe(controller); } });
  const reader = observed.getReader();
  const pending = reader.read().then(result => { delivered = !result.done; });
  try {
    const response = await POST(request());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "inbox_invalid");
    assert.equal(await readFile(file, "utf8"), original);
    assert.equal(delivered, false);
  } finally {
    unsubscribe();
    await reader.cancel();
    await pending;
  }
});

test("denied POST remains forbidden before attempting to read storage", async () => {
  const original = await readFile(file, "utf8");
  const response = await POST(request("untrusted.invalid"));
  assert.equal(response.status, 403);
  assert.equal(await readFile(file, "utf8"), original);
});

test("newer inbox data returns update guidance and survives a rejected POST", async () => {
  const original = '{"version":2,"items":[],"futureData":"private-sentinel-6153"}';
  await writeFile(file, original);
  for (const response of [await GET(new Request("http://localhost/api/inbox")), await POST(request())]) {
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "inbox_incompatible");
    assert.match(body.error, /Update Cave/);
    assert.doesNotMatch(JSON.stringify(body), /private-sentinel-6153/);
  }
  assert.equal(await readFile(file, "utf8"), original);
});

test("unreadable storage returns access guidance without replacing the path", async () => {
  await rm(file);
  await mkdir(file);
  const marker = path.join(file, "preserved.txt");
  await writeFile(marker, "synthetic evidence");
  try {
    for (const response of [await GET(new Request("http://localhost/api/inbox")), await POST(request())]) {
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.code, "inbox_unavailable");
      assert.match(body.error, /Check access to inbox\.json/);
    }
    assert.equal(await readFile(marker, "utf8"), "synthetic evidence");
  } finally {
    await rm(file, { recursive: true });
  }
});

test("unrelated mutation errors are not mislabeled as a storage failure", async () => {
  const original = '{"version":1,"items":[]}';
  await writeFile(file, original);
  const malformedInput = new Request(request(), {
    body: JSON.stringify({ kind: "agent", title: "synthetic notification", body: {} }),
  });
  await assert.rejects(() => POST(malformedInput), TypeError);
  assert.equal(await readFile(file, "utf8"), original);
});

test("failed stream initialization releases its subscriber and creates no heartbeat", async () => {
  const beforeSubscribers = globalThis.__inboxSubscribers?.size ?? 0;
  const beforeIntervals = intervals.mock.callCount();
  const response = await stream();
  const reader = response.body!.getReader();
  try {
    await assert.rejects(reader.read(), /Restore a valid inbox\.json backup/);
    assert.equal(globalThis.__inboxSubscribers?.size ?? 0, beforeSubscribers);
    assert.equal(intervals.mock.callCount(), beforeIntervals);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
});

test("a restored inbox reconnects and creates notifications normally", async () => {
  await writeFile(file, '{"version":1,"items":[]}');
  const response = await POST(request());
  assert.equal(response.status, 200);
  const read = await GET(new Request("http://localhost/api/inbox"));
  assert.equal((await read.json()).items.length, 1);
  const events = await stream();
  const reader = events.body!.getReader();
  try {
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /"type":"snapshot"/);
  } finally { await reader.cancel(); }
  assert.equal(globalThis.__inboxSubscribers?.size ?? 0, 0);
});
