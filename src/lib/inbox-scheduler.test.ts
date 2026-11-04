import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, mock, test } from "node:test";

const home = await fs.mkdtemp(path.join(tmpdir(), "cave-inbox-scheduler-"));
process.env.COVEN_HOME = home;
process.env.COVEN_CAVE_HOME = path.join(home, "cave");
await fs.mkdir(process.env.COVEN_CAVE_HOME);
const inboxPath = path.join(process.env.COVEN_CAVE_HOME, "inbox.json");
const { createItem, withInboxLock } = await import("./cave-inbox.ts");
const { startScheduler, stopScheduler, subscribe } = await import("./inbox-scheduler.ts");
const readFile = fs.readFile;
const callbacks: Array<() => void> = [];
let reads = 0;

// Keep the real store, filesystem operations and transaction ordering. Only
// time is controlled; the read wrapper measures redundant disk work.
beforeEach(async () => {
  await fs.writeFile(inboxPath, JSON.stringify({ version: 1, items: [] }));
  delete process.env.COVEN_CAVE_AUTOMATIONS_ENABLED;
  delete (globalThis as { __caveInboxScheduler?: unknown }).__caveInboxScheduler;
  callbacks.length = 0;
  reads = 0;
  mock.method(fs, "readFile", (...args: Parameters<typeof fs.readFile>) => {
    if (String(args[0]) === inboxPath) reads++;
    return Reflect.apply(readFile, fs, args);
  });
  syncBuiltinESMExports();
  mock.method(globalThis, "setInterval", (callback: () => void) => {
    callbacks.push(callback);
    return {} as NodeJS.Timeout;
  });
});

// A sentinel transaction waits behind every admitted pass. The following
// event-loop turn also lets its broadcast/error/finally handlers settle.
async function settle() {
  await withInboxLock(async () => undefined);
  await new Promise<void>((resolve) => setImmediate(resolve));
}

afterEach(async () => {
  await stopScheduler();
  await settle();
  mock.restoreAll();
  syncBuiltinESMExports();
});
after(async () => { await fs.rm(home, { recursive: true, force: true }); });

async function holdTransaction() {
  const entered = Promise.withResolvers<void>();
  const held = Promise.withResolvers<void>();
  const transaction = withInboxLock(async () => {
    entered.resolve();
    await held.promise;
  });
  await entered.promise;
  return async () => { held.resolve(); await transaction; };
}

async function readInbox() {
  return JSON.parse(await readFile(inboxPath, "utf8"));
}

test("a stalled pass does not queue redundant reads, and later ticks still run", async () => {
  const release = await holdTransaction();
  try {
    startScheduler();
    startScheduler();
    assert.equal(callbacks.length, 1);
    for (let i = 0; i < 60; i++) callbacks[0]();
  } finally {
    await release();
  }
  await settle();
  assert.equal(reads, 1, "one pass, not a backlog of reads after the stall");

  const item = await createItem({ kind: "reminder", title: "new due item", fireAt: "2000-01-01T00:00:00.000Z" });
  callbacks[0]();
  await settle();
  assert.equal((await readInbox()).items.find((entry: { id: string }) => entry.id === item.id).status, "fired");
});

test("catch-up fires a recurring reminder once and preserves stored metadata", async () => {
  const item = await createItem({
    kind: "reminder", title: "recurring", fireAt: "2000-01-01T00:00:00.000Z",
    recurrence: { type: "interval", everyMs: 86_400_000 },
  });
  const file = await readInbox();
  file.retained = "envelope";
  file.items[0].retained = "item";
  file.items[0].readAt = "2000-01-01T00:00:00.000Z";
  await fs.writeFile(inboxPath, JSON.stringify(file));
  const events: Array<{ type: string; items: Array<{ id: string }> }> = [];
  let unsubscribe: () => void = () => undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { streamController = controller; unsubscribe = subscribe(controller); },
  });
  const reader = stream.getReader();
  const release = await holdTransaction();
  try {
    startScheduler();
    for (let i = 0; i < 60; i++) callbacks[0]();
  } finally {
    await release();
  }
  try {
    await settle();
    unsubscribe();
    streamController!.close();
    for (;;) {
      const event = await reader.read();
      if (event.done) break;
      events.push(JSON.parse(new TextDecoder().decode(event.value).slice(6)));
    }
    const stored = await readInbox();
    assert.equal(stored.retained, "envelope");
    assert.equal(stored.items.length, 2);
    const fired = stored.items.find((entry: { id: string }) => entry.id === item.id);
    const pending = stored.items.find((entry: { id: string }) => entry.id !== item.id);
    assert.equal(fired.status, "fired");
    assert.equal(fired.readAt, null);
    assert.equal(fired.retained, "item");
    assert.equal(pending.status, "pending");
    assert.equal(pending.firedAt, null);
    assert.equal(Date.parse(pending.fireAt) - Date.parse(fired.firedAt), 86_400_000);
    assert.deepEqual(events.map((entry) => [entry.type, entry.items.map((value) => value.id)]), [["fired", [item.id]]]);
  } finally {
    unsubscribe();
    await reader.cancel();
  }
});

test("failed reads preserve bytes and release admission for explicit restoration", async () => {
  const invalid = "{ interrupted inbox";
  await fs.writeFile(inboxPath, invalid);
  startScheduler();
  await settle();
  assert.equal(reads, 1);
  assert.equal(await readFile(inboxPath, "utf8"), invalid);
  callbacks[0]();
  await settle();
  assert.equal(reads, 2, "a failed pass does not permanently suppress later checks");
  assert.equal(await readFile(inboxPath, "utf8"), invalid);

  await fs.writeFile(inboxPath, JSON.stringify({ version: 1, items: [] }));
  const item = await createItem({ kind: "reminder", title: "restored", fireAt: "2000-01-01T00:00:00.000Z" });
  callbacks[0]();
  await settle();
  assert.equal((await readInbox()).items.find((entry: { id: string }) => entry.id === item.id).status, "fired");
});

test("a disabled automations domain pauses a due reminder with its intent retained; re-enabling fires it once and never replays", async () => {
  process.env.COVEN_CAVE_AUTOMATIONS_ENABLED = "0";
  const due = await createItem({ kind: "reminder", title: "due while disabled", fireAt: "2000-01-01T00:00:00.000Z" });
  const events: Array<{ type: string; items: Array<{ id: string }> }> = [];
  let unsubscribe: () => void = () => undefined;
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { streamController = controller; unsubscribe = subscribe(controller); },
  });
  const reader = stream.getReader();
  const readsBeforeStart = reads;
  try {
    startScheduler();
    await settle();
    assert.equal(callbacks.length, 0, "a disabled domain owns no timer");
    assert.equal(reads, readsBeforeStart, "a disabled domain admits no pass");
    assert.equal((await readInbox()).items.find((entry: { id: string }) => entry.id === due.id).status, "pending");

    delete process.env.COVEN_CAVE_AUTOMATIONS_ENABLED;
    startScheduler();
    await settle();
    assert.equal(callbacks.length, 1);
    const fired = (await readInbox()).items.find((entry: { id: string }) => entry.id === due.id);
    assert.equal(fired.status, "fired");
    // Later passes see the fired record and do not deliver it again.
    callbacks[0]();
    await settle();
    const again = (await readInbox()).items.find((entry: { id: string }) => entry.id === due.id);
    assert.equal(again.firedAt, fired.firedAt);
    unsubscribe();
    streamController!.close();
    for (;;) {
      const event = await reader.read();
      if (event.done) break;
      events.push(JSON.parse(new TextDecoder().decode(event.value).slice(6)));
    }
    assert.deepEqual(events.map((entry) => [entry.type, entry.items.map((value) => value.id)]), [["fired", [due.id]]]);
  } finally {
    unsubscribe();
    await reader.cancel();
  }
});
