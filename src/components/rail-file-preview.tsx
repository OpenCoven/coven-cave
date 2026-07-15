"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownBlock, SyntaxBlock } from "@/components/message-bubble";
import { CodeEditor } from "@/components/code-editor";
import { useAnnouncer } from "@/components/ui/live-region";
import { copyText } from "@/lib/clipboard";

// ─── API response shape (mirrors src/app/api/project-file/route.ts) ───────────

type ProjectFileBody =
  | { ok: true; kind: "text"; content: string; size: number }
  | { ok: true; kind: "image"; dataUrl: string; mimeType: string; size: number }
  | { ok: false; error: string };

type Loaded =
  | { kind: "text"; content: string; size: number }
  | { kind: "image"; dataUrl: string; mimeType: string; size: number };

type ChangedFile = { path: string; status: string; insertions?: number; deletions?: number };

/** How many changed files the empty-state launchpad lists. */
const LAUNCHPAD_CAP = 6;

const MARKDOWN_EXTS = new Set(["md", "mdx", "markdown"]);

function isMarkdownPath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return Boolean(ext && MARKDOWN_EXTS.has(ext));
}

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
 * Escape or Cancel discards. Images, unknown extensions, and `.env` are
 * refused by the server; the Edit affordance mirrors those guards client-side.
 */
export function RailFilePreview({
  path,
  projectRoot,
  familiarId,
  onOpenPath,
}: {
  path: string | null;
  projectRoot: string | null;
  familiarId?: string | null;
  /** Open a file from the empty state's changed-file launchpad (repo-relative
   *  paths are resolved by the owner, same as focusPath events). */
  onOpenPath?: (path: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<Loaded | null>(null);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const { announce } = useAnnouncer();

  // Empty-state launchpad: with nothing selected, the (otherwise dead) main
  // pane offers the working tree's changed files as one-click opens. Fetched
  // once each time the preview returns to empty — the same status endpoint the
  // changes badge polls, so this adds no new backend surface.
  const [changed, setChanged] = useState<ChangedFile[]>([]);
  useEffect(() => {
    if (path || !projectRoot || !onOpenPath) return;
    let cancelled = false;
    void fetch(`/api/changes?projectRoot=${encodeURIComponent(projectRoot)}`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as { ok?: boolean; files?: ChangedFile[] };
        if (cancelled || !json.ok || !Array.isArray(json.files)) return;
        // Deleted files have nothing to preview — opening one would just 404.
        setChanged(json.files.filter((f) => f.status !== "deleted").slice(0, LAUNCHPAD_CAP));
      })
      .catch(() => {
        /* status is a garnish here — the plain hint still renders */
      });
    return () => { cancelled = true; };
  }, [path, projectRoot, onOpenPath]);

  useEffect(() => {
    if (!path) {
      setFile(null);
      setError(null);
      setLoading(false);
      setEditing(false);
      setSaveError(null);
      setJustSaved(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFile(null);
    // Switching files drops any in-progress edit — the tree selection owns the
    // decision to move on, so the editor follows it rather than trapping focus.
    setEditing(false);
    setSaveError(null);
    setJustSaved(false);
    const params = new URLSearchParams({ path });
    if (familiarId) params.set("familiarId", familiarId);
    void fetch(`/api/project-file?${params.toString()}`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as ProjectFileBody;
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error || "Couldn't open this file.");
          setLoading(false);
          return;
        }
        setFile(json.kind === "image"
          ? { kind: "image", dataUrl: json.dataUrl, mimeType: json.mimeType, size: json.size }
          : { kind: "text", content: json.content, size: json.size });
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Couldn't open this file.");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [path, familiarId, projectRoot]);

  // A redacted .env (server refuses writes) isn't editable; every other text
  // file is. Images and error/loading states have no text content to edit.
  const editable = file?.kind === "text" && !fileName(path ?? "").startsWith(".env");

  const startEditing = useCallback(() => {
    if (!file || file.kind !== "text") return;
    setEditValue(file.content);
    setSaveError(null);
    setJustSaved(false);
    setEditing(true);
  }, [file]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setSaveError(null);
  }, []);

  // Synchronous in-flight guard: Cmd-S in the editor calls saveEdit directly,
  // bypassing the Save button's disabled={saving}. A ref (not the saving state,
  // which would be stale in this callback) blocks concurrent POSTs.
  const savingRef = useRef(false);
  const saveEdit = useCallback(async () => {
    if (!path || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/project-file", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, content: editValue, familiarId: familiarId ?? undefined }),
      });
      const json = (await res.json()) as { ok: boolean; size?: number; error?: string };
      if (!res.ok || !json.ok) {
        setSaveError(json.error ?? `save failed (${res.status})`);
        announce(`Couldn't save the file: ${json.error ?? res.status}`, "assertive");
        return;
      }
      // Commit the edit into the loaded file so a cancel/reopen shows saved text.
      setFile({ kind: "text", content: editValue, size: json.size ?? editValue.length });
      setEditing(false);
      setJustSaved(true);
      announce("File saved.");
    } catch (err) {
      setSaveError(String(err));
      announce(`Couldn't save the file: ${String(err)}`, "assertive");
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  }, [path, editValue, familiarId, announce]);

  // Auto-clear the "Saved" confirmation a moment after it shows.
  useEffect(() => {
    if (!justSaved) return;
    const t = window.setTimeout(() => setJustSaved(false), 1800);
    return () => window.clearTimeout(t);
  }, [justSaved]);

  const copyPreview = useCallback(() => {
    if (!file || file.kind !== "text") return;
    void copyText(file.content).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [file]);

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
                    onClick={() => onOpenPath(f.path)}
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

  return (
    <div className="workspace-rail__preview">
      <header className="workspace-rail__preview-head">
        <Icon
          name={file?.kind === "image" ? "ph:file-image" : isMarkdownPath(path) ? "ph:file-text" : "ph:file-code"}
          width={12}
          aria-hidden
        />
        <span className="workspace-rail__preview-name" title={path}>{name}</span>
        {(file?.kind === "text" || editing) && (
          <div className="workspace-rail__preview-actions">
            {editing ? (
              <>
                {saveError && (
                  <span className="workspace-rail__preview-saveerr" role="alert" title={saveError}>{saveError}</span>
                )}
                <button
                  type="button"
                  className="focus-ring workspace-rail__preview-action"
                  onClick={cancelEditing}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="focus-ring workspace-rail__preview-action workspace-rail__preview-action--primary"
                  onClick={() => void saveEdit()}
                  disabled={saving}
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
        {loading ? (
          <div className="workspace-rail__preview-skeleton" aria-busy="true" aria-label="Loading file">
            {["94%", "82%", "97%", "70%", "88%", "60%"].map((w, i) => (
              <Skeleton key={i} variant="text" width={w} />
            ))}
          </div>
        ) : error ? (
          <div className="workspace-rail__preview-error" role="alert">
            <Icon name="ph:warning-circle" width={24} aria-hidden />
            <p>{error}</p>
          </div>
        ) : editing ? (
          <div className="workspace-rail__preview-editor">
            <CodeEditor
              value={editValue}
              filename={name}
              onChange={setEditValue}
              onSave={() => void saveEdit()}
              onCancel={cancelEditing}
            />
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
          <SyntaxBlock text={file.content} lang={path.split(".").pop()} className="leading-relaxed" />
        ) : null}
      </div>
    </div>
  );
}
