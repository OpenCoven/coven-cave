"use client";

/**
 * MdEditor — the Cave's OpenKnowledge-style markdown editor shell.
 *
 * One shared editing experience for markdown documents (memory files,
 * knowledge vault entries, journal reflections):
 *
 *   - VISUAL mode: Notion-like WYSIWYG body editing (Milkdown Crepe) with a
 *     title + tags frontmatter header.
 *   - MARKDOWN mode: the raw document (frontmatter included) in the shared
 *     CodeMirror editor.
 *   - Footer: word · char · ~token counts, dirty/save state, source label.
 *
 * The raw document string is the canonical state — an untouched document
 * round-trips byte-identical. Visual/body and header edits rewrite the raw
 * text through the md-frontmatter helpers; MARKDOWN mode edits it directly.
 *
 * Parents own transport: `onSave(raw)` persists and reports back. Remount
 * with a fresh `key` when the underlying document identity changes.
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/** Trailing debounce before an autosave fires once typing pauses. */
const AUTOSAVE_DEBOUNCE_MS = 1200;
import { Icon } from "@/lib/icon";
import { CodeEditor } from "@/components/code-editor";
import {
  normalizeMdTags,
  parseMdDocument,
  serializeMdDocument,
} from "@/lib/md-frontmatter";
import { computeMdDocStats, formatMdDocStats } from "@/lib/md-doc-stats";
import { diffLines, mergeThreeWay, type LineDiffOp } from "@/lib/line-diff";

const MdEditorVisual = dynamic(() => import("./md-editor-visual"), {
  ssr: false,
  loading: () => (
    // Skeleton lines instead of a bare text flash while the editor chunk loads.
    <div className="space-y-2.5 p-4" aria-label="Loading editor" aria-busy="true">
      {["92%", "85%", "97%", "70%"].map((w, i) => (
        <Skeleton key={i} variant="text" width={w} />
      ))}
    </div>
  ),
});

export type MdEditorMode = "visual" | "markdown";

/** A concurrent-write conflict reported by the transport (e.g. the memory
 *  file API's 409): the document changed underneath the editor. `currentText`
 *  is the version now on disk. */
export type MdEditorConflict = { currentText: string };

export type MdEditorSaveResult = { ok: boolean; error?: string; conflict?: MdEditorConflict };

const MODE_PREF_KEY = "cave:md-editor:mode";

export function readMdEditorModePref(): MdEditorMode {
  try {
    if (typeof window !== "undefined" && window.localStorage.getItem(MODE_PREF_KEY) === "markdown") {
      return "markdown";
    }
  } catch {
    /* private mode — default wins */
  }
  return "visual";
}

function writeMdEditorModePref(mode: MdEditorMode) {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(MODE_PREF_KEY, mode);
  } catch {
    /* private mode — session-only */
  }
}

export type MdEditorProps = {
  /** Raw markdown document, frontmatter included. Captured as the baseline. */
  value: string;
  readOnly?: boolean;
  /** Show the title/tags frontmatter header (off for e.g. journal bodies). */
  showHeader?: boolean;
  /** Footer source chip, e.g. "Coven native memory" or a compact path. */
  sourceLabel?: string;
  onSave: (raw: string) => Promise<MdEditorSaveResult>;
  /** Optional cancel affordance (Escape in MARKDOWN mode / footer button). */
  onCancel?: () => void;
  /** Observe every raw-document change (e.g. to mirror into caller state). */
  onChange?: (raw: string) => void;
  /**
   * Persist edits automatically a short while after typing stops, in addition
   * to the explicit Save button. Only safe for **idempotent** surfaces whose
   * `onSave` has no disruptive side effects (no editor remount/close) —
   * knowledge and journal docs. Memory files stay explicit-save (agents write
   * those roots concurrently; a silent autosave would race an mtime conflict).
   */
  autoSave?: boolean;
};

export function MdEditor({
  value,
  readOnly = false,
  showHeader = true,
  sourceLabel,
  onSave,
  onCancel,
  onChange,
  autoSave = false,
}: MdEditorProps) {
  const [raw, setRaw] = useState(value);
  const [baseline, setBaseline] = useState(value);
  const [mode, setMode] = useState<MdEditorMode>(() => readMdEditorModePref());
  // Bumped when VISUAL mode needs a fresh Crepe mount (mode round-trips).
  const [visualEpoch, setVisualEpoch] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  // A 409-style concurrent-write conflict: the transport reported the document
  // changed underneath us. While set, the body shows the resolution panel.
  const [conflict, setConflict] = useState<MdEditorConflict | null>(null);
  const rawRef = useRef(raw);
  rawRef.current = raw;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [tagDraft, setTagDraft] = useState("");

  const updateRaw = useCallback((next: string) => {
    setRaw(next);
    onChangeRef.current?.(next);
  }, []);

  const doc = useMemo(() => parseMdDocument(raw), [raw]);
  const stats = useMemo(() => computeMdDocStats(doc.body), [doc.body]);
  const dirty = raw !== baseline;

  const applyHeader = useCallback(
    (header: { title?: string | null; tags?: string[] }) => {
      const next = parseMdDocument(rawRef.current);
      if (header.title !== undefined) {
        next.title = header.title && header.title.trim() ? header.title.trim() : null;
      }
      if (header.tags !== undefined) next.tags = normalizeMdTags(header.tags);
      updateRaw(serializeMdDocument(next));
    },
    [updateRaw],
  );

  const onBodyChange = useCallback((body: string) => {
    const next = parseMdDocument(rawRef.current);
    // Crepe reports the body it was mounted with; only the body changes here.
    next.body = body;
    updateRaw(next.hasFrontmatter || next.title !== null || next.tags.length > 0 || Object.keys(next.rest).length > 0
      ? serializeMdDocument(next)
      : body);
  }, [updateRaw]);

  const switchMode = useCallback((next: MdEditorMode) => {
    setMode((prev) => {
      if (prev === next) return prev;
      if (next === "visual") setVisualEpoch((n) => n + 1);
      writeMdEditorModePref(next);
      return next;
    });
  }, []);

  const save = useCallback(async () => {
    if (readOnly || saving) return;
    const snapshot = rawRef.current;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await onSave(snapshot);
      if (result.ok) {
        setBaseline(snapshot);
        setConflict(null);
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 1500);
      } else if (result.conflict) {
        setConflict(result.conflict);
      } else {
        setSaveError(result.error ?? "Save failed");
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [onSave, readOnly, saving]);

  // ── Conflict resolution ──────────────────────────────────────────────────
  // Keep mine: overwrite the disk version with the draft (the transport
  // re-baselined on the conflict, so a plain re-save lands). Take theirs:
  // adopt the disk version and drop the draft. Merge: three-way merge of
  // baseline/draft/disk; overlapping edits get git-style markers to resolve.
  const resolveKeepMine = useCallback(() => {
    setConflict(null);
    void save();
  }, [save]);

  const resolveTakeTheirs = useCallback(() => {
    setConflict((current) => {
      if (current) {
        updateRaw(current.currentText);
        setBaseline(current.currentText);
        setVisualEpoch((n) => n + 1);
      }
      return null;
    });
  }, [updateRaw]);

  const resolveMerge = useCallback(() => {
    setConflict((current) => {
      if (current) {
        const merged = mergeThreeWay(baseline, rawRef.current, current.currentText);
        updateRaw(merged.text);
        setVisualEpoch((n) => n + 1);
        // Conflict markers are raw-text constructs — resolve them in MARKDOWN
        // mode so the visual editor doesn't normalize them away.
        if (merged.conflicts > 0) switchMode("markdown");
      }
      return null;
    });
  }, [baseline, switchMode, updateRaw]);

  // Autosave: persist a short while after typing stops (idempotent surfaces
  // only — see the `autoSave` prop doc). A ref keeps the effect from
  // re-subscribing on every `save` identity change; guarding on `saving` means
  // we never stack a second request on an in-flight one, and because `saving`
  // is a dependency the effect re-runs when a save settles and reschedules if
  // the doc advanced meanwhile. Empty docs are skipped — the save handlers
  // reject them, so autosaving one would just flash an error. An open conflict
  // panel also pauses autosave: overwriting is an explicit choice.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!autoSave || readOnly || saving || conflict !== null || !dirty || !raw.trim()) return;
    const timer = window.setTimeout(() => void saveRef.current(), AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [autoSave, readOnly, saving, conflict, dirty, raw]);

  const addTagsFromDraft = useCallback(() => {
    const additions = normalizeMdTags(tagDraft);
    if (additions.length === 0) return;
    const current = parseMdDocument(rawRef.current).tags;
    const merged = [...current];
    for (const tag of additions) if (!merged.includes(tag)) merged.push(tag);
    applyHeader({ tags: merged });
    setTagDraft("");
  }, [applyHeader, tagDraft]);

  const removeTag = useCallback(
    (tag: string) => {
      applyHeader({ tags: parseMdDocument(rawRef.current).tags.filter((t) => t !== tag) });
    },
    [applyHeader],
  );

  return (
    <div
      className="md-editor flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          void save();
        }
      }}
    >
      <div className="md-editor__topbar flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-3 py-1.5">
        <div className="inline-flex overflow-hidden rounded-md border border-[var(--border-hairline)] font-mono text-[10px] uppercase tracking-wide">
          {(["visual", "markdown"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => switchMode(m)}
              className={`focus-ring-inset px-2 py-1 transition-colors ${
                mode === m
                  ? "bg-[var(--accent-presence)]/15 text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
              }`}
            >
              {m === "visual" ? "Visual" : "Markdown"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="focus-ring inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
          ) : null}
          {!readOnly ? (
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--text-secondary)] enabled:hover:bg-[var(--bg-elevated)] enabled:hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              <Icon name="ph:floppy-disk-bold" width={12} aria-hidden />
              {saving ? "Saving…" : "Save"}
            </button>
          ) : null}
        </div>
      </div>

      {showHeader && mode === "visual" ? (
        <div className="md-editor__header shrink-0 space-y-1.5 border-b border-[var(--border-hairline)] px-4 py-2.5">
          <div className="flex items-baseline gap-3">
            <span className="w-8 shrink-0 text-[10px] text-[var(--text-muted)]">title</span>
            <input
              type="text"
              value={doc.title ?? ""}
              readOnly={readOnly}
              placeholder="Untitled"
              aria-label="Document title"
              onChange={(e) => applyHeader({ title: e.target.value })}
              className="focus-ring min-w-0 flex-1 rounded-sm bg-transparent text-[14px] font-semibold text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="w-8 shrink-0 text-[10px] text-[var(--text-muted)]">tags</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {doc.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-0.5 rounded-full bg-[var(--accent-presence)]/12 px-2 py-0.5 text-[10px] text-[var(--accent-presence-soft)]"
                >
                  #{tag}
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      aria-label={`Remove tag ${tag}`}
                      className="focus-ring rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    >
                      <Icon name="ph:x" width={9} aria-hidden />
                    </button>
                  ) : null}
                </span>
              ))}
              {!readOnly ? (
                <input
                  type="text"
                  value={tagDraft}
                  placeholder={doc.tags.length === 0 ? "Add tags…" : "+"}
                  aria-label="Add tag"
                  onChange={(e) => setTagDraft(e.target.value)}
                  onBlur={addTagsFromDraft}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTagsFromDraft();
                    }
                  }}
                  className="focus-ring w-20 rounded-sm bg-transparent text-[11px] text-[var(--text-secondary)] placeholder:text-[var(--text-muted)]"
                />
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {conflict ? (
          <MdEditorConflictPanel
            mine={raw}
            theirs={conflict.currentText}
            onKeepMine={resolveKeepMine}
            onTakeTheirs={resolveTakeTheirs}
            onMerge={resolveMerge}
            onDismiss={() => setConflict(null)}
          />
        ) : mode === "visual" ? (
          <MdEditorVisual
            key={visualEpoch}
            defaultValue={doc.body}
            readOnly={readOnly}
            onChange={onBodyChange}
            onSave={() => void save()}
          />
        ) : (
          <CodeEditor
            value={raw}
            filename="document.md"
            onChange={(next) => {
              if (!readOnly) updateRaw(next);
            }}
            onSave={() => void save()}
            onCancel={() => onCancel?.()}
          />
        )}
      </div>

      <div className="md-editor__footer flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border-hairline)] px-3 py-1.5 text-[10px] text-[var(--text-muted)]">
        <div className="flex min-w-0 items-center gap-1.5">
          {sourceLabel ? (
            <span className="truncate rounded bg-[var(--bg-elevated)] px-1.5 py-0.5">{sourceLabel}</span>
          ) : null}
          {saveError ? (
            <span role="alert" className="inline-flex items-center gap-1 text-[var(--color-warning)]">
              <Icon name="ph:warning-circle" width={11} aria-hidden />
              {saveError}
            </span>
          ) : savedFlash ? (
            // role=status: saves (incl. debounced autosaves) were visual-only —
            // the flash is the sole confirmation, so SRs should hear it too.
            <span role="status" className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
              <Icon name="ph:check" width={11} aria-hidden />
              Saved
            </span>
          ) : saving ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="ph:floppy-disk-bold" width={11} aria-hidden />
              Saving…
            </span>
          ) : dirty && !readOnly ? (
            <span>{autoSave ? "Autosaving…" : "Unsaved changes"}</span>
          ) : null}
        </div>
        <span className="shrink-0 font-mono">{formatMdDocStats(stats)}</span>
      </div>
    </div>
  );
}

// ── Conflict panel ───────────────────────────────────────────────────────────

/** Collapse runs of unchanged lines longer than this to a "⋯ n unchanged" row
 *  so the conflict diff stays focused on the divergence. */
const CONFLICT_CTX_RUN = 4;

type ConflictDiffRow =
  | { kind: "op"; op: LineDiffOp }
  | { kind: "skip"; count: number };

function buildConflictRows(ops: LineDiffOp[]): ConflictDiffRow[] {
  const rows: ConflictDiffRow[] = [];
  let run: LineDiffOp[] = [];
  const flush = (trailing: boolean) => {
    if (run.length <= CONFLICT_CTX_RUN) {
      for (const op of run) rows.push({ kind: "op", op });
    } else if (trailing) {
      // Keep a couple of context lines at the edge of a change, skip the rest.
      for (const op of run.slice(0, 2)) rows.push({ kind: "op", op });
      rows.push({ kind: "skip", count: run.length - 2 });
    } else {
      rows.push({ kind: "skip", count: run.length - 2 });
      for (const op of run.slice(-2)) rows.push({ kind: "op", op });
    }
    run = [];
  };
  for (const op of ops) {
    if (op.type === "ctx") {
      run.push(op);
    } else {
      flush(false);
      rows.push({ kind: "op", op });
    }
  }
  flush(true);
  return rows;
}

/**
 * Concurrent-write conflict resolver: shows the difference between the disk
 * version ("theirs") and the local draft ("mine") and offers the three
 * resolutions. Rendered in place of the editor body while a conflict is open.
 */
function MdEditorConflictPanel({
  mine,
  theirs,
  onKeepMine,
  onTakeTheirs,
  onMerge,
  onDismiss,
}: {
  mine: string;
  theirs: string;
  onKeepMine: () => void;
  onTakeTheirs: () => void;
  onMerge: () => void;
  onDismiss: () => void;
}) {
  // old = disk, new = draft: green rows are lines only in the draft, red rows
  // are lines only on disk — i.e. the effect of choosing "Keep my draft".
  const rows = useMemo(() => buildConflictRows(diffLines(theirs, mine)), [mine, theirs]);
  const identical = rows.every((r) => r.kind === "skip" || r.op.type === "ctx");

  return (
    <div
      role="region"
      aria-label="Resolve edit conflict"
      className="md-editor__conflict flex h-full min-h-0 flex-col"
    >
      <div className="shrink-0 space-y-1 border-b border-[var(--border-hairline)] px-4 py-3">
        <p role="alert" className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--color-warning)]">
          <Icon name="ph:warning-circle" width={13} aria-hidden />
          This document changed on disk while you were editing
        </p>
        <p className="text-[11px] text-[var(--text-muted)]">
          {identical
            ? "The disk version now matches your draft — you can safely take either."
            : "Review the difference, then keep your draft, take the disk version, or merge the two."}
          {" "}
          <span className="md-editor__conflict-key md-editor__conflict-key--mine">your draft</span>
          {" · "}
          <span className="md-editor__conflict-key md-editor__conflict-key--theirs">on disk</span>
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        <div className="md-editor__conflict-diff font-mono text-[11px] leading-5" role="table" aria-label="Draft vs disk diff">
          {rows.map((row, i) =>
            row.kind === "skip" ? (
              <div key={i} className="md-editor__conflict-line md-editor__conflict-line--skip" role="row">
                ⋯ {row.count} unchanged line{row.count === 1 ? "" : "s"}
              </div>
            ) : (
              <div
                key={i}
                role="row"
                className={`md-editor__conflict-line md-editor__conflict-line--${row.op.type}`}
              >
                <span aria-hidden className="md-editor__conflict-marker">
                  {row.op.type === "add" ? "+" : row.op.type === "del" ? "−" : " "}
                </span>
                {row.op.text || "\u00a0"}
              </div>
            ),
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-[var(--border-hairline)] px-3 py-2">
        <button
          type="button"
          onClick={onKeepMine}
          className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--color-warning)]/40 px-2 text-[11px] text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10"
        >
          <Icon name="ph:floppy-disk-bold" width={11} aria-hidden />
          Keep my draft
        </button>
        <button
          type="button"
          onClick={onTakeTheirs}
          className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:arrow-counter-clockwise" width={11} aria-hidden />
          Take disk version
        </button>
        <button
          type="button"
          onClick={onMerge}
          className="focus-ring inline-flex h-7 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          <Icon name="ph:git-merge" width={11} aria-hidden />
          Merge both
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onDismiss}
          className="focus-ring inline-flex h-7 items-center rounded-md px-2 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
        >
          Back to editing
        </button>
      </div>
    </div>
  );
}
