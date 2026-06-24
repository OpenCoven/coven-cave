// Pure type-ahead matching for the Projects list's keyboard navigation: given
// the visible item labels, the current focus index, and the accumulated typed
// buffer, decide which item focus should jump to. No DOM — unit-testable.

/**
 * Next index for a type-ahead jump, or -1 when nothing matches.
 *
 * Two modes, matching common file-manager behavior:
 *  - Buffer of one repeated character ("a", "aa", …) → cycle through items
 *    starting with that letter, advancing past the current one each press.
 *  - Any other (multi-character) buffer → match the full prefix, starting at the
 *    current item so continued typing refines in place ("se" → "ses").
 * Matching is case-insensitive and wraps around the list.
 */
export function nextTypeAheadIndex(
  labels: readonly string[],
  current: number,
  buffer: string,
): number {
  const n = labels.length;
  if (n === 0 || buffer.length === 0) return -1;
  const buf = buffer.toLowerCase();
  const from = current < 0 || current >= n ? 0 : current;
  const allSame = [...buf].every((c) => c === buf[0]);

  if (allSame) {
    // Cycle by first letter, starting strictly after the current item.
    for (let i = 1; i <= n; i++) {
      const idx = (from + i) % n;
      if (labels[idx].toLowerCase().startsWith(buf[0])) return idx;
    }
    return -1;
  }

  // Prefix match, starting at the current item (so refining keeps focus put).
  for (let i = 0; i < n; i++) {
    const idx = (from + i) % n;
    if (labels[idx].toLowerCase().startsWith(buf)) return idx;
  }
  return -1;
}
