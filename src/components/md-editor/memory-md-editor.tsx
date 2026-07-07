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
 * Reused by the memory reader's edit mode and the Grimoire surface.
 */

import { useCallback, useRef } from "react";
import { MdEditor, type MdEditorSaveResult } from "@/components/md-editor/md-editor";
import { useMemoryFile } from "@/lib/use-memory-file";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";

export function MemoryMdEditor({
  path,
  sourceLabel,
  onCancel,
  onSaved,
}: {
  path: string;
  sourceLabel?: string;
  onCancel?: () => void;
  /** Called after each successful save with the saved text. */
  onSaved?: (text: string) => void;
}) {
  const { text, error, loading, mtimeMs } = useMemoryFile(path, { reveal: true });
  const mtimeRef = useRef<number | null>(null);
  if (mtimeMs !== null && mtimeRef.current === null) mtimeRef.current = mtimeMs;

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
    <MdEditor
      key={path}
      value={text}
      sourceLabel={sourceLabel}
      onSave={save}
      onCancel={onCancel}
    />
  );
}
