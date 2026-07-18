// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makePin } from "../stitch.ts";
import {
  appendPinToThread,
  createStitchThread,
  deleteStitchThread,
  listStitchThreads,
  markThreadSewn,
  readStitchThread,
  removePinFromThread,
  stitchThreadsRoot,
  writeStitchThread,
} from "./stitch-threads.ts";

const dir = mkdtempSync(path.join(tmpdir(), "stitch-threads-"));
const prev = process.env.COVEN_KNOWLEDGE_DIR;
process.env.COVEN_KNOWLEDGE_DIR = dir;

try {
  // Threads live under the vault root in a dot-dir the md listing ignores.
  assert.equal(stitchThreadsRoot(), path.join(dir, ".threads"));

  // Create → read round-trip.
  const thread = await createStitchThread("  Retry policy research  ");
  assert.equal(thread.title, "Retry policy research");
  assert.deepEqual(thread.pins, []);
  const read = await readStitchThread(thread.id);
  assert.deepEqual(read, thread);

  // Append and remove pins.
  const pin = makePin({ kind: "paste", ref: "paste", title: "Note", content: "Retry 5x." });
  const withPin = await appendPinToThread(thread.id, pin);
  assert.equal(withPin.pins.length, 1);
  assert.equal(withPin.pins[0].excerpt, "Retry 5x.");
  const withoutPin = await removePinFromThread(thread.id, pin.id);
  assert.equal(withoutPin.pins.length, 0);

  // Missing thread throws for mutations, null for reads.
  await assert.rejects(() => appendPinToThread("missing0", pin), /thread not found/);
  assert.equal(await readStitchThread("missing0"), null);
  assert.equal(await readStitchThread("../escape"), null, "traversal ids never hit the fs");

  // Sewn marker.
  const sewn = await markThreadSewn(thread.id, "retry-policy");
  assert.equal(sewn.sewnEntryId, "retry-policy");

  // List sorts newest-updated first and skips junk files. CI creates both
  // threads in the same millisecond, so bump the second one explicitly —
  // the assertion is about ordering, not about Date.now() granularity.
  const second = await createStitchThread("Other");
  await writeStitchThread({ ...second, updatedAt: new Date(Date.now() + 1000).toISOString() });
  const listed = await listStitchThreads();
  assert.equal(listed.length, 2);
  assert.equal(listed[0].id, second.id);

  // Corrupt JSON is skipped, not fatal.
  const { writeFileSync } = await import("node:fs");
  writeFileSync(path.join(stitchThreadsRoot(), "corrupt0.json"), "{nope", "utf8");
  const listedAfter = await listStitchThreads();
  assert.equal(listedAfter.length, 2);

  // Unknown pin kinds are dropped on read (forward-compat).
  await writeStitchThread({
    ...thread,
    pins: [pin, { ...pin, id: "p-bad", kind: "rss" }],
  });
  const reread = await readStitchThread(thread.id);
  assert.equal(reread.pins.length, 1);

  // Delete.
  assert.equal(await deleteStitchThread(thread.id), true);
  assert.equal(await readStitchThread(thread.id), null);
  assert.equal(await deleteStitchThread(thread.id), false);

  console.log("stitch-threads.test.ts OK");
} finally {
  if (prev === undefined) delete process.env.COVEN_KNOWLEDGE_DIR;
  else process.env.COVEN_KNOWLEDGE_DIR = prev;
  rmSync(dir, { recursive: true, force: true });
}
