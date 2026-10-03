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

  const emit = () => {
    dirtyPaths = new Set([...drafts.values()].filter(isDraftDirty).map((draft) => draft.path));
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
    fail(path: string, id: number, error: string, conflict = false) {
      if (drafts.get(path)?.id !== id) return;
      patch(path, { saving: false, error, conflict });
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
      if (!draft.conflict) patch(path, { conflict: true, error: FILE_CHANGED_ON_DISK });
    },
    /** Keep my edit and write it over the newer file (no version precondition). */
    acceptDisk(path: string) {
      patch(path, { baseVersion: null, conflict: false, error: null });
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type FileEditDraftStore = ReturnType<typeof createFileEditDraftStore>;

export const fileEditDrafts = createFileEditDraftStore();

// One unload guard for the page, installed with the store rather than by a
// viewer (#5746 review): drafts outlive the viewer (the Work and GitHub tabs
// unmount it), so the warning has to as well.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (!fileEditDrafts.hasDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}
