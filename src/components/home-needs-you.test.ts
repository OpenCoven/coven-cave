// @ts-nocheck
// cave-925w — morning triage: Home's "Needs you" strip. Pins the three phases:
// (1) the strip surfaces the needs-you tier with each row one click from its
// target, (2) the header links today's /daily-report, (3) the strip and the
// Schedules nav badge share ONE groupInboxFeed memo so they can never disagree.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const strip = await readFile(new URL("./home/home-needs-you.tsx", import.meta.url), "utf8");
const composer = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/home-composer.css", import.meta.url), "utf8");

// ── Phase 3: one source of truth ──────────────────────────────────────────────
assert.match(
  workspace,
  /const inboxNeedsYou = useMemo\(\s*\(\) => groupInboxFeed\(inboxItemsWithEphemeral\)\.needsYou,/,
  "workspace computes the needs-you tier once",
);
assert.match(
  workspace,
  /const scheduleNeedsCount = inboxNeedsYou\.length;/,
  "the Schedules nav badge derives from that same memo",
);
assert.match(workspace, /needsYou=\{inboxNeedsYou\}/, "Home receives the same group, not a copy");

// ── Rows reuse existing plumbing, no new stores/APIs ──────────────────────────
assert.match(
  workspace,
  /needsYou=\{inboxNeedsYou\}\s*onOpenInboxItem=\{openInspectorInboxItem\}/,
  "strip rows open items through the same handler the bell popover uses",
);
assert.match(
  workspace,
  /onOpenSchedules=\{\(\) => setMode\("inbox"\)\}/,
  "the overflow affordance jumps to the Schedules surface",
);
assert.doesNotMatch(strip, /fetch\(/, "the strip fetches nothing — data arrives via props");

// ── Strip behavior ────────────────────────────────────────────────────────────
assert.match(strip, /const MAX_ROWS = 3/, "at most three rows inline");
assert.match(strip, /\+\{overflow\} more/, "overflow collapses into a +N more chip");
assert.match(strip, /onClick=\{onOpenSchedules\}/, "+N more opens Schedules");
assert.match(strip, /"Waiting on you"/, "response-needed rows say so instead of a timestamp");
assert.match(strip, /"All clear"/, "an empty tier still answers the question");
assert.match(strip, /aria-label="Needs you"/, "the strip is a named region for AT");
assert.match(strip, /useMinuteTick\(\)/, "persistently mounted strip keeps its times honest");

// ── Phase 2: today's report link ──────────────────────────────────────────────
assert.match(
  strip,
  /const reportSlug = mounted \? dateSlug\(new Date\(\)\) : null/,
  "report date sampled after mount (deterministic SSR, same pattern as the greeting)",
);
assert.match(strip, /\/daily-report\/\$\{reportSlug\}/, "header links today's daily report");

// ── Placement + chrome ────────────────────────────────────────────────────────
assert.ok(
  composer.indexOf("<HomeNeedsYou") > composer.indexOf("home-composer-card-wrap") &&
    composer.indexOf("<HomeNeedsYou") < composer.indexOf("<HomeSuggestions"),
  "strip sits between the composer card and the suggestion pills",
);
assert.match(css, /\.home-needs-you \{/, "strip styles live in the home stylesheet");
assert.match(
  css,
  /\.home-needs-you \{ animation-delay: 100ms; \}/,
  "strip joins the page-load choreography between card and pills",
);
assert.match(
  css,
  /--color-warning\) 30%, var\(--border-hairline\)/,
  "attention tint follows the design-language recipe (30% border)",
);

console.log("home-needs-you.test.ts: ok");
