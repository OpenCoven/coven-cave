// @ts-nocheck
// The draft endpoint runs a headless model assist from operator input — its
// security posture (local-origin gate, body cap, the SHARED read-only assist
// runner, parse-or-502, and crucially: NO filesystem writes) is what these
// assertions pin down. The write stays with the creation-only build route.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(route, /rejectNonLocalRequest\(req\)/, "skill drafting is local-origin gated");
assert.match(route, /readJsonBody<\{ description\?: unknown \}>\(req, MAX_BODY_BYTES\)/, "body is size-capped and parsed defensively");
assert.match(route, /runBoundedAssist\(\{/, "generation goes through the shared read-only assist runner");
assert.match(route, /parseSkillDraftOutput\(run\.lastMessage\)/, "output is parsed against the strict contract");
assert.match(route, /status: 502 \}/, "contract mismatch is a retryable 502, never a filled form");
assert.doesNotMatch(route, /buildSkill\(|writeFile|mkdir/, "the draft endpoint never writes — the build route stays the trust boundary");
assert.doesNotMatch(route, /child_process|execFile|spawn\(/, "no ad-hoc process spawning outside the runner");
assert.match(route, /maxDuration = 300/, "route budget covers the bounded assist run");

console.log("skills/draft route.test.ts OK");
