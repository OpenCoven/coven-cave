/**
 * Arrow-key targets for the Coding Desk's tablists (#5729).
 *
 * The open-file strip, the review rail and the narrow step switcher are all
 * horizontal tablists with automatic activation (WAI-ARIA tabs pattern): one
 * tab stop, Left/Right move and wrap, Home/End jump to the ends. One rule set
 * keeps the three strips from drifting apart.
 *
 * A modified arrow is never a tab move. Alt, Ctrl and Meta arrows belong to
 * the desk's shortcuts and to the OS, so they pass through.
 */
export type CodeTablistKey = {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export function codeTablistKeyTarget(event: CodeTablistKey, index: number, count: number): number | null {
  if (count <= 0 || index < 0 || index >= count) return null;
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "ArrowRight") return (index + 1) % count;
  if (event.key === "ArrowLeft") return (index - 1 + count) % count;
  if (event.key === "Home") return 0;
  if (event.key === "End") return count - 1;
  return null;
}
