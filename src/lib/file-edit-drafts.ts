/**
 * Unsaved file edits, kept per path outside React (#5745).
 *
 * The file viewer used to hold its edit in component state and drop it on any
 * path change, so a tab switch, a session switch, a narrow step switch, the
 * full PR view or Escape threw the edit away without a word. A draft now lives
 * here for the life of the page, keyed by the file's absolute path. The viewer
 * shows the editor whenever its file has a draft, so coming back to a file
 * resumes the edit wherever it was left.
 *
 * A draft remembers the text it started from and the server's version of it.
 * Saving sends that version, and the server refuses when the file changed on
 * disk since (`conflict`), so a stale edit can never overwrite someone else's
 * change silently.
 *
 * Every write names its path, so a save that lands after the reader moved to
 * another file settles the file it was sent for and nothing else.
 *
 * Unsaved drafts are also kept in storage (#5756). The desktop app closes,
 * quits and relaunches for an update without ever running an unload prompt,
 * so a memory-only draft was simply gone; there it uses localStorage and the
 * draft comes back on the next launch. A browser tab keeps them in
 * sessionStorage, which survives a reload or a crash restore, and still warns
 * before the tab closes.
 */

export type FileEditDraft = {
  /** Identity of this edit. A save's result applies only to the draft it was
   *  sent from, never to a later edit of the same path (#5746 review). */
  id: number;
  path: string;
  /** The edited text. */
  content: string;
  /** The text the edit started from, or the last text saved. */
  baseContent: string;
  /** The server's version of `baseContent`; sent with a save as a precondition. */
  baseVersion: string | null;
  saving: boolean;
  /** Why the last save failed, or why saving is unsafe. */
  error: string | null;
  /** The file changed on disk since `baseVersion`. */
  conflict: boolean;
  /** The disk's version when the conflict was found (#5756). Overwrite
   *  writes over exactly that version, so a later change is a new conflict
   *  rather than something overwritten unseen. */
  diskVersion?: string | null;
  /** The file's line break. The editor works in "\n"; a file whose every
   *  break is CRLF is saved back as CRLF, not rewritten line by line (#5745). */
  eol: "\n" | "\r\n";
};

/** CRLF only when every line break is: a mixed file keeps the editor's "\n". */
export function fileLineBreak(content: string): "\n" | "\r\n" {
  const breaks = content.match(/\n/g)?.length ?? 0;
  const crlf = content.match(/\r\n/g)?.length ?? 0;
  return breaks > 0 && crlf === breaks ? "\r\n" : "\n";
}

/** What storage keeps of an unsaved draft (#5756), and when (#5781). */
export type SavedFileEditDraft = Pick<FileEditDraft, "path" | "content" | "baseContent" | "baseVersion" | "eol"> & {
  /** When this edit last changed, ms since the epoch; absent in older entries. */
  savedAt?: number;
};

/** Clean drafts beyond this are dropped, oldest first. Dirty drafts never are. */
export const FILE_EDIT_DRAFT_LIMIT = 40;

export const FILE_CHANGED_ON_DISK = "This file changed on disk since you started editing.";

export function isDraftDirty(draft: FileEditDraft | null | undefined): boolean {
  return Boolean(draft && draft.content !== draft.baseContent);
}

export function createFileEditDraftStore(limit = FILE_EDIT_DRAFT_LIMIT) {
  const drafts = new Map<string, FileEditDraft>();
  const listeners = new Set<() => void>();
  let nextId = 1;
  let dirtyPaths: ReadonlySet<string> = new Set();
  let unbacked: ReadonlySet<string> = new Set();

  const emit = () => {
    // The same set while its members are the same (#5756): a new Set on every
    // keystroke made each subscriber (the whole desk) re-render as you typed.
    const next = [...drafts.values()].filter(isDraftDirty).map((draft) => draft.path);
    if (next.length !== dirtyPaths.size || next.some((path) => !dirtyPaths.has(path))) dirtyPaths = new Set(next);
    for (const listener of listeners) listener();
  };
  const put = (draft: FileEditDraft) => {
    drafts.delete(draft.path);
    drafts.set(draft.path, draft);
    if (drafts.size > limit) {
      for (const [path, entry] of drafts) {
        if (drafts.size <= limit) break;
        if (!isDraftDirty(entry) && !entry.saving) drafts.delete(path);
      }
    }
    emit();
  };
  const patch = (path: string, change: Partial<FileEditDraft>) => {
    const draft = drafts.get(path);
    if (!draft) return null;
    const next = { ...draft, ...change };
    drafts.set(path, next);
    emit();
    return next;
  };

  return {
    get(path: string | null | undefined): FileEditDraft | null {
      return path ? drafts.get(path) ?? null : null;
    },
    /** Paths whose draft differs from the text it started from. Stable between changes. */
    dirtyPaths(): ReadonlySet<string> {
      return dirtyPaths;
    },
    hasDirty(): boolean {
      return dirtyPaths.size > 0;
    },
    /** Unsaved drafts whose latest text isn't kept in storage (#5781): too
     *  large, past the storage budget, or refused by the storage. They are
     *  still held here; a reload or a quit would lose what changed since the
     *  last copy. Stable between changes. */
    unbackedPaths(): ReadonlySet<string> {
      return unbacked;
    },
    setUnbacked(paths: ReadonlySet<string>) {
      if (paths.size === unbacked.size && [...paths].every((path) => unbacked.has(path))) return;
      unbacked = new Set(paths);
      emit();
    },
    /** Start editing `path` from `content` (no-op when a draft already exists). */
    begin(path: string, content: string, version: string | null): FileEditDraft {
      const existing = drafts.get(path);
      if (existing) return existing;
      const eol = fileLineBreak(content);
      const text = eol === "\r\n" ? content.replace(/\r\n/g, "\n") : content;
      const draft: FileEditDraft = {
        id: nextId++, path, content: text, baseContent: text, baseVersion: version, saving: false, error: null, conflict: false, eol,
      };
      put(draft);
      return draft;
    },
    update(path: string, content: string) {
      const draft = drafts.get(path);
      if (!draft || draft.content === content) return;
      patch(path, { content });
    },
    /** Throw the edit away (Cancel, or Reload after a conflict). */
    discard(path: string) {
      if (drafts.delete(path)) emit();
    },
    /** Mark a save as started. Returns the edit's identity, the edited text
     *  (`content`, for `settle`), the bytes to write (`body`, in the file's own
     *  line break), or null when no save may start. */
    startSave(path: string): { id: number; content: string; body: string; baseVersion: string | null } | null {
      const draft = drafts.get(path);
      if (!draft || draft.saving) return null;
      patch(path, { saving: true, error: null });
      const body = draft.eol === "\r\n" ? draft.content.replace(/\n/g, "\r\n") : draft.content;
      return { id: draft.id, content: draft.content, body, baseVersion: draft.baseVersion };
    },
    /**
     * A save of `sent` succeeded at `version`. The draft is done unless it was
     * typed into while the save was in flight: then it stays, now based on
     * what reached the disk. Returns whether the draft is still open.
     */
    settle(path: string, id: number, sent: string, version: string | null): boolean {
      const draft = drafts.get(path);
      if (!draft || draft.id !== id) return false;
      if (draft.content === sent) {
        drafts.delete(path);
        emit();
        return false;
      }
      patch(path, { baseContent: sent, baseVersion: version, saving: false, error: null, conflict: false });
      return true;
    },
    /** A save failed. A conflict names the disk's version, when the server said. */
    fail(path: string, id: number, error: string, conflict = false, diskVersion: string | null = null) {
      if (drafts.get(path)?.id !== id) return;
      patch(path, conflict ? { saving: false, error, conflict, diskVersion } : { saving: false, error, conflict });
    },
    /**
     * The viewer read the file again. If it is no longer the version the
     * draft started from, say so before a save is attempted.
     */
    noteDiskVersion(path: string, version: string | null) {
      const draft = drafts.get(path);
      if (!draft || draft.saving || !version || !draft.baseVersion) return;
      if (version === draft.baseVersion) {
        // Back to the bytes the edit started from: the precondition holds
        // again, so the conflict is over (#5746 review).
        if (draft.conflict) patch(path, { conflict: false, error: null });
        return;
      }
      if (!draft.conflict || draft.diskVersion !== version) {
        patch(path, { conflict: true, error: FILE_CHANGED_ON_DISK, diskVersion: version });
      }
    },
    /**
     * Keep my edit and write it over the newer file. The save is pinned to the
     * version the conflict was about (#5756): dropping the precondition
     * altogether overwrote any later change unseen, and left every later
     * save of this draft unchecked.
     */
    acceptDisk(path: string) {
      const draft = drafts.get(path);
      if (!draft) return;
      patch(path, { baseVersion: draft.diskVersion ?? null, conflict: false, error: null, diskVersion: null });
    },
    /** Every draft, least recently changed first. */
    all(): FileEditDraft[] {
      return [...drafts.values()];
    },
    /** Bring back drafts kept in storage (#5756). A draft already open wins. */
    restore(saved: readonly SavedFileEditDraft[]) {
      let changed = false;
      for (const { savedAt: _savedAt, ...entry } of saved) {
        if (drafts.has(entry.path)) continue;
        drafts.set(entry.path, { ...entry, id: nextId++, saving: false, error: null, conflict: false });
        changed = true;
      }
      if (changed) emit();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const FILE_EDIT_DRAFT_STORAGE_PREFIX = "cave.code.edit-draft.v1:";
/** A draft larger than this (its text plus its base) stays in memory only. */
export const FILE_EDIT_DRAFT_STORAGE_MAX_CHARS = 1_000_000;
/** All of a page's drafts together (#5781), newest first: WebKit gives an
 *  origin about 5 MB of localStorage, two bytes a character. */
export const FILE_EDIT_DRAFT_STORAGE_BUDGET_CHARS = 2_000_000;
/** A stored draft untouched for this long is dropped (#5781): one for a
 *  removed worktree or a deleted session can't be reached to discard. */
export const FILE_EDIT_DRAFT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function readSavedDraft(path: string, raw: string | null): SavedFileEditDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SavedFileEditDraft>;
    if (
      typeof value.content !== "string" ||
      typeof value.baseContent !== "string" ||
      (value.baseVersion !== null && typeof value.baseVersion !== "string") ||
      (value.eol !== "\n" && value.eol !== "\r\n") ||
      value.content === value.baseContent
    ) {
      return null;
    }
    const savedAt = typeof value.savedAt === "number" && Number.isFinite(value.savedAt) ? value.savedAt : undefined;
    return {
      path,
      content: value.content,
      baseContent: value.baseContent,
      baseVersion: value.baseVersion,
      eol: value.eol,
      ...(savedAt === undefined ? {} : { savedAt }),
    };
  } catch {
    return null;
  }
}

/**
 * Keep every unsaved draft of `store` in `storage`, one key per file (#5756),
 * and bring back what an earlier page left there. One key per file, so two
 * windows sharing localStorage only meet on the same file, and there each
 * writes only what it changed and removes only its own copy (#5781).
 * Writes are batched; call `flush` when the page is about to go away.
 */
export function persistFileEditDrafts(
  store: FileEditDraftStore,
  storage: DraftStorage,
  schedule: (write: () => void) => void = (write) => { setTimeout(write, 150); },
  now: () => number = Date.now,
) {
  const saved: SavedFileEditDraft[] = [];
  const expired: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(FILE_EDIT_DRAFT_STORAGE_PREFIX)) continue;
    const draft = readSavedDraft(key.slice(FILE_EDIT_DRAFT_STORAGE_PREFIX.length), storage.getItem(key));
    if (draft?.savedAt !== undefined && now() - draft.savedAt > FILE_EDIT_DRAFT_MAX_AGE_MS) expired.push(key);
    else if (draft) saved.push(draft);
  }
  for (const key of expired) {
    try {
      storage.removeItem(key);
    } catch {
      /* nothing more to do */
    }
  }
  store.restore(saved);

  // What this page last wrote per path (its text, not its time), so an
  // unchanged draft isn't rewritten on every keystroke elsewhere, and a saved
  // or discarded one is removed. The whole entry, not just the text (#5760
  // review): a save that lands while typing continues moves the base and its
  // version, text unchanged.
  const contentKey = (draft: Pick<SavedFileEditDraft, "content" | "baseContent" | "baseVersion" | "eol">) =>
    JSON.stringify({ content: draft.content, baseContent: draft.baseContent, baseVersion: draft.baseVersion, eol: draft.eol });
  const storedKey = (path: string): string | null => {
    let raw: string | null = null;
    try {
      raw = storage.getItem(FILE_EDIT_DRAFT_STORAGE_PREFIX + path);
    } catch {
      return null;
    }
    const entry = readSavedDraft(path, raw);
    return entry ? contentKey(entry) : null;
  };
  const written = new Map<string, string>(saved.map((draft) => [draft.path, contentKey(draft)]));
  const changedAt = new Map<string, number>(saved.map((draft) => [draft.path, draft.savedAt ?? now()]));
  let pending = false;
  const flush = () => {
    pending = false;
    const dirty = store.all().filter(isDraftDirty);
    for (const draft of dirty) {
      if (written.get(draft.path) !== contentKey(draft)) changedAt.set(draft.path, now());
    }
    // Newest edits first, so the budget keeps the work in progress.
    dirty.sort((a, b) => (changedAt.get(b.path) ?? 0) - (changedAt.get(a.path) ?? 0));
    const keep = new Set<string>();
    const unbacked = new Set<string>();
    let budget = FILE_EDIT_DRAFT_STORAGE_BUDGET_CHARS;
    for (const draft of dirty) {
      // A dirty draft's stored copy is never removed here: when this version
      // can't be written, the last good one is better than none (#5781).
      keep.add(draft.path);
      const size = draft.content.length + draft.baseContent.length;
      const entry = contentKey(draft);
      if (size > FILE_EDIT_DRAFT_STORAGE_MAX_CHARS || size > budget) {
        // Nothing new is written past the budget. A copy that already holds
        // this text still backs it up (#5787 review), so only a draft whose
        // latest text isn't stored reads as not backed up.
        if (written.get(draft.path) !== entry || storedKey(draft.path) !== entry) unbacked.add(draft.path);
        continue;
      }
      budget -= size;
      // Unchanged here since this page last wrote it: rewritten only when
      // its copy is gone. Another window that saved or discarded the file
      // removed it, and this page still holds the edit (#5781). A different
      // copy is another window's newer edit, and is left alone.
      if (written.get(draft.path) === entry && storedKey(draft.path) !== null) continue;
      try {
        storage.setItem(
          FILE_EDIT_DRAFT_STORAGE_PREFIX + draft.path,
          JSON.stringify({ ...JSON.parse(entry), savedAt: changedAt.get(draft.path) ?? now() }),
        );
        written.set(draft.path, entry);
      } catch {
        // Over quota, or storage refused: held in memory, last copy kept.
        unbacked.add(draft.path);
      }
    }
    for (const path of [...written.keys()]) {
      if (keep.has(path)) continue;
      // Only this page's own copy goes (#5781): another window may still be
      // editing the file, and its copy is its unsaved work.
      if (storedKey(path) === written.get(path)) {
        try {
          storage.removeItem(FILE_EDIT_DRAFT_STORAGE_PREFIX + path);
        } catch {
          /* nothing more to do */
        }
      }
      written.delete(path);
      changedAt.delete(path);
    }
    store.setUnbacked(unbacked);
  };
  store.subscribe(() => {
    if (pending) return;
    pending = true;
    schedule(flush);
  });
  return { flush };
}

export type FileEditDraftStore = ReturnType<typeof createFileEditDraftStore>;

export const fileEditDrafts = createFileEditDraftStore();

/** localStorage in the desktop app, where a quit runs no unload prompt;
 *  sessionStorage in a browser tab, which does (#5756). */
function draftStorage(): DraftStorage | null {
  try {
    // The same test as tauri-platform's isTauri(), inlined to keep this
    // module free of app imports.
    const desktop = (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== undefined;
    return desktop ? window.localStorage : window.sessionStorage;
  } catch {
    return null; // storage blocked: drafts stay memory-only
  }
}

// One unload guard for the page, installed with the store rather than by a
// viewer (#5746 review): drafts outlive the viewer (the Work and GitHub tabs
// unmount it), so the warning has to as well.
if (typeof window !== "undefined") {
  const storage = draftStorage();
  const persisted = storage ? persistFileEditDrafts(fileEditDrafts, storage) : null;
  const flush = () => persisted?.flush();
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("beforeunload", (event) => {
    flush();
    if (!fileEditDrafts.hasDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
