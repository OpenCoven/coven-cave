"use client";

/**
 * MemoryMdEditor — MdEditor wired to the memory-file API.
 *
 * Loads the un-redacted file (`?reveal=1`) so a save can never write
 * `[REDACTED:…]` placeholders over real secrets, and saves through
 * `PUT /api/memory/file` carrying the loaded `mtimeMs` so concurrent agent
 * writes surface as a conflict instead of a lost update. A 409 forwards the
 * disk version to the editor's conflict panel (diff + keep-mine / take-theirs
 * / merge) and re-baselines the expected mtime so the chosen resolution can
 * land — while still guarding against writes that happen after the 409.
 *
 * Live-follow (agents write these files while they're open): a light
 * `?stat=1` poll watches the file's mtime while the tab is visible.
 *   - Doc CLEAN  → the view re-fetches and follows the disk version live.
 *   - Doc DIRTY  → the draft is never clobbered; a banner offers an explicit
 *     "Reload from disk" (and the 409 conflict panel still guards saves).
 *
 * Reused by the memory reader's edit mode and the Grimoire surface.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { MdEditor, type MdEditorSaveResult } from "@/components/md-editor/md-editor";
import { useMemoryFile } from "@/lib/use-memory-file";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";

/** How often the open document checks the disk for agent writes. */
export const LIVE_FOLLOW_INTERVAL_MS = 5000;

export function MemoryMdEditor({
  path,
  sourceLabel,
  onCancel,
  onSaved,
  onDirtyChange,
}: {
  path: string;
  sourceLabel?: string;
  onCancel?: () => void;
  /** Called after each successful save with the saved text. */
  onSaved?: (text: string) => void;
  /** Forwarded to the inner editor (unsaved-edits indicator). */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  // Bumping the token re-fetches (and re-mounts) the editor with disk state.
  const [refreshToken, setRefreshToken] = useState(0);
  const { text, error, loading, mtimeMs } = useMemoryFile(path, { reveal: true, refreshToken });
  const mtimeRef = useRef<number | null>(null);
  if (mtimeMs !== null && mtimeRef.current === null) mtimeRef.current = mtimeMs;

  // Dirty tracking mirrors the editor: baseline = last loaded/saved text.
  const baselineRef = useRef<string | null>(null);
  const draftRef = useRef<string | null>(null);
  if (text !== null && baselineRef.current === null) {
    baselineRef.current = text;
    draftRef.current = text;
  }
  const [diskChanged, setDiskChanged] = useState(false);

  const reloadFromDisk = useCallback(() => {
    mtimeRef.current = null;
    baselineRef.current = null;
    draftRef.current = null;
    setDiskChanged(false);
    setRefreshToken((n) => n + 1);
  }, []);

  // Live-follow poll: visibility-aware mtime watch. Clean docs follow the
  // disk automatically; dirty docs surface the banner instead.
  useEffect(() => {
    let cancelled = false;
    let checking = false;
    const check = async () => {
      if (cancelled || checking || typeof document === "undefined" || document.hidden) return;
      if (mtimeRef.current === null) return; // nothing loaded yet
      checking = true;
      try {
        const res = await fetch(
          `/api/memory/file?path=${encodeURIComponent(path)}&stat=1`,
          { cache: "no-store" },
        );
        const json = await res.json();
        if (cancelled || !json.ok || typeof json.mtimeMs !== "number") return;
        if (Math.floor(json.mtimeMs) === Math.floor(mtimeRef.current ?? 0)) return;
        const dirty =
          draftRef.current !== null &&
          baselineRef.current !== null &&
          draftRef.current !== baselineRef.current;
        if (dirty) {
          setDiskChanged(true);
        } else {
          reloadFromDisk();
        }
      } catch {
        /* transient poll failure — next tick retries */
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(() => void check(), LIVE_FOLLOW_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [path, reloadFromDisk]);

  const save = useCallback(
    async (raw: string): Promise<MdEditorSaveResult> => {
      try {
        const res = await fetch("/api/memory/file", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path,
            text: raw,
            ...(mtimeRef.current !== null ? { expectedMtimeMs: mtimeRef.current } : {}),
          }),
        });
        const json = await res.json();
        if (!json.ok) {
          if (res.status === 409) {
            // Conflict: re-baseline on the disk mtime the server reported so
            // the user's resolution (overwrite / take / merge, then save) can
            // land, and hand the disk text to the editor's conflict panel.
            if (typeof json.currentMtimeMs === "number") mtimeRef.current = json.currentMtimeMs;
            if (typeof json.currentText === "string") {
              return { ok: false, conflict: { currentText: json.currentText } };
            }
            return {
              ok: false,
              error: "File changed on disk — cancel and reopen to pick up the latest version.",
            };
          }
          return { ok: false, error: json.error ?? "Save failed" };
        }
        if (typeof json.mtimeMs === "number") mtimeRef.current = json.mtimeMs;
        baselineRef.current = raw;
        draftRef.current = raw;
        setDiskChanged(false);
        onSaved?.(raw);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "Save failed" };
      }
    },
    [onSaved, path],
  );

  if (error) {
    return <ErrorState compact headline="Couldn't open this memory for editing" subtitle={error} />;
  }
  if (loading || text === null) {
    return (
      <div className="space-y-2.5 p-4" aria-label="Loading memory" aria-busy="true">
        {["92%", "85%", "97%", "78%"].map((w, i) => (
          <Skeleton key={i} variant="text" width={w} />
        ))}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {diskChanged ? (
        <div
          role="status"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3 py-1.5 text-[11px] text-[var(--text-primary)]"
        >
          <Icon name="ph:warning-circle" width={12} aria-hidden />
          <span className="min-w-0 flex-1">
            This file changed on disk while you were editing — an agent may have written it.
          </span>
          <button
            type="button"
            onClick={reloadFromDisk}
            className="focus-ring inline-flex h-6 items-center gap-1 rounded-md border border-[var(--border-hairline)] px-2 text-[10px] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            <Icon name="ph:arrow-counter-clockwise" width={10} aria-hidden />
            Reload from disk
          </button>
          <button
            type="button"
            onClick={() => setDiskChanged(false)}
            aria-label="Dismiss and keep editing"
            className="focus-ring inline-flex h-6 items-center rounded-md px-1.5 text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
          >
            Keep editing
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <MdEditor
          key={`${path}:${refreshToken}`}
          value={text}
          sourceLabel={sourceLabel}
          onSave={save}
          onCancel={onCancel}
          onDirtyChange={onDirtyChange}
          onChange={(raw) => {
            draftRef.current = raw;
          }}
        />
      </div>
    </div>
  );
}
