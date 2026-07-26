// @ts-nocheck
// The caveman endpoint rewrites operator-typed skill fields through the
// SHARED read-only assist runner — same posture as skills/draft: local-origin
// gate, body cap, parse-or-502, and crucially NO filesystem writes (the
// creation-only build route stays the trust boundary).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const route = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

assert.match(route, /rejectNonLocalRequest\(req\)/, "caveman rewrite is local-origin gated");
assert.match(route, /readJsonBody<\{ name\?: unknown; description\?: unknown; instructions\?: unknown \}>\(req, MAX_BODY_BYTES\)/, "body is size-capped and parsed defensively");
assert.match(route, /SKILL_CAVEMAN_INSTRUCTIONS_MAX/, "instructions input is budget-capped");
assert.match(route, /runBoundedAssist\(\{/, "generation goes through the shared read-only assist runner");
assert.match(route, /parseSkillDraftOutput\(run\.lastMessage\)/, "output reuses the strict draft contract parser");
assert.match(route, /status: 502 \}/, "contract mismatch is a retryable 502, never a filled form");
assert.doesNotMatch(route, /tags/, "tags never round-trip — they are not rewritten");
assert.doesNotMatch(route, /buildSkill\(|writeFile|mkdir/, "the caveman endpoint never writes");
assert.doesNotMatch(route, /child_process|execFile|spawn\(/, "no ad-hoc process spawning outside the runner");
assert.match(route, /maxDuration = 300/, "route budget covers the bounded assist run");

console.log("skills/caveman route.test.ts OK");
