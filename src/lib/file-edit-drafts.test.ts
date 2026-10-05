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

  // Past the total budget nothing new is written, newest edits first, and a
  // copy that already holds a draft's text still counts as its backup.
  {
    let clock = 1_000;
    const storage = shared();
    const store = createFileEditDraftStore();
    let pending = null;
    const later = (write) => { pending = write; };
    const persist = persistFileEditDrafts(store, storage, later, () => clock);
    const flush = () => { const write = pending; pending = null; write?.(); };
    const third = (letter) => letter.repeat(Math.floor(BUDGET / 3));
    const paths = ["/repo/1.ts", "/repo/2.ts", "/repo/3.ts", "/repo/4.ts"];
    for (const [index, path] of paths.entries()) {
      clock += 1_000;
      store.begin(path, "", "v1");
      store.update(path, third(String(index)));
      flush();
    }
    assert.deepEqual(paths.map((path) => content(storage, path) !== null), [true, true, true, true], "each fit when it was written");
    assert.equal(store.unbackedPaths().size, 0, "the oldest is past the budget, but its copy holds its text");
    // Three drafts grow past the budget in one flush: the two newest are
    // written, and the third keeps its last good copy, not backed up.
    clock += 1_000;
    const grown = (letter) => letter.repeat(Math.floor(BUDGET * 0.45));
    store.update(paths[1], grown("a"));
    store.update(paths[2], grown("b"));
    store.update(paths[3], grown("c"));
    flush();
    const written = [paths[1], paths[2], paths[3]].filter((path) => content(storage, path)?.length === Math.floor(BUDGET * 0.45));
    assert.equal(written.length, 2, "only what fits is written");
    const left = [paths[1], paths[2], paths[3]].find((path) => !written.includes(path));
    assert.ok(store.unbackedPaths().has(left), "the one left out reads as not backed up");
    assert.equal(content(storage, left).length, Math.floor(BUDGET / 3), "with its last good copy kept");
    persist.flush();
  }

  // Two windows on one file's draft (#5795): the window whose stored copy the
  // other overwrote says its edit isn't backed up, and gets it back when the
  // other's copy goes.
  {
    const storage = shared();
    const a = createFileEditDraftStore();
    const manual = () => {};
    const persistA = persistFileEditDrafts(a, storage, manual);
    a.begin(A, "base\n", "v1");
    a.update(A, "base\nA1\n");
    persistA.flush();
    const b = createFileEditDraftStore();
    const persistB = persistFileEditDrafts(b, storage, manual);
    assert.equal(b.get(A).content, "base\nA1\n", "B restores A's copy");
    a.update(A, "base\nA1\nA2\n");
    persistA.flush();
    b.update(A, "base\nA1\nB1\n");
    persistB.flush();
    assert.equal(content(storage, A), "base\nA1\nB1\n");
    persistA.flush(); // A is idle: a storage event or its quit flushes
    assert.equal(content(storage, A), "base\nA1\nB1\n", "A leaves B's newer copy alone");
    assert.ok(a.unbackedPaths().has(A), "but A no longer says its edit is backed up");
    assert.ok(!b.unbackedPaths().has(A), "B's copy is the stored one");
    b.discard(A); // B cancels, and removes its own copy
    persistB.flush();
    persistA.flush();
    assert.equal(content(storage, A), "base\nA1\nA2\n", "A writes its edit back once the copy is gone");
    assert.ok(!a.unbackedPaths().has(A));
  }
}

// ── A save that landed after its time ran out, then more typing (#5795) ─────
{
  // A failed save keeps the text it sent. A re-read that finds the disk
  // holding that text rebases the draft onto it: no conflict, and what was
  // typed since stays the edit.
  {
    const store = createFileEditDraftStore();
    store.begin(A, "one\n", "v1");
    store.update(A, "one\ntwo\n");
    const save = store.startSave(A);
    assert.equal(save.unconfirmed, false);
    store.fail(A, save.id, "Couldn't save: no answer in 60 seconds.", false, null, save.content);
    assert.equal(store.get(A).unconfirmed, "one\ntwo\n", "the sent text is kept");
    store.update(A, "one\ntwo\nthree\n");
    assert.equal(store.noteDiskRead(A, "one\ntwo\n", "v2"), "rebased");
    const draft = store.get(A);
    assert.equal(draft.conflict, false, "the user's own write is not a conflict");
    assert.equal(draft.baseContent, "one\ntwo\n");
    assert.equal(draft.baseVersion, "v2", "the next save names the disk's version");
    assert.equal(draft.content, "one\ntwo\nthree\n", "what was typed since is kept");
    assert.equal(draft.unconfirmed, null);
    assert.equal(isDraftDirty(draft), true);
    // A later read of someone else's change is still a conflict.
    assert.equal(store.noteDiskRead(A, "theirs\n", "v3"), null);
    assert.equal(store.get(A).conflict, true);
  }

  // The disk holding the whole edit is a save that landed: the draft is done.
  {
    const store = createFileEditDraftStore();
    store.begin(A, "one", "v1");
    store.update(A, "one two");
    assert.equal(store.noteDiskRead(A, "one two", "v2"), "saved");
    assert.equal(store.get(A), null);
  }

  // A CRLF file compares in its own line breaks.
  {
    const store = createFileEditDraftStore();
    store.begin(A, "a\r\nb\r\n", "v1");
    store.update(A, "a\nb\nc\n");
    const save = store.startSave(A);
    store.fail(A, save.id, "no answer", false, null, save.content);
    store.update(A, "a\nb\nc\nd\n");
    assert.equal(store.noteDiskRead(A, "a\r\nb\r\nc\r\n", "v2"), "rebased");
    assert.equal(store.get(A).baseContent, "a\nb\nc\n");
  }

  // Saving again names the old version, and the server's 409 is about the
  // earlier save's own write: the draft is rebased and the caller saves again.
  {
    const store = createFileEditDraftStore();
    store.begin(A, "one\n", "v1");
    store.update(A, "one\ntwo\n");
    const first = store.startSave(A);
    store.fail(A, first.id, "no answer", false, null, first.content);
    store.update(A, "one\ntwo\nthree\n");
    const second = store.startSave(A);
    assert.equal(second.unconfirmed, true, "the save knows an earlier one is unconfirmed");
    assert.equal(second.baseVersion, "v1");
    assert.equal(store.rebaseOnEarlierSave(A, second.id, "someone else's\n", "v9"), false, "another change stays a conflict");
    assert.equal(store.rebaseOnEarlierSave(A, second.id, "one\ntwo\n", "v2"), true);
    const draft = store.get(A);
    assert.equal(draft.saving, false, "free to save again");
    assert.equal(draft.baseVersion, "v2");
    assert.equal(draft.content, "one\ntwo\nthree\n");
    const third = store.startSave(A);
    assert.equal(third.baseVersion, "v2");
    assert.equal(third.unconfirmed, false);
    assert.equal(store.settle(A, third.id, third.content, "v3"), false, "and the save completes the edit");
  }

  // A conflict refusal never records its text: nothing was written.
  {
    const store = createFileEditDraftStore();
    store.begin(A, "x", "v1");
    store.update(A, "y");
    const save = store.startSave(A);
    store.fail(A, save.id, FILE_CHANGED_ON_DISK, true, "v2", save.content);
    assert.equal(store.get(A).unconfirmed ?? null, null);
  }
}

// ── One file, one draft, whatever its Unicode form (#5795) ─────────────────
{
  const nfd = "/repo/src/café.ts";
  const nfc = "/repo/src/café.ts";
  const store = createFileEditDraftStore();
  store.begin(nfd, "x", "v1");
  store.update(nfc, "x2");
  assert.equal(store.get(nfc).content, "x2", "the precomposed name finds the decomposed draft");
  assert.equal(store.begin(nfc, "other", "v9").content, "x2", "and resumes it instead of starting a second");
  assert.deepEqual([...store.dirtyPaths()], [nfd], "one dirty file, by the name it was opened with");
  const save = store.startSave(nfc);
  assert.equal(store.settle(nfd, save.id, save.content, "v2"), false);
  assert.equal(store.hasDirty(), false);
}

// ── Saves that have ended, by file (#5795) ──────────────────────────────────
// The viewer drops a read sent before a save ended: it can carry the text from
// before the save. The count moves on every end, success or failure, and
// outlives the draft the save finished.
{
  const store = createFileEditDraftStore();
  assert.equal(store.savesEnded(A), 0);
  store.begin(A, "x", "v1");
  store.update(A, "y");
  const first = store.startSave(A);
  assert.equal(store.savesEnded(A), 0, "a save in flight hasn't ended");
  store.fail(A, first.id, "Couldn't save: the server couldn't be reached.", false, null, first.content);
  assert.equal(store.savesEnded(A), 1, "a failed save ended");
  const second = store.startSave(A);
  assert.equal(store.settle(A, second.id, second.content, "v2"), false);
  assert.equal(store.get(A), null, "the draft is done");
  assert.equal(store.savesEnded(A), 2, "and the count outlives it");
  assert.equal(store.savesEnded(B), 0, "per file");
  store.settle(A, 999, "late", "v3");
  assert.equal(store.savesEnded(A), 3, "a late answer for an older edit still ends a save");
  const nfd = "/repo/src/cafe\u0301.ts";
  store.begin(nfd, "x", "v1");
  store.update(nfd, "y");
  const save = store.startSave(nfd);
  store.settle(nfd, save.id, save.content, "v2");
  assert.equal(store.savesEnded("/repo/src/caf\u00e9.ts"), 1, "either Unicode spelling");
}

console.log("file-edit-drafts: ok");
