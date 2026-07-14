// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Visual + behavior contract for the toast stack (facelift: cave-esw5).
// Repeated CI notifications were stacking as identical clones with
// producer-duplicated titles ("PR #3081 — PR #3081") and no cap.
const src = readFileSync(new URL("./inbox-toast.tsx", import.meta.url), "utf8");

// ── Grouping ─────────────────────────────────────────────────────────────────
assert.match(src, /groupToasts\(toasts\)/, "stack renders grouped toasts, not raw clones");
assert.match(
  src,
  /slice\(0, MAX_VISIBLE_TOAST_GROUPS\)/,
  "visible cards are capped so a burst cannot wallpaper the corner",
);
assert.match(src, /\u00d7\{g\.count\}/, "collapsed repeats surface as a ×N badge");
assert.match(
  src,
  /\$\{g\.count\} matching notifications/,
  "the ×N badge has an accessible name",
);
assert.match(
  src,
  /\+\{overflow\} more in the bell/,
  "hidden groups roll up into a quiet overflow line pointing at the bell",
);

// ── Title hygiene ────────────────────────────────────────────────────────────
assert.match(
  src,
  /normalizeInboxTitle\(t\.title\)/,
  "titles are normalized at display time (collapses 'A — A' producer dupes)",
);
assert.match(
  src,
  /aria-label=\{`Dismiss: \$\{title\}`\}/,
  "dismiss labels use the normalized title",
);
assert.match(src, /break-words/, "long branch/PR titles wrap instead of overflowing");

// ── Group semantics ──────────────────────────────────────────────────────────
assert.match(
  src,
  /g\.ids\.forEach\(fn\)/,
  "dismissing a grouped card clears every member id",
);
assert.match(
  src,
  /setPaused\(g\.ids, true\)/,
  "hover/focus pauses auto-hide for every member of the group",
);

// ── Surface discipline ───────────────────────────────────────────────────────
assert.match(src, /glass-overlay/, "toast cards use the shared glass token surface");
assert.match(
  src,
  /var\(--toast-accent\)/,
  "kind accent flows through the --toast-accent custom property",
);
assert.doesNotMatch(
  src,
  /var\(--accent\)[^-]/,
  "no raw --accent usage — accent comes from tokens (accent-presence / color-warning)",
);

console.log("inbox-toast-stack.test.ts: ok");
