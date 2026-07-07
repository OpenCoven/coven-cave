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

const MdEditorVisual = dynamic(() => import("./md-editor-visual"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center text-[11px] text-[var(--text-muted)]">
      Loading editor…
    </div>
  ),
});

export type MdEditorMode = "visual" | "markdown";
export type MdEditorSaveResult = { ok: boolean; error?: string };

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
        setSavedFlash(true);
        window.setTimeout(() => setSavedFlash(false), 1500);
      } else {
        setSaveError(result.error ?? "Save failed");
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [onSave, readOnly, saving]);

  // Autosave: persist a short while after typing stops (idempotent surfaces
  // only — see the `autoSave` prop doc). A ref keeps the effect from
  // re-subscribing on every `save` identity change; guarding on `saving` means
  // we never stack a second request on an in-flight one, and because `saving`
  // is a dependency the effect re-runs when a save settles and reschedules if
  // the doc advanced meanwhile. Empty docs are skipped — the save handlers
  // reject them, so autosaving one would just flash an error.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!autoSave || readOnly || saving || !dirty || !raw.trim()) return;
    const timer = window.setTimeout(() => void saveRef.current(), AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [autoSave, readOnly, saving, dirty, raw]);

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
        {mode === "visual" ? (
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
            <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
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
