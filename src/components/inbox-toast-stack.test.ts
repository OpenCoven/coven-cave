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
  /<span className="sr-only">\{`\$\{g\.count\} matching notifications`\}<\/span>/,
  "the badge name is visually-hidden text, not an aria-label on a generic span",
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
// cave-lcxc6: a touch tap raises pointerenter but pointerleave only lands when
// the user taps elsewhere, so an ungated hover-pause turned a stray tap into a
// permanent toast. Focus still pauses without limit for keyboard/AT users.
assert.match(
  src,
  /onPointerEnter=\{\(e\) => \{ if \(e\.pointerType !== "touch"\) setPaused\(g\.ids, true\); \}\}/,
  "hover-pause is gated on a hovering pointer, so touch keeps its auto-hide window",
);
assert.doesNotMatch(
  src,
  /onMouseEnter=/,
  "no ungated mouseenter pause — touch emulates it and never sends the leave",
);

// ── Stack geometry ───────────────────────────────────────────────────────────
// cave-lcxc6: the stack was `fixed top-4 right-4 w-80`, a desktop-shaped panel
// pinned over the shell's top-right chrome. On a 390-393px viewport it took the
// "Open Chat panel" toggle's own centre in `document.elementFromPoint`. The
// responsive geometry now lives in dash-act.css; keep it out of utilities here
// so there is one place that describes both shapes.
assert.match(
  src,
  /className="inbox-toast-stack"/,
  "the stack carries its geometry as one named class",
);
assert.doesNotMatch(
  src,
  /className="[^"]*\b(?:fixed|top-4|right-4|w-80)\b/,
  "no desktop-only positioning utilities back on the stack root",
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
