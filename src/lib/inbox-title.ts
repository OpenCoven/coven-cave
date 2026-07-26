/** Display-time cleanup for inbox/notification titles.
 *
 * Upstream producers (e.g. the daemon's CI watcher) compose titles like
 * `CI passed in owner/repo: <workflow> — <run title>`. When the workflow name
 * and the run title are identical the result reads twice —
 * "PR #3081 — PR #3081" — in every surface that renders the item (toast
 * stack, notification bell). The producer can't always know better (the two
 * fields come from different GitHub payloads), so surfaces normalize at
 * display time instead.
 */

/** Em-dash separator used by inbox title producers. */
const EM_DASH_SEP = " \u2014 ";

/**
 * Collapse `A — A` repeats in a title, preserving any `prefix: ` before the
 * pair. Comparison is case-sensitive on trimmed halves; non-repeating titles
 * pass through untouched.
 */
export function normalizeInboxTitle(title: string): string {
  if (!title.includes(EM_DASH_SEP)) return title;

  // The first `: ` ends the producer prefix ("CI passed in owner/repo: ");
  // run titles after it may contain their own colons ("Code Quality: PR #1").
  const colonIdx = title.indexOf(": ");
  const prefix = colonIdx === -1 ? "" : title.slice(0, colonIdx + 2);
  const rest = colonIdx === -1 ? title : title.slice(colonIdx + 2);

  // Titles may themselves contain em-dashes, so try every separator as the
  // split point and collapse on the first equal-halves match.
  for (
    let sepIdx = rest.indexOf(EM_DASH_SEP);
    sepIdx !== -1;
    sepIdx = rest.indexOf(EM_DASH_SEP, sepIdx + 1)
  ) {
    const left = rest.slice(0, sepIdx).trim();
    const right = rest.slice(sepIdx + EM_DASH_SEP.length).trim();
    if (left.length > 0 && left === right) return `${prefix}${left}`;
  }
  return title;
}
