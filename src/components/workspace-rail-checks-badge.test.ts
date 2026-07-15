// @ts-nocheck
// Wiring pins: the code-rail failing-checks badge (cave-fpqx.12, design
// docs/chat-github-integration.md §6) — one stage source (the chat stage
// header broadcast), a peripheral dot only, no new tab, no reveal changes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const header = readFileSync(new URL("./chat-stage-header.tsx", import.meta.url), "utf8");
const rail = readFileSync(new URL("./workspace-rail.tsx", import.meta.url), "utf8");
const surface = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../lib/use-stage-checks-badge.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/cave-chat.css", import.meta.url), "utf8");
const railLogic = readFileSync(new URL("../lib/code-rail.ts", import.meta.url), "utf8");

// Broadcast side: the header owns the snapshot; fires on change AND resets on
// unmount so a stale red dot can't outlive its cause.
assert.match(header, /snapshot\?\.pr && snapshot\.pr\.checkStatus === "failing"/, "failing signal derives from the stage snapshot's PR rollup");
assert.match(header, /new CustomEvent\(STAGE_CHECKS_EVENT, \{ detail \}\)/, "header broadcasts the stage-checks event");
assert.match(header, /detail: \{ projectRoot, failing: false \}/, "unmount clears the badge");

// Listener side: filtered by project root, resets when the root changes.
assert.match(hook, /d\?\.projectRoot === projectRoot/, "hook filters events to its project root");
assert.match(hook, /setFailing\(false\);\s*\n\s*if \(!projectRoot\) return;/, "hook resets on root change");

// Rail strip badge + a11y label; collapsed reopen strip too.
assert.match(rail, /useStageChecksBadge\(projectRoot\)/, "rail reads the badge signal");
assert.match(rail, /workspace-rail__badge--alert/, "rail renders the alert dot");
assert.match(rail, /"Changes — PR checks failing"/, "changes tab announces the failing state");
assert.match(surface, /useStageChecksBadge\(effectiveRailRoot\)/, "collapsed reopen strip reads the same signal");
assert.match(surface, /"Show code rail — PR checks failing"/, "reopen strip announces the failing state");
assert.match(css, /\.workspace-rail__badge--alert \{/, "alert dot styled");

// Design §6 guardrail: no new signals into the reveal resolver.
assert.doesNotMatch(railLogic, /checks|stage/i, "resolveCodeRail's reveal inputs stay checks-free");

console.log("rail checks badge wiring: ok");
