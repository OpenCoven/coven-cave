"use client";

import "@/styles/familiar-tab-memory.css";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/lib/icon";
import { IconButton } from "@/components/ui/icon-button";
import { Segmented } from "@/components/ui/settings-controls";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MarkdownBlock } from "@/components/message-bubble";
import { relativeTime } from "@/lib/relative-time";
import { countRedactions } from "@/lib/redact";
import { openFamiliarStudioSettingsTab } from "@/lib/familiar-studio-context";
import { fileBase, type FileMemoryEntry } from "@/components/familiars-memory-utils";
import type { Familiar } from "@/lib/types";

// ────────────────────────────────────────────────────────────────────────────
// Familiar tab — Memory section (design-handoff rebuild).
//
// Two-card grid: a collapsible file-list card on the left, a preview/edit card
// on the right. Data is the real memory inventory:
//   list  GET /api/memory?familiarId={id}         (scoped to this familiar)
//   read  GET /api/memory/file?path={fullPath}    (redacted text — by design)
//   write PUT /api/memory/file { path, text, expectedMtimeMs }
//
// Redaction is a feature: this pane never asks the server to reveal. Because saving
// redacted placeholders back to disk would clobber the real secrets (the
// server refuses with a 422 anyway), files whose text carries redactions are
// read-only here. A stale expectedMtimeMs surfaces as an honest conflict row
// with a reload affordance — never a silent clobber.
// ────────────────────────────────────────────────────────────────────────────

type ListState = {
  entries: FileMemoryEntry[];
  loaded: boolean;
  error: string | null;
};

type FileState = {
  text: string | null;
  mtimeMs: number | null;
  redactionCount: number;
  loading: boolean;
  error: string | null;
};

const EMPTY_FILE_STATE: FileState = { text: null, mtimeMs: null, redactionCount: 0, loading: false, error: null };

/** MEMORY.md-style curated index first, then newest activity. */
function sortMemoryEntries(entries: FileMemoryEntry[]): FileMemoryEntry[] {
  return [...entries].sort((a, b) => {
    const aIndex = fileBase(a.relPath) === "MEMORY.md" ? 0 : 1;
    const bIndex = fileBase(b.relPath) === "MEMORY.md" ? 0 : 1;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0;
  });
}

function entryMeta(entry: FileMemoryEntry): string {
  return `${entry.sourceKindLabel} · ${relativeTime(entry.modified)}`;
}

export function FamiliarMemorySection({ familiar }: { familiar: Familiar }) {
  const [list, setList] = useState<ListState>({ entries: [], loaded: false, error: null });
  const [listOpen, setListOpen] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [view, setView] = useState<"preview" | "edit">("preview");
  const [file, setFile] = useState<FileState>(EMPTY_FILE_STATE);
  // Bumped to re-fetch the selected file (retry, conflict reload).
  const [refreshToken, setRefreshToken] = useState(0);
  const [saveError, setSaveError] = useState<{ kind: "conflict" | "plain"; message: string } | null>(null);

  const loadList = useCallback(async () => {
    setList((prev) => ({ ...prev, error: null }));
    try {
      const res = await fetch(`/api/memory?familiarId=${encodeURIComponent(familiar.id)}`, { cache: "no-store" });
      const json = (await res.json()) as { ok: boolean; entries?: FileMemoryEntry[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Memory unavailable");
      setList({ entries: sortMemoryEntries(json.entries ?? []), loaded: true, error: null });
    } catch (err) {
      setList((prev) => ({ ...prev, loaded: true, error: err instanceof Error ? err.message : "Memory unavailable" }));
    }
  }, [familiar.id]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Keep a valid selection: default to the first (index) file, and drop a
  // selection whose file left the inventory.
  useEffect(() => {
    if (list.entries.length === 0) {
      if (selectedPath !== null) setSelectedPath(null);
      return;
    }
    if (!selectedPath || !list.entries.some((entry) => entry.fullPath === selectedPath)) {
      setSelectedPath(list.entries[0].fullPath);
      setView("preview");
    }
  }, [list.entries, selectedPath]);

  // Fetch the selected file. Redacted text renders as-is — no reveal here.
  useEffect(() => {
    if (!selectedPath) {
      setFile(EMPTY_FILE_STATE);
      return;
    }
    let cancelled = false;
    setFile({ ...EMPTY_FILE_STATE, loading: true });
    setSaveError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/memory/file?path=${encodeURIComponent(selectedPath)}`, { cache: "no-store" });
        const json = (await res.json()) as {
          ok: boolean;
          text?: string;
          mtimeMs?: number;
          redactions?: Record<string, number>;
          error?: string;
        };
        if (cancelled) return;
        if (!json.ok) throw new Error(json.error ?? "Failed to load memory file");
        setFile({
          text: typeof json.text === "string" ? json.text : "",
          mtimeMs: typeof json.mtimeMs === "number" ? json.mtimeMs : null,
          redactionCount: json.redactions ? countRedactions(json.redactions) : 0,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (!cancelled) {
          setFile({ ...EMPTY_FILE_STATE, error: err instanceof Error ? err.message : "Failed to load memory file" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPath, refreshToken]);

  const selected = useMemo(
    () => list.entries.find((entry) => entry.fullPath === selectedPath) ?? null,
    [list.entries, selectedPath],
  );

  /** Persist an edit. Resolves true when the pane may leave the draft behind. */
  const commitEdit = useCallback(
    async (nextText: string): Promise<boolean> => {
      if (!selectedPath) return true;
      if (nextText === (file.text ?? "")) return true; // untouched draft — nothing to save
      try {
        const res = await fetch("/api/memory/file", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            path: selectedPath,
            text: nextText,
            ...(file.mtimeMs !== null ? { expectedMtimeMs: file.mtimeMs } : {}),
          }),
        });
        const json = (await res.json()) as { ok: boolean; mtimeMs?: number; error?: string };
        if (res.status === 409) {
          setSaveError({ kind: "conflict", message: "File changed on disk — reload before editing." });
          return false;
        }
        if (!json.ok) {
          setSaveError({ kind: "plain", message: json.error ?? "Save failed" });
          return false;
        }
        // Success: the preview and the concurrency baseline both move to what
        // was just written, and the list row's freshness follows.
        setFile((prev) => ({
          ...prev,
          text: nextText,
          mtimeMs: typeof json.mtimeMs === "number" ? json.mtimeMs : prev.mtimeMs,
        }));
        setList((prev) => ({
          ...prev,
          entries: sortMemoryEntries(
            prev.entries.map((entry) =>
              entry.fullPath === selectedPath ? { ...entry, modified: new Date().toISOString(), size: nextText.length } : entry,
            ),
          ),
        }));
        setSaveError(null);
        return true;
      } catch (err) {
        setSaveError({ kind: "plain", message: err instanceof Error ? err.message : "Save failed" });
        return false;
      }
    },
    [selectedPath, file.text, file.mtimeMs],
  );

  const reloadSelectedFile = useCallback(() => {
    setSaveError(null);
    setView("preview");
    setRefreshToken((n) => n + 1);
  }, []);

  const readOnly = file.redactionCount > 0;

  // ── Empty / loading / error shells ────────────────────────────────────────
  if (list.loaded && !list.error && list.entries.length === 0) {
    return (
      <section className="familiar-memory-tab familiar-memory-tab--empty" aria-label="Memory">
        <EmptyState
          icon="ph:brain"
          headline="No memory files yet"
          subtitle={`Memory appears here as ${familiar.display_name} works — chats and runtime sessions write notes to disk.`}
          actions={
            <Button size="xs" variant="ghost" onClick={() => openFamiliarStudioSettingsTab("memory", familiar.id)}>
              Open memory studio
            </Button>
          }
        />
      </section>
    );
  }

  return (
    <section className="familiar-memory-tab" aria-label="Memory">
      {list.error ? (
        <div role="alert" className="familiar-memory-tab__error">
          <Icon name="ph:warning-circle" width={13} aria-hidden />
          <span className="familiar-memory-tab__error-text">{list.error}</span>
          <Button size="xs" variant="ghost" leadingIcon="ph:arrow-clockwise" onClick={() => void loadList()}>
            Retry
          </Button>
        </div>
      ) : null}

      <div className={`familiar-memory-tab__grid ${listOpen ? "" : "familiar-memory-tab__grid--collapsed"}`}>
        {/* File-list card */}
        <section aria-label="Memory files" className="familiar-memory-tab__card familiar-memory-tab__list-card">
          <div className={`familiar-memory-tab__list-head ${listOpen ? "" : "familiar-memory-tab__list-head--collapsed"}`}>
            <span className={`familiar-memory-tab__toggle ${listOpen ? "" : "familiar-memory-tab__toggle--scaled"}`}>
              <IconButton
                icon="ph:sidebar-simple"
                size="sm"
                aria-label={listOpen ? "Collapse memory files" : "Expand memory files"}
                aria-expanded={listOpen}
                onClick={() => setListOpen((open) => !open)}
              />
            </span>
            {listOpen ? (
              <>
                <span className="familiar-memory-tab__list-label">Memory</span>
                <span className="familiar-memory-tab__count">
                  {list.entries.length} file{list.entries.length === 1 ? "" : "s"}
                </span>
              </>
            ) : null}
          </div>
          {listOpen ? (
            !list.loaded ? (
              <SkeletonRows count={5} className="familiar-memory-tab__skeleton" />
            ) : (
              <div className="familiar-memory-tab__rows">
                {list.entries.map((entry) => {
                  const active = entry.fullPath === selectedPath;
                  return (
                    <button
                      key={entry.fullPath}
                      type="button"
                      aria-current={active ? "true" : undefined}
                      onClick={() => {
                        setSelectedPath(entry.fullPath);
                        setView("preview");
                      }}
                      className={`focus-ring familiar-memory-tab__row ${active ? "familiar-memory-tab__row--selected" : ""}`}
                    >
                      <span className="familiar-memory-tab__row-name">{fileBase(entry.relPath)}</span>
                      <span className="familiar-memory-tab__row-meta">{entryMeta(entry)}</span>
                    </button>
                  );
                })}
              </div>
            )
          ) : null}
        </section>

        {/* Preview / edit card */}
        <section aria-label="Memory preview" className="familiar-memory-tab__card">
          <div className="familiar-memory-tab__preview-head">
            <div className="familiar-memory-tab__preview-id">
              <span className="familiar-memory-tab__preview-name">
                {selected ? fileBase(selected.relPath) : "—"}
              </span>
              <span className="familiar-memory-tab__preview-meta">{selected ? entryMeta(selected) : ""}</span>
            </div>
            <Segmented
              options={["preview", "edit"] as const}
              value={view}
              onChange={setView}
              getLabel={(option) => (option === "preview" ? "Preview" : "Edit")}
              ariaLabel="Memory view"
            />
          </div>

          {file.loading || (!list.loaded && !selected) ? (
            <SkeletonRows count={5} className="familiar-memory-tab__skeleton" />
          ) : file.error ? (
            <div role="alert" className="familiar-memory-tab__error familiar-memory-tab__error--pane">
              <Icon name="ph:warning-circle" width={13} aria-hidden />
              <span className="familiar-memory-tab__error-text">{file.error}</span>
              <Button size="xs" variant="ghost" leadingIcon="ph:arrow-clockwise" onClick={() => setRefreshToken((n) => n + 1)}>
                Retry
              </Button>
            </div>
          ) : view === "edit" ? (
            <div className="familiar-memory-tab__edit">
              {saveError ? (
                <div role="alert" className="familiar-memory-tab__error">
                  <Icon name="ph:warning-circle" width={13} aria-hidden />
                  <span className="familiar-memory-tab__error-text">{saveError.message}</span>
                  {saveError.kind === "conflict" ? (
                    <Button size="xs" variant="ghost" leadingIcon="ph:arrow-clockwise" onClick={reloadSelectedFile}>
                      Reload
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {readOnly ? (
                <p className="familiar-memory-tab__hint familiar-memory-tab__hint--guard">
                  {file.redactionCount} redacted secret{file.redactionCount === 1 ? "" : "s"} — read-only here so a
                  save can never overwrite them with placeholders.
                </p>
              ) : null}
              <textarea
                key={`${selectedPath ?? ""}:${refreshToken}`}
                defaultValue={file.text ?? ""}
                readOnly={readOnly}
                autoFocus
                aria-label="Edit memory file"
                className="focus-ring familiar-memory-tab__textarea"
                onBlur={(event) => {
                  if (!readOnly) void commitEdit(event.currentTarget.value);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  if (readOnly) {
                    setView("preview");
                    return;
                  }
                  // Esc saves the draft too; only a failed save (e.g. an mtime
                  // conflict) keeps the pane in edit so the draft isn't lost.
                  const value = event.currentTarget.value;
                  void commitEdit(value).then((ok) => {
                    if (ok) setView("preview");
                  });
                }}
              />
              <div className="familiar-memory-tab__hint">
                {readOnly ? "Esc for preview" : "Saves as you click away · Esc for preview"}
              </div>
            </div>
          ) : (
            <div
              className="familiar-memory-tab__preview"
              title="Double-click to edit"
              onDoubleClick={() => setView("edit")}
            >
              {file.text ? (
                <MarkdownBlock text={file.text} />
              ) : (
                <p className="familiar-memory-tab__empty-file">Empty file.</p>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
