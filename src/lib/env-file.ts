/**
 * Surgical `.env`-style upsert. The previous PAT route parsed `.env.local` into
 * a map and rewrote the whole file from scratch, which dropped comments, blank
 * lines, and key ordering, and stripped quotes from unrelated values. This
 * edits in place: existing keys are replaced where they sit, new keys are
 * appended, a `null` value deletes its key, and every other line is preserved
 * byte-for-byte.
 */
export function upsertEnvContent(existing: string, updates: Record<string, string | null>): string {
  const lines = existing === "" ? [] : existing.split("\n");
  // Drop a single trailing empty line (from a trailing newline) so appended
  // keys don't get separated by a blank gap; we re-add the newline at the end.
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  const remaining = new Map(Object.entries(updates));
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const eq = line.indexOf("=");
    // Preserve comments, blanks, and non `key=value` lines untouched.
    if (!trimmed || trimmed.startsWith("#") || eq < 0) {
      out.push(line);
      continue;
    }
    const key = line.slice(0, eq).trim();
    if (!remaining.has(key)) {
      out.push(line);
      continue;
    }
    const val = remaining.get(key)!;
    remaining.delete(key);
    if (val === null) continue; // delete: drop this line
    out.push(`${key}=${val}`);
  }

  // Append keys that weren't already present (skip deletes for absent keys).
  for (const [key, val] of remaining) {
    if (val === null) continue;
    out.push(`${key}=${val}`);
  }

  return out.length ? out.join("\n") + "\n" : "";
}
