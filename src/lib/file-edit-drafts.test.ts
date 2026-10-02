// @ts-nocheck
import assert from "node:assert/strict";

const { createFileEditDraftStore, isDraftDirty, FILE_CHANGED_ON_DISK } = await import("./file-edit-drafts.ts");

const A = "/repo/src/a.ts";
const B = "/repo/src/b.ts";

// A draft starts clean, from the text and version on screen, and survives
// until it is saved or discarded: there is no path-change reset to fall into.
{
  const store = createFileEditDraftStore();
  let calls = 0;
  store.subscribe(() => { calls += 1; });
  const draft = store.begin(A, "one", "v1");
  assert.equal(isDraftDirty(draft), false);
  assert.equal(store.hasDirty(), false);
  store.update(A, "one two");
  assert.equal(store.get(A).content, "one two");
  assert.equal(store.hasDirty(), true);
  assert.deepEqual([...store.dirtyPaths()], [A]);
  assert.ok(calls >= 2, "subscribers hear every change");
  // Beginning again resumes the existing draft instead of resetting it.
  assert.equal(store.begin(A, "one", "v1").content, "one two");
  store.discard(A);
  assert.equal(store.get(A), null);
  assert.equal(store.hasDirty(), false);
}

// The dirty set keeps its identity between unrelated reads, so React does not
// re-render on every subscription check.
{
  const store = createFileEditDraftStore();
  store.begin(A, "x", "v1");
  store.update(A, "y");
  assert.equal(store.dirtyPaths(), store.dirtyPaths());
}

// A save is single-flight per file and settles only the file it was sent for.
{
  const store = createFileEditDraftStore();
  store.begin(A, "a0", "va0");
  store.update(A, "a1");
  store.begin(B, "b0", "vb0");
  const sent = store.startSave(A);
  assert.equal(sent.content, "a1");
  assert.equal(sent.baseVersion, "va0");
  assert.equal(typeof sent.id, "number");
  assert.equal(store.startSave(A), null, "no second save while one is in flight");
  assert.equal(store.get(A).saving, true);
  const stillOpen = store.settle(A, sent.id, "a1", "va1");
  assert.equal(stillOpen, false);
  assert.equal(store.get(A), null, "a clean save closes the draft");
  assert.equal(store.get(B).content, "b0", "the other file's draft is untouched");
}

// Keys typed while the save was in flight are kept: the draft stays open,
// rebased on what reached the disk.
{
  const store = createFileEditDraftStore();
  store.begin(A, "a0", "va0");
  store.update(A, "a1");
  const save = store.startSave(A);
  store.update(A, "a1 + more");
  assert.equal(store.settle(A, save.id, "a1", "va1"), true);
  const draft = store.get(A);
  assert.equal(draft.content, "a1 + more");
  assert.equal(draft.baseContent, "a1");
  assert.equal(draft.baseVersion, "va1");
  assert.equal(draft.saving, false);
  assert.equal(isDraftDirty(draft), true);
}

// A failed save keeps the edit and its reason, and a conflict says so.
{
  const store = createFileEditDraftStore();
  store.begin(A, "a0", "va0");
  store.update(A, "mine");
  const save = store.startSave(A);
  store.fail(A, save.id, FILE_CHANGED_ON_DISK, true);
  const draft = store.get(A);
  assert.equal(draft.content, "mine");
  assert.equal(draft.saving, false);
  assert.equal(draft.conflict, true);
  assert.equal(draft.error, FILE_CHANGED_ON_DISK);
  // Overwrite drops the precondition and the warning, keeping the edit.
  store.acceptDisk(A);
  assert.equal(store.get(A).baseVersion, null);
  assert.equal(store.get(A).conflict, false);
  const again = store.startSave(A);
  assert.equal(again.content, "mine");
  assert.equal(again.baseVersion, null);
}

// A save's result applies only to the edit it was sent from (#5746 review):
// discard and re-edit the same path mid-save, and the late answer of the old
// save neither closes nor rebases the new edit.
{
  const store = createFileEditDraftStore();
  store.begin(A, "a0", "va0");
  store.update(A, "old edit");
  const oldSave = store.startSave(A);
  store.discard(A);
  store.begin(A, "a0", "va0");
  store.update(A, "new edit");
  assert.equal(store.settle(A, oldSave.id, "old edit", "va1"), false);
  assert.equal(store.get(A).content, "new edit");
  assert.equal(store.get(A).baseContent, "a0");
  assert.equal(store.get(A).baseVersion, "va0");
  store.fail(A, oldSave.id, "boom", true);
  assert.equal(store.get(A).conflict, false, "a stale failure is ignored too");
  assert.equal(store.get(A).error, null);
}

// Reading a newer version of the file warns before any save is tried.
{
  const store = createFileEditDraftStore();
  store.begin(A, "a0", "va0");
  store.noteDiskVersion(A, "va0");
  assert.equal(store.get(A).conflict, false, "the same version is no conflict");
  store.noteDiskVersion(A, "va1");
  assert.equal(store.get(A).conflict, true);
  assert.equal(store.get(A).error, FILE_CHANGED_ON_DISK);
  // The file goes back to the bytes the edit started from: the conflict is
  // over and Save is allowed again (#5746 review).
  store.noteDiskVersion(A, "va0");
  assert.equal(store.get(A).conflict, false);
  assert.equal(store.get(A).error, null);
  // A draft with no known base version cannot be judged, so it is left alone.
  store.begin(B, "b0", null);
  store.noteDiskVersion(B, "vb9");
  assert.equal(store.get(B).conflict, false);
}

// Clean drafts are evicted past the limit, oldest first; dirty ones never are.
{
  const store = createFileEditDraftStore(2);
  store.begin("/f/1", "x", "v");
  store.update("/f/1", "dirty");
  store.begin("/f/2", "x", "v");
  store.begin("/f/3", "x", "v");
  store.begin("/f/4", "x", "v");
  assert.ok(store.get("/f/1"), "a dirty draft survives eviction");
  assert.equal(store.get("/f/2"), null, "the oldest clean draft goes first");
  assert.ok(store.get("/f/4"), "the newest draft stays");
}

console.log("file-edit-drafts: ok");
