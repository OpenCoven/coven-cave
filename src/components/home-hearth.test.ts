// @ts-nocheck
// Home dashboard — launcher direction 3a ("work-led dashboard"). Home is a
// full-bleed shell, not a centered hearth card. Pins:
//   (1) shell order: identity chrome → context rail + open-work board →
//       docked composer; the old centered hearth card / hero are retired;
//   (2) the rail carries Project · Quick start · Pick up (the resumable-
//       sessions strip moved here, off the standalone <HomeContinue>);
//   (3) the board reads the live Tasks board and offers All/Running/Blocked/
//       Inbox filter tabs; the "needs you" tier joins it as inbox rows;
//   (4) the From-task row stays prop-driven and explicitly unwired.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const composer = await readFile(new URL("./home-composer.tsx", import.meta.url), "utf8");
const fromTask = await readFile(new URL("./home/home-from-task.tsx", import.meta.url), "utf8");
const disclosure = await readFile(new URL("./home/use-home-disclosure.ts", import.meta.url), "utf8");
const boardHook = await readFile(new URL("./home/use-dashboard-board.ts", import.meta.url), "utf8");
const openWork = await readFile(new URL("./home/dashboard-open-work.ts", import.meta.url), "utf8");

// ── (1) Full-bleed shell, in order ───────────────────────────────────────
assert.match(
  composer,
  /home-composer-root home-dash[\s\S]*?home-dash__chrome[\s\S]*?home-dash__rail[\s\S]*?home-dash__board[\s\S]*?home-dash__dock[\s\S]*?home-composer-card-wrap/,
  "the shell stacks chrome → rail + board → docked composer",
);
assert.doesNotMatch(composer, /home-hearth-card/, "the centered hearth card is retired");
assert.doesNotMatch(composer, /home-composer-hero/, "the centered hero block is retired");

// ── (2) Context rail — Project · Quick start · Pick up ───────────────────
assert.match(composer, /home-dash__rail-label">Project</, "the rail leads with the Project group");
assert.match(composer, /home-dash__rail-label">Quick start</, "the rail carries a Quick start group");
assert.match(composer, /home-dash__quick-row[\s\S]*?insertPrompt\(/, "quick-start rows seed the composer draft");
assert.match(composer, /setSnippetsBrowserOpen\(true\)/, "a quick-start row opens the prompt-snippets browser");
assert.match(composer, /home-dash__rail-label">Pick up</, "the rail surfaces a Pick up group");
assert.match(composer, /resumableSessions\(sessions, 2\)/, "Pick up shows the two most-recent resumable sessions");
assert.doesNotMatch(composer, /<HomeContinue/, "the standalone Continue component is retired (resumables live in the rail)");

// ── (3) Open-work board — live data + filter tabs ────────────────────────
assert.match(composer, /const boardCards = useDashboardBoard\(\)/, "the board reads the live Tasks board");
assert.match(boardHook, /fetch\("\/api\/board", \{ cache: "no-store" \}\)/, "the dashboard board snapshot is fetched once");
// home-composer keeps exactly one /api/board call site (the Task-create POST);
// the board GET lives in the dashboard hook, not the component.
const boardFetches = composer.match(/fetch\("\/api\/board"/g) ?? [];
assert.equal(
  boardFetches.length,
  1,
  "home-composer keeps exactly one /api/board call site (the Task-create POST)",
);
assert.match(composer, /OPEN_WORK_FILTERS\.map/, "the board renders the filter tabs");
assert.match(
  openWork,
  /OPEN_WORK_FILTERS: OpenWorkFilter\[\] = \["all", "running", "blocked", "inbox"\]/,
  "the tabs are All/Running/Blocked/Inbox",
);
assert.match(
  composer,
  /onOpen: \(\) => onOpenInboxItem\(item\)/,
  "the 'needs you' tier joins the board as rows that open their own target",
);
assert.match(
  openWork,
  /priority === "high" \|\| priority === "urgent"/,
  "only high/urgent priorities show a colored label (mock parity)",
);

// ── (4) Recent threads + docked composer ─────────────────────────────────
assert.match(composer, /home-dash__rail-label">Recent threads</, "a Recent threads list renders under Open work");
assert.match(
  composer,
  /home-dash__dock[\s\S]*?home-composer-card cave-composer-panel/,
  "the real chat-parity composer is docked (not a static bar)",
);

// ── (5) From-task row — built, conditional, explicitly unwired ───────────
assert.match(fromTask, /if \(!origin\) return null/, "the row renders only with a task origin");
assert.match(fromTask, /\.slice\(0, 3\)/, "chips cap at three (uniform-row rule)");
assert.match(fromTask, /From task/, "the accent 'From task' label renders");
assert.match(
  composer,
  /const taskOrigin: HomeTaskOrigin \| null = null;/,
  "home passes null — no task→home handoff exists yet (see the NOTE)",
);

// ── Shared plumbing ───────────────────────────────────────────────────────
// Disclosure prefs read AFTER mount (SSR-deterministic, like the greeting).
assert.match(
  disclosure,
  /useState\(defaultOpen\);\s*useEffect\(\(\) => \{\s*setOpen\(readDisclosurePref\(key, defaultOpen\)\);/s,
  "stored prefs land post-mount so hydration can't drift",
);

console.log("home-hearth.test.ts: ok");
