"use client";

import "@/styles/cave-chat.css";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/lib/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownBlock, SyntaxBlock } from "@/components/message-bubble";
import { CodeEditor } from "@/components/code-editor";
import { useAnnouncer } from "@/components/ui/live-region";
import { copyText } from "@/lib/clipboard";
import { codeOutline } from "@/lib/code-outline";
import { FILE_CHANGED_ON_DISK, fileEditDrafts, isDraftDirty } from "@/lib/file-edit-drafts";
import { fetchChangesSummary } from "@/lib/changes-summary-fetch";
import { HiddenUnicodeText } from "@/components/ui/hidden-unicode-text";
import { describeHiddenUnicode } from "@/lib/hidden-unicode";

// ─── API response shape (mirrors src/app/api/project-file/route.ts) ───────────

type ProjectFileBody =
  | { ok: true; kind: "text"; content: string; size: number; version?: string; utf8?: boolean }
  | { ok: true; kind: "image"; dataUrl: string; mimeType: string; size: number }
  | { ok: false; error: string };

type Loaded =
  | { kind: "text"; content: string; size: number; version?: string | null; utf8?: boolean }
  | { kind: "image"; dataUrl: string; mimeType: string; size: number };

type ChangedFile = { path: string; status: string; insertions?: number; deletions?: number };

/** A save that hasn't answered by now lets go (#5756): with Save and Cancel
 *  both off while it runs, a hung request held the editor until a reload. */
const SAVE_TIMEOUT_MS = 60_000;

/** Why a save never got an answer, in words rather than an exception name. */
function saveFailureReason(err: unknown): string {
  if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return `no answer in ${SAVE_TIMEOUT_MS / 1000} seconds. It may have been written anyway; saving again checks`;
  }
  if (err instanceof TypeError) return "the server couldn't be reached";
  if (err instanceof SyntaxError) return "the server's answer wasn't readable";
  return err instanceof Error ? err.message : String(err);
}

/** How many changed files the empty-state launchpad lists. */
const LAUNCHPAD_CAP = 6;

const MARKDOWN_EXTS = new Set(["md", "mdx", "markdown"]);

function isMarkdownPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return Boolean(ext && MARKDOWN_EXTS.has(ext));
}

const GENERIC_OPEN_ERROR = "Couldn't open this file.";

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Preview + inline editor for a single file selected in the code rail's Files
 * tab. This is the live "file view mode" — the standalone Code workspace and
 * the comux editor it once deferred to are retired, so editing lives here.
 *
 * Fetches `/api/project-file` whenever `path` changes and renders:
 *  - a muted "Select a file" empty state when no file is selected,
 *  - a skeleton while loading,
 *  - highlighted text (SyntaxBlock), rendered markdown (MarkdownBlock), or an
 *    `<img>` for images,
 *  - a CodeMirror editor when the user hits Edit on a text file, and
 *  - a graceful error state on failure.
 *
 * Text files (except redacted `.env`) are editable: Edit opens the CodeMirror
 * editor, Cmd/Ctrl+S or Save writes back through `POST /api/project-file`, and
 * Cancel discards. Images, unknown extensions, and `.env` are refused by the
 * server; the Edit affordance mirrors those guards client-side.
 *
 * The edit itself lives in `fileEditDrafts`, keyed by path (#5745), not here:
 * leaving the file (another tab, another session, a narrow step, the PR
 * reader) keeps it, and coming back resumes it. Escape leaves the editor for
 * its Save button rather than discarding. A save names the version its edit
 * started from, so a file that changed on disk meanwhile is a conflict to
 * resolve (Overwrite or Reload), never a silent overwrite.
 */
export function RailFilePreview({
  path,
  projectRoot,
  familiarId,
  onOpenPath,
  variant = "rail",
  rangeLabel,
  initialLine,
  changeVersion = null,
}: {
  path: string | null;
  projectRoot: string | null;
  familiarId?: string | null;
  /** Open a file from the empty state's changed-file launchpad (repo-relative
   *  paths are resolved by the owner, same as focusPath events). */
  onOpenPath?: (path: string) => void;
  /**
   * `workbench` adds the Coding Desk's fuller chrome (cave-0rcku): directory,
   * language, a "working tree" provenance chip, an unsaved marker while
   * editing, and the symbol outline. The chat rail keeps the compact `rail`
   * header — the same file, read in a much narrower column.
   */
  variant?: "rail" | "workbench";
  /** Provenance chip for a range handed over from chat, e.g. "L14–19 from chat". */
  rangeLabel?: string | null;
  /** Line to reveal when the file opens (a chat handoff's start line). */
  initialLine?: number | null;
  /** The changes list's version of this file. When it moves, the open file
   *  is read again in place, so the viewer never shows (or edits from) text
   *  the agent has since rewritten (#5745). */
  changeVersion?: string | null;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<Loaded | null>(null);
  // Bumped by the error state's Retry to refetch the same path.
  const [reloadNonce, setReloadNonce] = useState(0);
  // The file was there and a later read found it gone (#5756): deleted by the
  // agent, or moved by a branch switch. The last text stays on screen, but
  // nothing pretends the file still exists, and an edit can't be saved to it.
  const [missingOnDisk, setMissingOnDisk] = useState(false);
  // Read by saveEdit, which every save path goes through (#5778 review):
  // ⌘S and the editor's keymap reached it with the Save button disabled.
  const missingOnDiskRef = useRef(false);
  missingOnDiskRef.current = missingOnDisk;

  // The edit for this file, if any (#5745). It outlives this component.
  const draft = useSyncExternalStore(
    fileEditDrafts.subscribe,
    () => fileEditDrafts.get(path),
    () => null,
  );
  const editing = Boolean(draft);
  const editValue = draft?.content ?? "";
  const saving = draft?.saving ?? false;
  const saveError = draft?.error ?? null;
  // The file on screen now: a save that lands after the reader moved on must
  // not write its text into whatever file is showing (#5745).
  const pathRef = useRef(path);
  pathRef.current = path;
  // The path whose text is loaded. Reading the same path again (its version
  // moved, or Reload) refreshes in place instead of flashing the skeleton.
  const loadedPathRef = useRef<string | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const reloadButtonRef = useRef<HTMLButtonElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const { announce } = useAnnouncer();

  // Empty-state launchpad: with nothing selected, the (otherwise dead) main
  // pane offers the working tree's changed files as one-click opens. Fetched
  // once each time the preview returns to empty — the same status endpoint the
  // changes badge polls, so this adds no new backend surface.
  // Tagged with the project root it describes, so a new root never shows (or
  // opens) the previous root's files while its own request is in flight or
  // after it fails (#5737 review). Change paths are relative to the git
  // TOPLEVEL, which is not the project root when the project sits in a
  // subfolder of its repository (#5729).
  const [launchpad, setLaunchpad] = useState<{
    root: string;
    repoRoot: string | null;
    files: ChangedFile[];
  } | null>(null);
  const current = launchpad && launchpad.root === projectRoot ? launchpad : null;
  const changed = current?.files ?? [];
  const changedRepoRoot = current?.repoRoot ?? null;
  useEffect(() => {
    if (path || !projectRoot || !onOpenPath) return;
    let cancelled = false;
    // Through the shared summary gate (#5745): the desk's own list is read at
    // the same moment, and one request answers both.
    void fetchChangesSummary(projectRoot)
      .then(({ json: raw }) => {
        const json = raw as { ok?: boolean; files?: ChangedFile[]; repoRoot?: string | null };
        if (cancelled || !json.ok || !Array.isArray(json.files)) return;
        setLaunchpad({
          root: projectRoot,
          repoRoot: json.repoRoot ?? null,
          // Deleted files have nothing to preview — opening one would just 404.
          files: json.files.filter((f) => f.status !== "deleted").slice(0, LAUNCHPAD_CAP),
        });
      })
      .catch(() => {
        /* status is a garnish here — the plain hint still renders */
      });
    return () => { cancelled = true; };
  }, [path, projectRoot, onOpenPath]);

  useEffect(() => {
    if (!path) {
      loadedPathRef.current = null;
      setFile(null);
      setError(null);
      setLoading(false);
      setJustSaved(false);
      return;
    }
    let cancelled = false;
    // Switching files no longer drops an edit (#5745): it stays in its draft
    // and comes back with the file.
    const refresh = loadedPathRef.current === path;
    if (!refresh) {
      loadedPathRef.current = null;
      setLoading(true);
      setError(null);
      setFile(null);
      setJustSaved(false);
      setMissingOnDisk(false);
    }
    const params = new URLSearchParams({ path });
    if (familiarId) params.set("familiarId", familiarId);
    void fetch(`/api/project-file?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as ProjectFileBody;
        if (cancelled) return;
        if (!json.ok) {
          // A failed background refresh keeps the text already on screen,
          // but a 404 says the file is gone, and that is shown (#5756).
          if (!refresh) setError(json.error || GENERIC_OPEN_ERROR);
          else if (res.status === 404) setMissingOnDisk(true);
          setLoading(false);
          return;
        }
        loadedPathRef.current = path;
        setMissingOnDisk(false);
        if (json.kind === "image") {
          setFile({ kind: "image", dataUrl: json.dataUrl, mimeType: json.mimeType, size: json.size });
        } else {
          setFile({ kind: "text", content: json.content, size: json.size, version: json.version ?? null, utf8: json.utf8 });
          // An open edit that started from an older version hears about it
          // now, before Save is tried.
          fileEditDrafts.noteDiskVersion(path, json.version ?? null);
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        if (!refresh) setError(GENERIC_OPEN_ERROR);
        setLoading(false);
      });
    return () => { cancelled = true; };
    // projectRoot is not read here (#5745): a late work-root change must not
    // read the file again.
  }, [path, familiarId, reloadNonce, changeVersion]);


  // A redacted .env (server refuses writes) isn't editable; every other text
  // file is. Images and error/loading states have no text content to edit.
  // Not UTF-8 means read-only (#5756): the editor would save every byte it
  // can't show as U+FFFD. The server refuses such a save as well.
  const notUtf8 = file?.kind === "text" && file.utf8 === false;
  const editable = file?.kind === "text" && !fileName(path ?? "").startsWith(".env") && !notUtf8 && !missingOnDisk;

  const startEditing = useCallback(() => {
    if (!path || !file || file.kind !== "text") return;
    fileEditDrafts.begin(path, file.content, file.version ?? null);
    setJustSaved(false);
  }, [file, path]);

  // Cancel discards the edit; it is the only control that does.
  const cancelEditing = useCallback(() => {
    if (path) fileEditDrafts.discard(path);
  }, [path]);

  // Escape leaves the editor and keeps the edit (#5745). Discarding on Escape
  // lost work, and it took the key CodeMirror users press to get out of the
  // editor, since Tab indents there. Focus goes to Save when it can act, to
  // Reload during a conflict, and to the viewer's header while a save is in
  // flight (#5756): focusing a disabled Save did nothing, and left keyboard
  // users trapped in the editor exactly when the conflict needed a decision.
  const leaveEditor = useCallback(() => {
    const target =
      [saveButtonRef.current, reloadButtonRef.current].find((button) => button && !button.disabled) ?? headerRef.current;
    target?.focus();
    announce(
      target === reloadButtonRef.current
        ? "Left the editor. Your changes are kept. The file changed on disk: reload it or overwrite it."
        : "Left the editor. Your changes are kept.",
    );
  }, [announce]);

  const onEditorChange = useCallback(
    (value: string) => {
      if (path) fileEditDrafts.update(path, value);
    },
    [path],
  );

  // Single flight per file comes from the store: Cmd-S and the Save button
  // both go through `startSave`, which refuses while a save is in flight.
  // Every write below names `target`, the file the save was sent for.
  const saveEdit = useCallback(async () => {
    const target = pathRef.current;
    if (!target || missingOnDiskRef.current) return;
    const sending = fileEditDrafts.startSave(target);
    if (!sending) return;
    const label = fileName(target);
    try {
      const res = await fetch("/api/project-file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: target,
          // The file's own line breaks (#5745): a CRLF file stays CRLF.
          content: sending.body,
          familiarId: familiarId ?? undefined,
          expectedVersion: sending.baseVersion ?? undefined,
        }),
        signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
      });
      const json = (await res.json()) as { ok: boolean; size?: number; version?: string | null; error?: string; conflict?: boolean };
      if (!res.ok || !json.ok) {
        const conflict = json.conflict === true;
        fileEditDrafts.fail(
          target,
          sending.id,
          conflict ? FILE_CHANGED_ON_DISK : json.error ?? `save failed (${res.status})`,
          conflict,
          // The disk's version, so Overwrite writes over exactly that (#5756).
          conflict ? json.version ?? null : null,
        );
        announce(
          conflict
            ? `Couldn't save ${label}: it changed on disk since you started editing.`
            : `Couldn't save ${label}: ${json.error ?? res.status}`,
          "assertive",
        );
        return;
      }
      const stillOpen = fileEditDrafts.settle(target, sending.id, sending.content, json.version ?? null);
      // Only the file the save was for takes its text, and only if it is
      // still the one on screen; elsewhere it is read fresh on return.
      if (pathRef.current === target) {
        setFile({ kind: "text", content: sending.body, size: json.size ?? sending.body.length, version: json.version ?? null });
        if (!stillOpen) setJustSaved(true);
      }
      announce(stillOpen ? `Saved ${label}. What you typed while it saved is not saved yet.` : `Saved ${label}.`);
      // The save changed the working tree: the changes list, the tree's
      // letters and the diffstat follow now, not at the next poll, which an
      // idle session never runs (#5745).
      window.dispatchEvent(new CustomEvent("cave:changes-refresh"));
    } catch (err) {
      const reason = saveFailureReason(err);
      fileEditDrafts.fail(target, sending.id, `Couldn't save: ${reason}.`);
      announce(`Couldn't save ${label}: ${reason}.`, "assertive");
    }
  }, [familiarId, announce]);

  const onEditorSave = useCallback(() => void saveEdit(), [saveEdit]);

  // ⌘S anywhere on the desk (#5756): outside the editor it used to open the
  // browser's "Save page" instead. It saves the open edit when there is one,
  // and otherwise does nothing. The editor's own keymap handles ⌘S inside it.
  useEffect(() => {
    if (variant !== "workbench") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "s" || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.defaultPrevented) return;
      event.preventDefault();
      const target = pathRef.current;
      if (target && isDraftDirty(fileEditDrafts.get(target))) void saveEdit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveEdit, variant]);

  // A conflict is resolved one of two ways: keep my edit and write it over the
  // newer file, or drop my edit and read the file as it is now.
  const overwriteDisk = useCallback(() => {
    if (!path) return;
    fileEditDrafts.acceptDisk(path);
    void saveEdit();
  }, [path, saveEdit]);
  const reloadFromDisk = useCallback(() => {
    if (!path) return;
    fileEditDrafts.discard(path);
    setReloadNonce((n) => n + 1);
  }, [path]);

  // Auto-clear the "Saved" confirmation a moment after it shows.
  useEffect(() => {
    if (!justSaved) return;
    const t = window.setTimeout(() => setJustSaved(false), 1800);
    return () => window.clearTimeout(t);
  }, [justSaved]);

  // ── Outline (workbench chrome only) ────────────────────────────────────────
  // Derived from the text already on screen, so it can never describe a version
  // the reader is not looking at. Hidden entirely when the language yields no
  // symbols — an empty outline control reads as a broken feature.
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const outline = useMemo(
    () =>
      variant === "workbench" && file?.kind === "text" && path
        ? codeOutline(file.content, fileName(path))
        : [],
    [file, path, variant],
  );
  // A new file starts from the handoff's line (if any) and a closed outline;
  // carrying the previous file's open outline over would announce symbols that
  // belong to something else.
  useEffect(() => {
    setActiveLine(initialLine ?? null);
    setOutlineOpen(false);
  }, [initialLine, path]);

  const copyPreview = useCallback(() => {
    if (!file || file.kind !== "text") return;
    void copyText(file.content).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [file]);
  // The way out for an edit whose file is gone (#5756): there is nowhere to
  // save it, so it can be taken elsewhere.
  const copyDraft = useCallback(() => {
    if (!draft) return;
    void copyText(draft.content).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [draft]);

  if (!path) {
    return (
      <div className="workspace-rail__files-empty">
        <Icon name="ph:file" width={22} aria-hidden />
        <p>Select a file from the tree to preview it here.</p>
        {onOpenPath && changed.length > 0 ? (
          <div className="workspace-rail__empty-changes">
            <p className="workspace-rail__empty-changes-title">Or pick up where the work is:</p>
            <ul className="workspace-rail__empty-changes-list">
              {changed.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    className="focus-ring workspace-rail__empty-change"
                    onClick={() =>
                      onOpenPath(changedRepoRoot ? `${changedRepoRoot.replace(/\/+$/, "")}/${f.path}` : f.path)
                    }
                    title={f.path}
                  >
                    <Icon name="ph:git-diff" width={11} aria-hidden />
                    <span className="workspace-rail__empty-change-name">{fileName(f.path)}</span>
                    <span className="workspace-rail__empty-change-dir">
                      {f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""}
                    </span>
                    {typeof f.insertions === "number" || typeof f.deletions === "number" ? (
                      <span className="workspace-rail__empty-change-stat">
                        +{f.insertions ?? 0} −{f.deletions ?? 0}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  const name = fileName(path);
  const workbench = variant === "workbench";
  const absoluteDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  // The desk prints the directory relative to the work root (#5718): the
  // absolute `.worktrees/<branch>/…` prefix is the same for every file in the
  // session and was long enough to push the name and the actions off the
  // header. The full path stays in the tooltip.
  const root = projectRoot?.replace(/\/+$/, "") ?? "";
  const dir =
    workbench && root && (absoluteDir === root || absoluteDir.startsWith(`${root}/`))
      ? absoluteDir.slice(root.length + 1)
      : absoluteDir;

  return (
    <div className="workspace-rail__preview" data-variant={variant}>
      {/* Focusable from script only: where Escape leaves the editor when no
          action can take focus (#5756). */}
      <header ref={headerRef} tabIndex={-1} className="focus-ring-inset workspace-rail__preview-head">
        <Icon
          name={file?.kind === "image" ? "ph:file-image" : isMarkdownPath(path) ? "ph:file-text" : "ph:file-code"}
          width={12}
          aria-hidden
        />
        <span className="workspace-rail__preview-name" title={describeHiddenUnicode(path)}><HiddenUnicodeText text={name} /></span>
        {workbench ? (
          <>
            {dir ? (
              <span className="workspace-rail__preview-dir" title={describeHiddenUnicode(path)}>
                <HiddenUnicodeText text={dir} />
              </span>
            ) : null}
            {/* Provenance, always on: this pane reads the working tree, not a
                transcript snapshot, and that distinction is the whole point of
                opening a file here rather than reading the chat block. */}
            <span className="workspace-rail__preview-chip">working tree</span>
            {rangeLabel ? (
              <span className="workspace-rail__preview-chip workspace-rail__preview-chip--accent">
                {rangeLabel}
              </span>
            ) : null}
            {editing ? (
              <span className="workspace-rail__preview-chip workspace-rail__preview-chip--warn">
                editing · unsaved
              </span>
            ) : null}
            {outline.length > 0 && !editing ? (
              <button
                type="button"
                className="focus-ring workspace-rail__preview-action"
                aria-expanded={outlineOpen}
                // The visible word can collapse in a narrow viewer (#5718);
                // the accessible name keeps it, and still contains the label.
                aria-label={`Outline, ${outline.length} ${outline.length === 1 ? "symbol" : "symbols"}`}
                onClick={() => setOutlineOpen((open) => !open)}
              >
                <Icon name="ph:list-bullets" width={11} aria-hidden />
                <span className="workspace-rail__preview-action-label">Outline</span>
                <span className="workspace-rail__preview-outline-count">{outline.length}</span>
              </button>
            ) : null}
          </>
        ) : null}
        {(file?.kind === "text" || editing) && (
          <div className="workspace-rail__preview-actions">
            {editing ? (
              <>
                {saveError && !draft?.conflict && (
                  <span className="workspace-rail__preview-saveerr" role="alert" title={saveError}>{saveError}</span>
                )}
                <button
                  type="button"
                  className="focus-ring workspace-rail__preview-action"
                  title="Discard your changes"
                  // Not mid-save: the request cannot be called back, and its
                  // answer belongs to this edit (#5746 review).
                  disabled={saving}
                  onClick={cancelEditing}
                >
                  Cancel
                </button>
                <button
                  ref={saveButtonRef}
                  type="button"
                  className="focus-ring workspace-rail__preview-action workspace-rail__preview-action--primary"
                  onClick={() => void saveEdit()}
                  disabled={saving || draft?.conflict === true || missingOnDisk}
                >
                  <Icon name={saving ? "ph:arrow-clockwise" : "ph:floppy-disk-bold"} width={11} className={saving ? "animate-spin" : ""} aria-hidden />
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <>
                {justSaved && (
                  <span className="workspace-rail__preview-saved">
                    <Icon name="ph:check" width={11} aria-hidden />
                    Saved
                  </span>
                )}
                {notUtf8 && (
                  <span
                    className="workspace-rail__preview-readonly"
                    title="This file isn't UTF-8 text. Editing it here would change bytes the editor can't show."
                  >
                    Read-only: not UTF-8
                  </span>
                )}
                {editable && (
                  <button
                    type="button"
                    className="focus-ring workspace-rail__preview-action"
                    onClick={startEditing}
                  >
                    <Icon name="ph:pencil-simple" width={11} aria-hidden />
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  className="focus-ring workspace-rail__preview-action"
                  onClick={copyPreview}
                >
                  <Icon name="ph:copy" width={11} aria-hidden />
                  {copied ? "Copied" : "Copy"}
                </button>
              </>
            )}
          </div>
        )}
      </header>
      {/* A conflict gets its own row: the reason and both ways out have to fit
          in a narrow viewer, where the header has no room for them (#5745). */}
      {missingOnDisk ? (
        <div className="workspace-rail__preview-conflict" role="status">
          <Icon name="ph:file-x" width={12} aria-hidden />
          <span className="workspace-rail__preview-conflict-text">
            {draft
              ? "This file is no longer on disk. Your edit is kept: copy it, or Cancel to drop it."
              : "This file is no longer on disk. This is the last version read."}
          </span>
          {draft ? (
            <span className="workspace-rail__preview-conflict-actions">
              <button type="button" className="focus-ring workspace-rail__preview-action" onClick={copyDraft}>
                {copied ? "Copied" : "Copy edit"}
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
      {/* Not beside the missing-file row (#5778 review): there is no disk
          version to reload or overwrite. */}
      {draft?.conflict && !missingOnDisk ? (
        <div className="workspace-rail__preview-conflict" role="alert">
          <Icon name="ph:warning-circle" width={12} aria-hidden />
          <span className="workspace-rail__preview-conflict-text">{saveError ?? FILE_CHANGED_ON_DISK}</span>
          <span className="workspace-rail__preview-conflict-actions">
            <button
              ref={reloadButtonRef}
              type="button"
              className="focus-ring workspace-rail__preview-action"
              title="Drop your changes and read the file as it is on disk now"
              onClick={reloadFromDisk}
            >
              Reload
            </button>
            <button
              type="button"
              className="focus-ring workspace-rail__preview-action"
              title="Keep your changes and write them over the newer file"
              disabled={saving}
              onClick={overwriteDisk}
            >
              Overwrite
            </button>
          </span>
        </div>
      ) : null}
      {workbench && outlineOpen && outline.length > 0 && !editing ? (
        <div className="workspace-rail__outline" role="group" aria-label="File outline">
          {outline.map((symbol) => (
            <button
              key={`${symbol.kind}:${symbol.name}:${symbol.line}`}
              type="button"
              className="focus-ring workspace-rail__outline-chip"
              aria-current={activeLine === symbol.line ? "true" : undefined}
              onClick={() => setActiveLine(symbol.line)}
            >
              <span className="workspace-rail__outline-kind">{symbol.kind}</span>
              <span className="workspace-rail__outline-name">{symbol.name}</span>
              <span className="workspace-rail__outline-line">L{symbol.line}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div
        className={`workspace-rail__preview-body${editing ? " workspace-rail__preview-body--edit" : ""}${
          // Reading a highlighted code file: let the pane own the height so the
          // block fills it and scrolls internally, instead of keeping the chat
          // transcript's 520px clamp + "Show more" footer (see cave-chat.css).
          !loading && !error && !editing && file?.kind === "text" && !isMarkdownPath(path)
            ? " workspace-rail__preview-body--code"
            : ""
        }`}
      >
        {editing ? (
          // The draft is on hand before the file is read again, so the edit
          // comes back at once (#5745).
          <div className="workspace-rail__preview-editor">
            <CodeEditor
              key={path}
              value={editValue}
              filename={name}
              onChange={onEditorChange}
              onSave={onEditorSave}
              onCancel={leaveEditor}
            />
          </div>
        ) : loading ? (
          <div className="workspace-rail__preview-skeleton" aria-busy="true" aria-label="Loading file">
            {["94%", "82%", "97%", "70%", "88%", "60%"].map((w, i) => (
              <Skeleton key={i} variant="text" width={w} />
            ))}
          </div>
        ) : error ? (
          <div className="workspace-rail__preview-error" role="alert">
            <Icon name="ph:warning-circle" width={24} aria-hidden />
            {/* A headline, the detail, and a way to try again (#5729): a bare
                server message is not a recovery path. */}
            <p className="workspace-rail__preview-error-title">Couldn&rsquo;t open {name}</p>
            {error !== GENERIC_OPEN_ERROR ? <p className="workspace-rail__preview-error-detail">{error}</p> : null}
            <button
              type="button"
              className="focus-ring workspace-rail__preview-error-retry"
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              Retry
            </button>
          </div>
        ) : file?.kind === "image" ? (
          <div className="workspace-rail__preview-image">
            <img src={file.dataUrl} alt={`Preview of ${name}`} />
            <span className="workspace-rail__preview-meta">
              {file.mimeType}
              {typeof file.size === "number" ? ` · ${file.size.toLocaleString()} bytes` : ""}
            </span>
          </div>
        ) : file?.kind === "text" && isMarkdownPath(path) ? (
          // No 72ch clamp here — the rail preview is a pane, not a transcript
          // column; clamping left a dead band to the right of wide panes.
          <MarkdownBlock text={file.content} className="comux-md" />
        ) : file?.kind === "text" ? (
          <SyntaxBlock
            text={file.content}
            lang={path.split(".").pop()}
            className="leading-relaxed"
            highlightLine={activeLine ?? undefined}
          />
        ) : null}
      </div>
    </div>
  );
}
