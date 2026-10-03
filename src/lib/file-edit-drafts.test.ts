// @ts-nocheck
import assert from "node:assert/strict";

/** A stored entry without its time, which must be a number (#5781). */
function entryOf(raw) {
  const { savedAt, ...entry } = JSON.parse(raw);
  assert.equal(typeof savedAt, "number", "each stored draft records when it changed");
  return entry;
}

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
  // Typing more doesn't change which files are dirty, so the set stays the
  // same object and the desk doesn't re-render per keystroke (#5756).
  const before = store.dirtyPaths();
  store.update(A, "yz");
  store.update(A, "yzw");
  assert.equal(store.dirtyPaths(), before);
  store.update(A, "x");
  assert.notEqual(store.dirtyPaths(), before, "a change in membership is a new set");
  assert.equal(store.dirtyPaths().size, 0);
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

// A CRLF file is edited in "\n" (what the editor holds) and saved as CRLF,
// so one changed line is one changed line on disk (#5745). Mixed files keep
// the editor's "\n", as before.
{
  const { fileLineBreak } = await import("./file-edit-drafts.ts");
  assert.equal(fileLineBreak("a\r\nb\r\n"), "\r\n");
  assert.equal(fileLineBreak("a\nb\n"), "\n");
  assert.equal(fileLineBreak("a\r\nb\n"), "\n", "mixed endings are not guessed at");
  assert.equal(fileLineBreak("single line"), "\n");
  const store = createFileEditDraftStore();
  store.begin(A, "one\r\ntwo\r\n", "v1");
  const draft = store.get(A);
  assert.equal(draft.content, "one\ntwo\n", "the editor sees plain newlines");
  assert.equal(draft.eol, "\r\n");
  assert.equal(isDraftDirty(draft), false, "normalizing is not an edit");
  store.update(A, "one\nTWO\n");
  const save = store.startSave(A);
  assert.equal(save.body, "one\r\nTWO\r\n", "saved back with the file's CRLF");
  assert.equal(save.content, "one\nTWO\n");
  assert.equal(store.settle(A, save.id, save.content, "v2"), false);
}

// ── Overwrite writes over the version the conflict was about (#5756) ────────
// It used to drop the precondition: a change after the conflict appeared was
// overwritten unseen, and every later save of the draft went unchecked.
{
  const store = createFileEditDraftStore();
  store.begin(A, "one", "v1");
  store.update(A, "one mine");
  const save = store.startSave(A);
  store.fail(A, save.id, FILE_CHANGED_ON_DISK, true, "v2");
  assert.equal(store.get(A).diskVersion, "v2", "the server's version is kept with the conflict");
  store.acceptDisk(A);
  assert.equal(store.get(A).baseVersion, "v2", "Overwrite is pinned to the version the person was warned about");
  assert.equal(store.get(A).conflict, false);
  // A later change is a new conflict, and a re-read moves the pin with it.
  store.noteDiskVersion(A, "v3");
  assert.equal(store.get(A).conflict, true);
  store.noteDiskVersion(A, "v4");
  assert.equal(store.get(A).diskVersion, "v4", "the newest disk version is the one Overwrite pins");
  store.acceptDisk(A);
  assert.equal(store.get(A).baseVersion, "v4");
  // A failure that isn't a conflict doesn't touch the pin.
  const again = store.startSave(A);
  store.fail(A, again.id, "network down");
  assert.equal(store.get(A).baseVersion, "v4");
}

// ── Drafts kept in storage (#5756) ─────────────────────────────────────────
// The desktop app closes, quits and relaunches without an unload prompt, so a
// memory-only draft was lost. Unsaved drafts are now written to storage, one
// key per file, and a fresh page brings them back.
{
  const { persistFileEditDrafts, FILE_EDIT_DRAFT_STORAGE_PREFIX: PREFIX, FILE_EDIT_DRAFT_STORAGE_MAX_CHARS } =
    await import("./file-edit-drafts.ts");
  function fakeStorage(seed = {}) {
    const map = new Map(Object.entries(seed));
    return {
      map,
      failWrites: false,
      get length() { return map.size; },
      key(index) { return [...map.keys()][index] ?? null; },
      getItem(key) { return map.has(key) ? map.get(key) : null; },
      setItem(key, value) { if (this.failWrites) throw new Error("QuotaExceededError"); map.set(key, String(value)); },
      removeItem(key) { map.delete(key); },
    };
  }
  const now = (write) => write();

  // Only unsaved drafts are written; a save or a discard removes them.
  {
    const storage = fakeStorage();
    const store = createFileEditDraftStore();
    persistFileEditDrafts(store, storage, now);
    store.begin(A, "one\r\ntwo\r\n", "v1");
    assert.equal(storage.map.size, 0, "a draft nobody has typed into isn't written");
    store.update(A, "one\nTWO\n");
    assert.deepEqual(entryOf(storage.getItem(PREFIX + A)), {
      content: "one\nTWO\n", baseContent: "one\ntwo\n", baseVersion: "v1", eol: "\r\n",
    });
    const save = store.startSave(A);
    store.settle(A, save.id, save.content, "v2");
    assert.equal(storage.getItem(PREFIX + A), null, "a saved draft is removed");
    store.begin(B, "b", "v1");
    store.update(B, "b2");
    assert.ok(storage.getItem(PREFIX + B));
    store.discard(B);
    assert.equal(storage.getItem(PREFIX + B), null, "a discarded draft is removed");
  }

  // A fresh page brings back what the last one left, as unsaved drafts that
  // still name the version they started from.
  {
    const storage = fakeStorage({
      [PREFIX + A]: JSON.stringify({ content: "mine", baseContent: "base", baseVersion: "v7", eol: "\n" }),
      [PREFIX + B]: "{not json",
      [PREFIX + "/repo/src/c.ts"]: JSON.stringify({ content: "same", baseContent: "same", baseVersion: "v1", eol: "\n" }),
      [PREFIX + "/repo/src/d.ts"]: JSON.stringify({ content: "x", baseContent: "y", baseVersion: 3, eol: "\n" }),
      "unrelated:key": "1",
    });
    const store = createFileEditDraftStore();
    persistFileEditDrafts(store, storage, now);
    const restored = store.get(A);
    assert.equal(restored.content, "mine");
    assert.equal(restored.baseVersion, "v7");
    assert.equal(restored.saving, false);
    assert.equal(restored.conflict, false);
    assert.deepEqual([...store.dirtyPaths()], [A], "malformed, clean and mistyped entries are ignored");
    // The restored draft's version is still checked against the disk.
    store.noteDiskVersion(A, "v8");
    assert.equal(store.get(A).conflict, true);
    assert.equal(storage.getItem("unrelated:key"), "1", "other keys are left alone");
  }

  // A draft already open wins over a stored one for the same file.
  {
    const store = createFileEditDraftStore();
    store.begin(A, "live", "v1");
    store.update(A, "live edit");
    store.restore([{ path: A, content: "stale", baseContent: "live", baseVersion: "v1", eol: "\n" }]);
    assert.equal(store.get(A).content, "live edit");
  }

  // Too large, or storage refuses: the draft stays in memory, nothing throws.
  {
    const storage = fakeStorage();
    const store = createFileEditDraftStore();
    persistFileEditDrafts(store, storage, now);
    store.begin(A, "a", "v1");
    store.update(A, "a2");
    assert.ok(storage.getItem(PREFIX + A));
    store.update(A, "x".repeat(FILE_EDIT_DRAFT_STORAGE_MAX_CHARS));
    // The last good copy stays (#5781): it used to be deleted, leaving the
    // edit in memory alone. The store says the latest text isn't backed up.
    assert.equal(entryOf(storage.getItem(PREFIX + A)).content, "a2", "an oversized draft keeps its last good copy");
    assert.deepEqual([...store.unbackedPaths()], [A]);
    storage.failWrites = true;
    store.begin(B, "b", "v1");
    assert.doesNotThrow(() => store.update(B, "b2"));
    assert.equal(store.get(B).content, "b2");
    assert.deepEqual([...store.unbackedPaths()].sort(), [A, B].sort(), "a refused write is not backed up either");
    // A draft kept once, whose next write is refused, keeps that copy.
    const C = "/repo/src/c.ts";
    storage.failWrites = false;
    store.begin(C, "c", "v1");
    store.update(C, "c2");
    storage.failWrites = true;
    store.update(C, "c3");
    assert.equal(entryOf(storage.getItem(PREFIX + C)).content, "c2", "the last good copy survives a refused write");
    assert.ok(store.unbackedPaths().has(C));
  }

  // Another window's draft for a file this page never wrote is left alone.
  {
    const storage = fakeStorage();
    const store = createFileEditDraftStore();
    persistFileEditDrafts(store, storage, now);
    storage.setItem(PREFIX + B, JSON.stringify({ content: "theirs", baseContent: "b", baseVersion: "v1", eol: "\n" }));
    store.begin(A, "a", "v1");
    store.update(A, "a2");
    assert.ok(storage.getItem(PREFIX + B), "this page only removes what it wrote");
  }

  // A save that lands while typing continues moves the stored base and its
  // version too, though the text is unchanged (#5760 review).
  {
    const storage = fakeStorage();
    const store = createFileEditDraftStore();
    persistFileEditDrafts(store, storage, now);
    store.begin(A, "one", "v1");
    store.update(A, "one two");
    const save = store.startSave(A);
    store.update(A, "one two three");
    assert.equal(JSON.parse(storage.getItem(PREFIX + A)).baseVersion, "v1");
    assert.equal(store.settle(A, save.id, save.content, "v2"), true);
    assert.deepEqual(entryOf(storage.getItem(PREFIX + A)), {
      content: "one two three", baseContent: "one two", baseVersion: "v2", eol: "\n",
    });
    store.acceptDisk(A);
    assert.equal(JSON.parse(storage.getItem(PREFIX + A)).baseVersion, null, "Overwrite's dropped precondition is kept too");
  }

  // Writes are batched until the scheduled flush.
  {
    const storage = fakeStorage();
    const store = createFileEditDraftStore();
    const queued = [];
    const persisted = persistFileEditDrafts(store, storage, (write) => queued.push(write));
    store.begin(A, "a", "v1");
    store.update(A, "a2");
    store.update(A, "a3");
    assert.equal(queued.length, 1, "one write is queued for a burst of changes");
    assert.equal(storage.map.size, 0);
    persisted.flush();
    assert.equal(JSON.parse(storage.getItem(PREFIX + A)).content, "a3");
  }
}

// ── Two windows, budgets and expiry (#5781) ────────────────────────────────
{
  const {
    persistFileEditDrafts,
    FILE_EDIT_DRAFT_STORAGE_PREFIX: PREFIX,
    FILE_EDIT_DRAFT_STORAGE_BUDGET_CHARS: BUDGET,
    FILE_EDIT_DRAFT_MAX_AGE_MS: MAX_AGE,
  } = await import("./file-edit-drafts.ts");
  const shared = (seed = {}) => {
    const map = new Map(Object.entries(seed));
    return {
      map,
      get length() { return map.size; },
      key(index) { return [...map.keys()][index] ?? null; },
      getItem(key) { return map.has(key) ? map.get(key) : null; },
      setItem(key, value) { map.set(key, String(value)); },
      removeItem(key) { map.delete(key); },
    };
  };
  const sync = (write) => write();
  const content = (storage, path) => {
    const raw = storage.getItem(PREFIX + path);
    return raw === null ? null : JSON.parse(raw).content;
  };

  // Window B's Cancel no longer deletes window A's newer edit, and A's copy
  // comes back if anything removes it while A still holds the edit.
  {
    const storage = shared();
    const a = createFileEditDraftStore();
    const persistA = persistFileEditDrafts(a, storage, sync);
    a.begin(A, "x", "v1");
    a.update(A, "e1");
    const b = createFileEditDraftStore();
    persistFileEditDrafts(b, storage, sync); // B opens, and restores A's e1
    assert.equal(b.get(A).content, "e1");
    a.update(A, "e2");
    b.discard(A); // B presses Cancel on its restored copy
    assert.equal(content(storage, A), "e2", "B removes only its own copy, never A's newer edit");
    storage.removeItem(PREFIX + A); // something else drops it while A holds the edit
    persistA.flush(); // A quits
    assert.equal(content(storage, A), "e2", "A writes its edit back");
  }

  // Each window writes only what it changed: B's untouched, restored copy
  // never overwrites A's newer edit.
  {
    const storage = shared();
    const a = createFileEditDraftStore();
    persistFileEditDrafts(a, storage, sync);
    a.begin(A, "x", "v1");
    a.update(A, "e1");
    const b = createFileEditDraftStore();
    const persistB = persistFileEditDrafts(b, storage, sync);
    a.update(A, "e2");
    b.begin(B, "y", "v1");
    b.update(B, "y2"); // B edits another file, so B flushes
    persistB.flush();
    assert.equal(content(storage, A), "e2");
    b.update(A, "b's own edit"); // but B's own change to the file is written
    assert.equal(content(storage, A), "b's own edit");
  }

  // A draft left untouched for 14 days is dropped on the next start.
  {
    let clock = 1_000_000_000_000;
    const entry = (savedAt) => JSON.stringify({ content: "edited", baseContent: "base", baseVersion: "v1", eol: "\n", savedAt });
    const storage = shared({ [PREFIX + A]: entry(clock - MAX_AGE - 1), [PREFIX + B]: entry(clock - MAX_AGE + 60_000) });
    const store = createFileEditDraftStore();
    persistFileEditDrafts(store, storage, sync, () => clock);
    assert.equal(store.get(A), null, "the old one isn't restored");
    assert.equal(storage.getItem(PREFIX + A), null, "and its key is gone");
    assert.equal(store.get(B).content, "edited", "a recent one is");
  }

  // Past the total budget, the newest edits are written and the oldest isn't.
  {
    let clock = 1_000;
    const storage = shared();
    const store = createFileEditDraftStore();
    persistFileEditDrafts(store, storage, sync, () => clock);
    const big = (letter) => letter.repeat(Math.floor(BUDGET / 3));
    const paths = ["/repo/1.ts", "/repo/2.ts", "/repo/3.ts", "/repo/4.ts"];
    for (const [index, path] of paths.entries()) {
      clock += 1_000;
      store.begin(path, "", "v1");
      store.update(path, big(String(index)));
    }
    assert.deepEqual(paths.map((path) => content(storage, path) !== null), [true, true, true, true], "each fit when it was written");
    clock += 1_000;
    store.update(paths[0], big("z")); // the oldest edit changes again, now newest
    assert.ok(store.unbackedPaths().size >= 1, "something no longer fits");
    assert.equal(content(storage, paths[0]), big("z"), "the newest edit is written");
    assert.ok(!store.unbackedPaths().has(paths[0]));
    assert.ok(store.unbackedPaths().has(paths[1]), "the least recently changed is the one left out");
    assert.equal(content(storage, paths[1]), big("1"), "with its last good copy kept");
  }
}

console.log("file-edit-drafts: ok");
