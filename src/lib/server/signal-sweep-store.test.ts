import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSignalSweepStore } from "./signal-sweep-store.ts";

const directory = await mkdtemp(path.join(tmpdir(), "signal-sweeps-"));
try {
  const file = path.join(directory, "receipts.json");
  const stores = [createSignalSweepStore(file), createSignalSweepStore(file)];
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    stores[index % 2].prepare("nova", ["blocker:write-boundary"], "runtime-a")));
  assert.equal(results.filter((result) => result.ok).length, 1, "concurrent windows share one atomic reservation");
  const first = results.find((result) => result.ok)!; assert.ok(first.ok);
  const uncertain = await stores[0].prepare("nova", ["blocker:write-boundary"], "runtime-a");
  assert.ok(!uncertain.ok);
  assert.match(uncertain.error, /awaiting confirmation/, "an unconfirmed handoff must not be described as a confirmed requested thread");
  await stores[0].commit(first.requestId);
  assert.equal((await createSignalSweepStore(file).prepare("nova", ["blocker:write-boundary"], "runtime-a")).ok, false, "new report or remount cannot re-raise the unresolved blocker");
  assert.equal((await stores[0].prepare("nova", ["blocker:write-boundary"], "runtime-a", { "blocker:write-boundary": "stale" })).ok, false, "retry must name the observed receipt generation");
  assert.equal((await stores[0].prepare("nova", ["blocker:write-boundary"], "runtime-b")).ok, false, "a condition change never automatically dispatches a retry");
  const replacement = await stores[0].prepare("nova", ["blocker:write-boundary"], "runtime-b", { "blocker:write-boundary": first.requestId });
  assert.ok(replacement.ok);
  await stores[0].release(replacement.requestId);
  assert.equal((await stores[0].prepare("nova", ["blocker:write-boundary"], "runtime-b")).ok, false, "a rejected retry restores the original unresolved receipt");
  const changed = await stores[0].prepare("nova", ["blocker:write-boundary"], "runtime-b", { "blocker:write-boundary": first.requestId });
  assert.ok(changed.ok); await stores[0].commit(changed.requestId);
  await stores[0].release(changed.requestId);
  assert.equal((await stores[0].prepare("nova", ["blocker:write-boundary"], "runtime-b")).ok, false, "an acknowledged handoff cannot be released as undispatched");
  const retries = await Promise.all(stores.map((store) => store.prepare("nova", ["blocker:write-boundary"], "runtime-b", { "blocker:write-boundary": changed.requestId })));
  assert.equal(retries.filter((result) => result.ok).length, 1, "explicit recovery for credentials or other human-fixed prerequisites still has one CAS winner");
  const pendingRetry = retries.find((result) => result.ok)!; assert.ok(pendingRetry.ok);
  const recovered = await stores[0].prepare("nova", ["blocker:write-boundary"], "runtime-b", { "blocker:write-boundary": pendingRetry.requestId });
  assert.ok(recovered.ok, "an explicitly acknowledged uncertain handoff can recover even after commit failed");
  assert.equal((await stores[0].prepare("sage", ["blocker:write-boundary"], "runtime-a")).ok, true, "familiar ownership stays separate");
  const batch = await stores[0].prepare("nova", ["blocker:write-boundary", "capability:new"], "runtime-b");
  assert.ok(batch.ok); assert.deepEqual(batch.accepted, ["capability:new"], "a batch does not duplicate an individually requested fix");
  await stores[1].release(batch.requestId);
  assert.equal((await stores[0].prepare("nova", ["capability:new"], "runtime-b")).ok, true, "a confirmed rejected dispatch can be retried");
  assert.doesNotMatch(await readFile(file, "utf8"), /write-boundary|nova|sage/, "receipt storage contains hashes, never private signal prose");
  await writeFile(file, "corrupt");
  await assert.rejects(stores[0].prepare("nova", ["capability:new"], "runtime-c"), "unreadable receipts fail visibly instead of permitting duplicates");
} finally { await rm(directory, { recursive: true, force: true }); }
console.log("signal-sweep-store: ok");
