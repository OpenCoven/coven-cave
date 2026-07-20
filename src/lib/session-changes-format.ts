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
