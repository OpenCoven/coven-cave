import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "inbox-preservation-"));
process.env.COVEN_HOME = path.join(root, "coven");
process.env.COVEN_CAVE_HOME = path.join(root, "cave");
const file = path.join(process.env.COVEN_CAVE_HOME, "inbox.json");
const { loadInbox, createItem, updateItem, applyBulkAction } = await import("./cave-inbox.ts");

before(async () => { await loadInbox(); });
beforeEach(async () => {
  await rm(file, { recursive: true, force: true });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, '{"version":1,"items":[]}');
});
after(async () => { await rm(root, { recursive: true, force: true }); });

const invalid = [
  ["malformed JSON", '{"private-sentinel-6153":'],
  ["null root", "null"],
  ["array root", "[]"],
  ["missing items", '{"version":1}'],
  ["non-array items", '{"version":1,"items":{"private-sentinel-6153":true}}'],
  ["null record", '{"version":1,"items":[null]}'],
  ["missing record ID", '{"version":1,"items":[{"title":"private-sentinel-6153"}]}'],
  ["empty record ID", '{"version":1,"items":[{"id":" "}]}'],
  ["non-string record ID", '{"version":1,"items":[{"id":7}]}'],
  ["array record", '{"version":1,"items":[[]]}'],
  ["invalid version", '{"version":"1","items":[]}'],
  ["zero version", '{"version":0,"items":[]}'],
  ["null version", '{"version":null,"items":[]}'],
] as const;

for (const [label, raw] of invalid) {
  test(`rejects ${label} after startup without normalizing the store`, async () => {
    await writeFile(file, raw);
    await assert.rejects(loadInbox, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Restore a valid inbox\.json backup/);
      assert.doesNotMatch(error.message, /private-sentinel-6153/);
      return true;
    });
    assert.equal(await readFile(file, "utf8"), raw);
  });
}

test("later create and bulk mutations preserve malformed authoritative bytes", async () => {
  await createItem({ kind: "agent", title: "existing synthetic notification" });
  const raw = '{"version":1,"items":[{"id":"private-sentinel-6153"';
  for (const mutate of [
    () => createItem({ kind: "agent", title: "later synthetic notification" }),
    () => applyBulkAction("read", null),
  ]) {
    await writeFile(file, raw);
    await assert.rejects(mutate, /Restore a valid inbox\.json backup/);
    assert.equal(await readFile(file, "utf8"), raw);
  }
});

test("newer inbox versions cannot be read or rewritten by an older host", async () => {
  const raw = '{"version":2,"items":[],"futureData":{"keep":true}}';
  await writeFile(file, raw);
  await assert.rejects(loadInbox, /Update Cave before changing reminders/);
  await assert.rejects(() => createItem({ kind: "agent", title: "blocked" }), /Update Cave/);
  assert.equal(await readFile(file, "utf8"), raw);
});

test("non-file read failures are not absence and preserve their original cause", async () => {
  await rm(file);
  await mkdir(file);
  await writeFile(path.join(file, "preserved.txt"), "synthetic recovery evidence");
  await assert.rejects(loadInbox, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Check access to inbox\.json/);
    assert.ok(error.cause instanceof Error);
    return true;
  });
  assert.equal(await readFile(path.join(file, "preserved.txt"), "utf8"), "synthetic recovery evidence");
});

test("an absent inbox can still start empty and accept a notification", async () => {
  await rm(file);
  assert.deepEqual(await loadInbox(), { version: 1, items: [] });
  const item = await createItem({ kind: "agent", title: "first" });
  assert.equal((await loadInbox()).items[0]?.id, item.id);
});

test("valid legacy data and unknown fields survive an ordinary update", async () => {
  const item = await createItem({ kind: "agent", title: "before" });
  await writeFile(file, JSON.stringify({ items: [{ ...item, extension: { keep: true } }], metadata: { keep: true } }));
  await updateItem(item.id, { title: "after" });
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.version, 1);
  assert.equal(saved.items[0].title, "after");
  assert.deepEqual(saved.items[0].extension, { keep: true });
  assert.deepEqual(saved.metadata, { keep: true });
});

test("explicit fixture restoration permits subsequent use without retrying failed writes", async () => {
  const existing = await createItem({ kind: "agent", title: "preserved" });
  const good = await readFile(file, "utf8");
  await writeFile(file, "broken synthetic data");
  await assert.rejects(() => createItem({ kind: "agent", title: "must not replay" }));
  await writeFile(file, good);
  const later = await createItem({ kind: "agent", title: "after restore" });
  assert.deepEqual((await loadInbox()).items.map(item => item.id), [existing.id, later.id]);
});
