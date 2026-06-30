// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./eval-loop-panel.tsx", import.meta.url), "utf8");
const skillsRoute = readFileSync(new URL("../app/api/skills/route.ts", import.meta.url), "utf8");
const evalLoopRoute = readFileSync(new URL("../app/api/skills/eval-loop/[familiarId]/route.ts", import.meta.url), "utf8");
const evalLoopRunRoute = readFileSync(new URL("../app/api/skills/eval-loop/[familiarId]/run/route.ts", import.meta.url), "utf8");
const evalLoopRunLockRoute = readFileSync(new URL("../app/api/skills/eval-loop/[familiarId]/run-lock/route.ts", import.meta.url), "utf8");

assert.match(
  source,
  /error \? \(\s*<button[\s\S]{0,800}aria-label=\{`Start eval-loop for \$\{familiarName\}`\}/,
  "inactive eval-loop state should render as a keyboard-accessible start button",
);

assert.match(
  source,
  /onClick=\{\(\) => void triggerRun\("synthesis"\)\}/,
  "clicking the inactive eval-loop panel should start a default synthesis iteration",
);

assert.match(
  source,
  /if \(!res\.ok \|\| !json\?\.ok\) \{[\s\S]{0,160}setError\(json\?\.error \?\? "failed to start eval-loop"\);[\s\S]{0,120}setTriggering\(false\);/,
  "failed eval-loop run responses should surface the daemon error and clear the starting state",
);

assert.match(
  source,
  /if \(json\.ok\) \{[\s\S]{0,120}setState\(json\.state as EvalLoopState\);[\s\S]{0,80}setError\(null\);/,
  "successful refreshes should clear the inactive/error state",
);

assert.match(
  source,
  /type EvalLoopLockState = \{[\s\S]*?locked: boolean;[\s\S]*?runId\?: string \| null;[\s\S]*?stale: boolean;/,
  "EvalLoopPanel should model daemon lock metadata",
);

assert.match(
  source,
  /aria-label=\{`Clear eval-loop lock for \$\{familiarName\}`\}/,
  "locked eval-loop state should render a keyboard-accessible clear-lock button",
);

assert.match(
  source,
  /currentLock\.stale \? "clear stale" : "force clear"/,
  "active locks should make the destructive force-clear action explicit",
);

assert.match(
  source,
  /Run controls are paused by the \$\{currentLock\.stale \? "stale" : "active"\} eval-loop lock/,
  "locked running state should explain why iteration buttons are disabled",
);

assert.match(
  source,
  /aria-describedby=\{runBlockedReason \? "eval-loop-run-blocked-reason" : undefined\}/,
  "disabled run buttons should reference the visible blocked-run explanation",
);

assert.match(
  source,
  /Waiting for \$\{activeTrack !== "all" \? TRACK_LABEL\[activeTrack as Track\] : "eval-loop"\} results from the active run/,
  "empty running tracks should read as waiting for results, not as a terminal empty state",
);

assert.match(
  source,
  /fetch\("\/api\/skills\/eval-loop\/" \+ familiarId \+ "\/run-lock"/,
  "clear-lock handler should call the Cave run-lock proxy",
);

assert.match(
  evalLoopRoute,
  /ok: false,[\s\S]*?state: null,[\s\S]*?\}\s*\);/,
  "inactive/offline eval-loop reads should return a quiet ok:false payload",
);

assert.doesNotMatch(
  evalLoopRoute,
  /\{\s*status:\s*503\s*\}/,
  "inactive/offline eval-loop reads should not create browser-console 503 noise",
);

assert.match(
  evalLoopRoute,
  /state: redactSecretsDeep\(unwrapDaemonEvalState\(res\.data\)\)/,
  "successful eval-loop reads should unwrap the daemon envelope so consumers get the EvalLoopState directly (not a double-wrapped { ok, state })",
);

assert.match(
  skillsRoute,
  /NextResponse\.json\([\s\S]*?ok: false,[\s\S]*?skills: \[\]/,
  "offline skills reads should return a quiet ok:false payload",
);

assert.doesNotMatch(
  skillsRoute,
  /\{\s*status:\s*503\s*\}/,
  "offline skills reads should not create browser-console 503 noise",
);

assert.match(
  evalLoopRunRoute,
  /ok: false,[\s\S]*?error:[\s\S]*?\}\s*\);/,
  "failed optional eval-loop runs should return a quiet ok:false payload",
);

assert.doesNotMatch(
  evalLoopRunRoute,
  /\{\s*status:\s*503\s*\}/,
  "failed optional eval-loop runs should not create browser-console 503 noise",
);

assert.match(
  evalLoopRunLockRoute,
  /path: `\/api\/v1\/skills\/eval-loop\/\$\{familiarId\}\/run-lock`/,
  "run-lock proxy should call the daemon-owned lock recovery endpoint",
);

assert.match(
  evalLoopRunLockRoute,
  /let body:[\s\S]{0,160}=\s*\{\}/,
  "run-lock proxy should tolerate empty or malformed JSON bodies",
);

console.log("eval-loop-panel.test.ts: ok");
