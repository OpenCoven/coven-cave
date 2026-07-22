// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./running-sessions-popover.tsx", import.meta.url), "utf8");

// ── Trigger ──────────────────────────────────────────────────────────────────
// The waveform control is a real button now: selecting it shows the running
// processes. It keeps the menu-bar status chrome + corner count badge and
// hides at zero like every other zero-hidden badge in the bar.
assert.match(
  source,
  /if \(count === 0\) return null;/,
  "the control hides entirely at zero running processes",
);
assert.match(
  source,
  /<button\s+type="button"\s+className="menu-bar__status focus-ring"\s+onClick=\{\(\) => setOpen\(\(v\) => !v\)\}\s+aria-haspopup="dialog"\s+aria-expanded=\{open\}/,
  "the trigger is a focus-ring button that toggles the process list and announces the popover state",
);
assert.match(
  source,
  /const label = `\$\{count\} running process\$\{count === 1 \? "" : "es"\}`;/,
  "the exact process count is carried by the trigger label",
);
assert.match(
  source,
  /<Icon name="ph:waveform"[\s\S]{0,160}?<span className="menu-bar__badge" aria-hidden>\s*\{fmtBadge\(count\)\}\s*<\/span>/,
  "the trigger keeps the waveform icon + capped corner badge",
);

// ── Popover ──────────────────────────────────────────────────────────────────
// Focus-trapped dialog (Escape closes, focus restores to the trigger) with an
// outside-click close — same pattern as NotificationBell.
assert.match(
  source,
  /useFocusTrap\(open, popoverRef, \{ onEscape: \(\) => setOpen\(false\) \}\)/,
  "the popover traps focus and closes on Escape",
);
assert.match(
  source,
  /role="dialog"\s+aria-modal="true"\s+aria-label="Running processes"\s+tabIndex=\{-1\}/,
  "the popover is an accessible Running processes dialog",
);
assert.match(
  source,
  /window\.addEventListener\("pointerdown", onDown\)/,
  "the popover closes on outside click",
);

// ── Rows ─────────────────────────────────────────────────────────────────────
// Each running process reads familiar · project · started time, newest first,
// and a click jumps into that chat and closes the list.
assert.match(
  source,
  /\[\.\.\.sessions\]\.sort\(\(a, b\) => \(b\.created_at \|\| ""\)\.localeCompare\(a\.created_at \|\| ""\)\)/,
  "processes list newest-first",
);
assert.match(
  source,
  /familiars\.find\(\(f\) => f\.id === session\.familiarId\)\?\.display_name \?\? session\.familiarId/,
  "rows name the owning familiar (id fallback)",
);
assert.match(
  source,
  /\[familiarName \?\? session\.harness, shortProjectRoot\(session\.project_root\)\]/,
  "rows fall back to the harness name and show the short project root",
);
assert.match(
  source,
  /\{sessionDisplayTitle\(session\)\}/,
  "rows show the sanitized session title",
);
assert.match(
  source,
  /started <RelativeTime iso=\{session\.created_at\} fallback="—" \/>/,
  "rows show when the process started",
);
assert.match(
  source,
  /useMinuteTick\(\);/,
  "row timestamps tick each minute while the popover stays open",
);
assert.match(
  source,
  /onOpen=\{\(session\) => \{\s*setOpen\(false\);\s*onOpenSession\(session\.id, session\.familiarId\);\s*\}\}/,
  "clicking a process closes the list and opens that chat session",
);

console.log("running-sessions-popover.test.ts: ok");
