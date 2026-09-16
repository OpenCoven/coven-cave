// Middle truncation for a branch name — a string that carries its meaning at
// BOTH ends.
//
// End truncation is the wrong tool here, and the handoff's opening diagnosis is
// a row that proves it: `Persistent blo…-windows-acl`. Everything that
// identifies that branch — the `fix/` class at the front, the `windows-acl`
// subject at the back — survives only by accident, and the fifteen rows beside
// it truncate to the same prefix. A title can end-truncate safely because its
// information is front-loaded; a branch cannot.
//
// The handoff specifies two further rules, for pull requests and for paths.
// They are deliberately absent until something renders them: a tested function
// with no consumer is still code nobody asked for, and the shape of the row
// that needs them has not landed yet.

/** Visible-character floor the handoff sets for a truncated branch (§3). */
export const MIN_BRANCH_VISIBLE = 22;

const HEAD_CHARS = 6;
const TAIL_CHARS = 12;
const ELLIPSIS = "…";

/** Separators that must not be left stranded against the ellipsis. */
const EDGE_SEPARATORS = /^[-_/.]+|[-_/.]+$/g;

/**
 * `fix/cave-9jt60-revert-windows-acl` → `fix/cave-9…windows-acl`
 *
 * Keeps the first path segment whole (it is the branch's class — `fix`, `feat`,
 * `docs` — and short by convention), then the first 6 and last 12 characters of
 * what remains. A separator orphaned against the ellipsis is trimmed, which is
 * what makes the result read as `…windows-acl` rather than `…-windows-acl`.
 *
 * A branch with no `/` keeps the same head/tail budget without the segment, and
 * anything already short is returned whole — truncation must never lengthen.
 */
export function truncateBranch(branch: string): string {
  const value = (branch ?? "").trim();
  if (!value) return "";

  const slash = value.indexOf("/");
  const prefix = slash > 0 ? value.slice(0, slash + 1) : "";
  const rest = slash > 0 ? value.slice(slash + 1) : value;

  if (rest.length <= HEAD_CHARS + TAIL_CHARS) return value;

  const head = rest.slice(0, HEAD_CHARS).replace(EDGE_SEPARATORS, "");
  const tail = rest.slice(-TAIL_CHARS).replace(EDGE_SEPARATORS, "");
  const truncated = `${prefix}${head}${ELLIPSIS}${tail}`;

  // Truncation that does not shorten is just a lie with an ellipsis in it.
  return truncated.length < value.length ? truncated : value;
}
