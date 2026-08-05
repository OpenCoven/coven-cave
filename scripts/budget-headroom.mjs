// Shared thin-headroom reporting for the build budgets.
//
// Every budget in this repo is a ratchet: a number seeded once against a
// measured snapshot, then eroded by ordinary work until it blocks something.
// Three did exactly that on 2026-08-04/05 — the sidecar runtime file count went
// red on main and blocked every PR (cave-k5n56), the worktree admission budget
// refused on every invocation (cave-qpwx0), and the Next standalone file count
// reached 6,993 of 7,000 (cave-yizcb).
//
// Reporting remaining headroom on every build turns that erosion into a visible
// slope instead of a cliff. This lives in its own module because the constant
// was previously private to bundle-budget.mjs, so standalone-budget.mjs had NO
// thin detection at all: the gates with the MOST headroom warned loudly (1.8%,
// 1.2%) while the one with 0.10% printed a clean check. A duplicated threshold
// would have drifted the same way — one definition, two callers.
//
// Deliberately does NOT fail. This is signal, not a new gate: a thin budget is
// information for the next author, not a reason to block the current one.
export const THIN_HEADROOM_PCT = 2;

// Each gate reports in the unit it is actually budgeted in. KB suits the CSS and
// JS caps; a 480 MiB artifact ceiling rendered in KB ("97953.0 KB") is unreadable
// at exactly the moment someone needs to read it.
export const asBytes = (value) => `${(value / 1024).toFixed(1).padStart(6)} KB`;
export const asMebibytes = (value) => `${(value / 1024 / 1024).toFixed(1).padStart(6)} MiB`;
export const asCount = (unit) => (value) => `${String(value).padStart(6)} ${unit}`;

/**
 * Format one budget's remaining headroom.
 *
 * Returns `{ pct, line, thin }` rather than printing, so callers keep control of
 * their own output shape and of how they accumulate the thin set.
 * `used > budget` returns `null` — the caller's failure branch reports overage,
 * and a negative "headroom" line would only muddy it.
 */
export function headroomOf(used, budget, format = asBytes) {
  const left = budget - used;
  if (left < 0) return null;
  const pct = (left / budget) * 100;
  const thin = pct < THIN_HEADROOM_PCT;
  const line =
    `  ${format(left)} headroom  (${pct.toFixed(1)}%)` +
    (thin ? "  ⚠ THIN — the next change of any size may fail this gate" : "");
  return { pct, line, thin };
}
