// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const progress = readFileSync(new URL("./workflow-run-progress.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("./workflow-runs-panel.tsx", import.meta.url), "utf8");

// ── Live status is announced to assistive tech ───────────────────────────────
// The headline updates "Running: <step>" → "All N steps reported" live; without
// a live region a screen-reader user following a run hears nothing.
assert.match(
  progress,
  /className="workflow-run-progress-head" role="status" aria-live="polite"/,
  "the live run-status headline is a polite live region",
);
assert.match(progress, /<p className="workflow-muted" role="alert">\{error\}<\/p>/, "the transcript-fetch error is announced");

// ── Transcript poll pauses while the tab is hidden ───────────────────────────
assert.match(progress, /if \(document\.hidden\) return;/, "the tick skips fetching while the tab is hidden");
assert.match(
  progress,
  /const onVisible = \(\) => \{ if \(!document\.hidden && alive && live\) void tick\(\); \};/,
  "polling resumes with an immediate refresh when the tab becomes visible",
);
assert.match(progress, /addEventListener\("visibilitychange", onVisible\)/, "a visibility listener drives resume");
assert.match(progress, /removeEventListener\("visibilitychange", onVisible\)/, "the visibility listener is cleaned up");
assert.match(progress, /if \(timer\) \{ clearTimeout\(timer\); timer = null; \}/, "a stale timer is cleared before each tick so resume can't double-poll");

// ── Disclosure toggles pair aria-expanded with aria-controls ─────────────────
// Step-detail toggle (run-progress)
assert.match(
  progress,
  /aria-controls=\{hasDetail \? `\$\{detailBaseId\}-\$\{step\.id\}` : undefined\}/,
  "the step-detail toggle controls its detail region",
);
assert.match(
  progress,
  /<pre id=\{`\$\{detailBaseId\}-\$\{step\.id\}`\} className="workflow-progress-step-detail">/,
  "the step detail region carries the controlled id",
);
// Run-row toggle (runs-panel)
assert.match(panel, /aria-controls=\{`workflow-run-exp-\$\{run\.id\}`\}/, "the run row controls its expansion region");
assert.match(panel, /<div className="workflow-run-expansion" id=\{`workflow-run-exp-\$\{run\.id\}`\}>/, "the run expansion region carries the controlled id");

console.log("workflow-run-detail-a11y.test.ts: ok");
