import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { covenHome } from "../coven-paths.ts";

/**
 * Saved submissions as core data (#6400). The optional implementation owns
 * validating and publishing them; this owns reaching them. Everything here works
 * with that implementation disabled or physically absent, and imports none of
 * it. Backup covers the same file through `COVEN_FILES` in backup-manifest.ts.
 */
export function submissionsStorePath(): string {
  return path.join(/* turbopackIgnore: true */ covenHome(), "opencoven-submissions.json");
}

export type RetainedSubmissionsSummary =
  | { exists: false; count: 0 }
  | { exists: true; count: number }
  /** Present but not a shape we can count: it is still exportable and deletable. */
  | { exists: true; count: null };

async function readStore(): Promise<string | null> {
  try {
    return await readFile(submissionsStorePath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function summarizeRetainedSubmissions(): Promise<RetainedSubmissionsSummary> {
  const raw = await readStore();
  if (raw === null) return { exists: false, count: 0 };
  try {
    const parsed = JSON.parse(raw) as { submissions?: unknown };
    return { exists: true, count: Array.isArray(parsed.submissions) ? parsed.submissions.length : null };
  } catch {
    return { exists: true, count: null };
  }
}

/** The file's exact bytes, so an export never reshapes or drops an entry. */
export const exportRetainedSubmissions = readStore;

/** Returns whether a file was removed. Only an explicit user request calls this. */
export async function deleteRetainedSubmissions(): Promise<boolean> {
  try {
    await unlink(submissionsStorePath());
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
