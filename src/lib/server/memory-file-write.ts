/**
 * Memory file writes — the server-side save path for the MdEditor on memory
 * surfaces.
 *
 * Safety model:
 *   - Same path allowlist as reads (`resolveAllowedMemoryFileReadPath`), so a
 *     write can never reach outside the known memory roots. Edit-in-place
 *     only: the file must already exist (memory files are created by agents
 *     or by dedicated flows, not by this endpoint).
 *   - mtime conflict guard: callers send the `mtimeMs` they loaded; if the
 *     file changed underneath them (agents also write these roots) the save
 *     is rejected with the current text so the UI can offer a reload.
 *   - Redaction guard: the read path redacts secrets to `[REDACTED:…]`
 *     placeholders. Saving a redacted view would clobber real secrets, so
 *     content containing the placeholder marker is refused — edit mode must
 *     load with `reveal=1`.
 */

import { stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolveAllowedMemoryFileReadPath } from "./memory-file-sources.ts";

export const MEMORY_FILE_MAX_BYTES = 2 * 1024 * 1024;

const REDACTION_MARKER_RE = /\[REDACTED:[a-z_]+\]/;

export type MemoryFileWriteResult =
  | { ok: true; path: string; mtimeMs: number; rawLength: number }
  | { ok: false; error: string; status: number; currentText?: string; currentMtimeMs?: number };

export function containsRedactionMarker(text: string): boolean {
  return REDACTION_MARKER_RE.test(text);
}

export async function writeAllowedMemoryFile(
  target: string,
  text: string,
  expectedMtimeMs: number | null,
  home = homedir(),
): Promise<MemoryFileWriteResult> {
  if (typeof text !== "string") {
    return { ok: false, error: "text required", status: 400 };
  }
  if (Buffer.byteLength(text, "utf8") > MEMORY_FILE_MAX_BYTES) {
    return { ok: false, error: "file too large", status: 413 };
  }
  if (containsRedactionMarker(text)) {
    return { ok: false, error: "refusing to save redacted content — reload with reveal to edit", status: 422 };
  }

  const allowedPath = await resolveAllowedMemoryFileReadPath(target, home);
  if (!allowedPath) {
    return { ok: false, error: "path not allowed", status: 403 };
  }

  if (expectedMtimeMs !== null) {
    let current;
    try {
      current = await stat(/* turbopackIgnore: true */ allowedPath);
    } catch {
      return { ok: false, error: "file not found", status: 404 };
    }
    if (Math.floor(current.mtimeMs) !== Math.floor(expectedMtimeMs)) {
      let currentText: string | undefined;
      try {
        const { readFile } = await import("node:fs/promises");
        currentText = await readFile(/* turbopackIgnore: true */ allowedPath, "utf8");
      } catch {
        currentText = undefined;
      }
      return {
        ok: false,
        error: "file changed on disk since it was loaded",
        status: 409,
        currentText,
        currentMtimeMs: current.mtimeMs,
      };
    }
  }

  try {
    await writeFile(/* turbopackIgnore: true */ allowedPath, text, "utf8");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "write failed", status: 500 };
  }
  const after = await stat(/* turbopackIgnore: true */ allowedPath);
  return { ok: true, path: target, mtimeMs: after.mtimeMs, rawLength: text.length };
}
