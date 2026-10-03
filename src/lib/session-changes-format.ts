import { formatTimestamp, readDateTimePrefs } from "@/lib/datetime-format";

/** Turn a checkpoint filename into the user's preferred local timestamp. */
export function checkpointLabel(name: string): string {
  const iso = name.replace(/\.patch$/, "").replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    "$1T$2:$3:$4.$5Z",
  );
  return Number.isNaN(new Date(iso).getTime()) ? name : formatTimestamp(iso, readDateTimePrefs());
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function splitFilePath(path: string): { basename: string; dirname: string } {
  const idx = path.lastIndexOf("/");
  return idx < 0 ? { basename: path, dirname: "" } : { basename: path.slice(idx + 1) || path, dirname: path.slice(0, idx) };
}

export type CheckpointRestoreResult = { restored?: string[]; unchanged?: string[]; kept?: string[] };

/** One line for what a checkpoint restore did (#5756). It names the files it
 *  left alone, because a restore never overwrites a file changed since. */
export function checkpointRestoreMessage(label: string, result: CheckpointRestoreResult): string {
  const list = (value: unknown): string[] => (Array.isArray(value) ? value : []);
  const restored = list(result.restored).length;
  const kept = list(result.kept);
  const files = (n: number) => `${n} ${n === 1 ? "file" : "files"}`;
  const named = (paths: string[]) =>
    paths.length <= 3 ? paths.join(", ") : `${paths.slice(0, 3).join(", ")} and ${paths.length - 3} more`;
  const keptNote = kept.length > 0
    ? ` Kept ${named(kept)} as ${kept.length === 1 ? "it is" : "they are"}: changed after the checkpoint.`
    : "";
  if (restored > 0) {
    return `Restored ${files(restored)} from checkpoint ${label}.${keptNote} The state before restoring is saved as a new checkpoint.`;
  }
  if (kept.length > 0) return `Nothing restored from checkpoint ${label}.${keptNote}`;
  return `Nothing to restore: the files already match checkpoint ${label}.`;
}
