/**
 * Shared <input text> ↔ string[] helpers for the automation forms (working
 * directories, tags). One place so the create dialog, the inline cron editor,
 * and the cwd picker parse the same way — `parseListInput` accepts newline- AND
 * comma-separated entries, trims, and drops blanks.
 */

/** Join a list for a multi-line textarea (one entry per line). */
export function listInput(values: string[]): string {
  return values.join("\n");
}

/** Join a list for a single-line comma field. */
export function commaInput(values: string[]): string {
  return values.join(", ");
}

/** Parse a textarea/comma field into a trimmed, blank-free list. Accepts either
 *  separator (or a mix), so paste-from-anywhere just works. */
export function parseListInput(value: string): string[] {
  return value
    .split(/\n|,/)
    .map((part) => part.trim())
    .filter(Boolean);
}
