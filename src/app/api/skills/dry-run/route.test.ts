// @ts-nocheck
// The dry-run endpoint feeds operator-authored skill text into a headless
// model probe — pinned here: local-origin gate, body cap, the SHARED
// read-only assist runner for BOTH probes, strict verdict contracts with
// parse-or-502, and no writes (verdicts are advisory, never a gate).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(route, /rejectNonLocalRequest\(req\)/, "dry-runs are local-origin gated");
assert.match(route, /readJsonBody<DryRunBody>\(req, MAX_BODY_BYTES\)/, "body is size-capped and parsed defensively");
assert.match(route, /mode === "walkthrough"\s*\?\s*buildSkillWalkthroughPrompt/, "walkthroughs use the narration-only prompt");
assert.match(route, /buildSkillTriggerCheckPrompt/, "trigger checks use the frontmatter-only prompt");
assert.match(route, /runBoundedAssist\(\{ prompt \}\)/, "both probes run through the shared read-only assist runner");
assert.match(route, /parseTriggerCheckOutput/, "trigger verdicts are parsed against the strict contract");
assert.match(route, /parseWalkthroughOutput/, "walkthrough verdicts are parsed against the strict contract");
assert.match(route, /instructions required for a walkthrough/, "walkthroughs validate their extra input");
assert.doesNotMatch(route, /writeFile|mkdir|buildSkill\(/, "dry-runs never write — verdicts are advisory");
assert.doesNotMatch(route, /child_process|execFile|spawn\(/, "no ad-hoc process spawning outside the runner");
assert.match(route, /maxDuration = 300/, "route budget covers the bounded assist run");

console.log("skills/dry-run route.test.ts OK");
