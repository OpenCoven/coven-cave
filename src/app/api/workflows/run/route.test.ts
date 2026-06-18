// @ts-nocheck
//
// File-read smoke for the workflow run route. Locks in the session executor:
// when the daemon has no native workflow engine (404) but is reachable, the
// route compiles the manifest into an orchestration prompt and spawns a real
// agent session, instead of dead-ending to "engine unavailable".

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

// Security: the route mutates (spawns sessions) so it must reject non-local
// callers and read the body through the bounded guard.
assert.match(source, /rejectNonLocalRequest\(req\)/, "run route must reject non-local requests");
assert.match(source, /readJsonBody<RunBody>\(req, MAX_SESSION_JSON_BYTES\)/, "run route must read the body through the bounded guard");

// Daemon-first: the native engine is still tried before anything local.
assert.match(source, /path:\s*"\/api\/v1\/workflows\/run"/, "run route probes the native daemon engine first");
assert.match(source, /executor:\s*"engine"/, "a native-engine run is tagged executor: engine");

// 404 (reachable, no engine) → the session executor runs it for real.
assert.match(source, /engine\.status === 404[\s\S]{0,80}runViaSession\(body\)/, "a 404 from the engine hands off to the session executor");

// The session executor compiles the manifest and spawns a real agent session.
assert.match(source, /buildWorkflowRunPrompt\(workflow\)/, "session executor compiles the manifest into a run prompt");
assert.match(source, /path:\s*"\/api\/v1\/sessions"/, "session executor spawns a daemon agent session");
assert.match(source, /harness:\s*binding\.harness/, "session executor honors the familiar's harness binding");
assert.match(source, /isAllowedHarness\(binding\.harness\)/, "session executor guards the harness allow-list");
assert.match(source, /executor:\s*"session"/, "a session run is tagged executor: session");
assert.match(source, /sessionId,/, "a session run returns the live session id");

// The run lands in history as a real execution (status running, source cave).
assert.match(source, /recordRun\(\{[\s\S]{0,200}status:\s*"running"/, "a session run records a running execution");
assert.match(source, /source:\s*"cave"/, "a session-executed run is sourced to cave");

// Honesty: only a truly unreachable daemon yields `unavailable: true`.
assert.match(source, /engine\.status === 0[\s\S]{0,120}unavailable:\s*true/, "an offline daemon yields unavailable, not a fake run");
assert.match(source, /res\.status === 0[\s\S]{0,120}unavailable:\s*true/, "a daemon that drops during spawn yields unavailable");

console.log("workflow run route.test.ts: ok");
