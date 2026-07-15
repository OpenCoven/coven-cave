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

// Publish side: the header owns the snapshot; publishStageChecks records the
// state for late-mounting listeners AND broadcasts; the clear fires only on
// unmount/root change (no transient false between true states).
assert.match(header, /snapshot\?\.pr && snapshot\.pr\.checkStatus === "failing"/, "failing signal derives from the stage snapshot's PR rollup");
assert.match(header, /publishStageChecks\(projectRoot, failing\);\s*\n\s*\}, \[projectRoot, failing\]\);/, "header publishes on every signal change");
assert.match(header, /publishStageChecks\(projectRoot, false\);[\s\S]{0,40}\}, \[projectRoot\]\);/, "the clear fires only on unmount/root change");

// Listener side: store replay at mount (a rail opened AFTER checks went red
// still shows the dot — cave-r0gt), root-filtered, normalized roots.
assert.match(hook, /export function publishStageChecks/, "publish records state + broadcasts");
assert.match(hook, /stageChecksState\.set\(root, failing\)/, "module store is the replay source");
assert.match(hook, /useState\(\(\) => \(root \? \(stageChecksState\.get\(root\) \?\? false\) : false\)\)/, "listeners initialize from the store, not false");
assert.match(hook, /d\?\.projectRoot === root/, "hook filters events to its project root");
assert.match(hook, /function normalizeRoot/, "roots normalize on both sides so derivations can't drift on slashes");

// Rail strip badge + a11y label; collapsed reopen strip too.
assert.match(rail, /useStageChecksBadge\(projectRoot\)/, "rail reads the badge signal");
assert.match(rail, /workspace-rail__badge--alert/, "rail renders the alert dot");
assert.match(rail, /"Changes — PR checks failing"/, "changes tab announces the failing state");
assert.match(surface, /useStageChecksBadge\(railProjectRoot\)/, "collapsed reopen strip keys on the session root (cave-r0gt)");
assert.match(surface, /"Show code rail — PR checks failing"/, "reopen strip announces the failing state");
assert.match(css, /\.workspace-rail__badge--alert \{/, "alert dot styled");

// Design §6 guardrail: no coupling of the badge signal into the reveal
// resolver — the cue must stay peripheral. Names are specific so unrelated
// git vocabulary (staged/unstage) can't false-fail this pin.
assert.doesNotMatch(railLogic, /STAGE_CHECKS_EVENT|useStageChecksBadge|checksFailing/, "resolveCodeRail's reveal inputs stay badge-free");

console.log("rail checks badge wiring: ok");
