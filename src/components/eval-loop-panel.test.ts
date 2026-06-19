// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./eval-loop-panel.tsx", import.meta.url), "utf8");
const skillsRoute = readFileSync(new URL("../app/api/skills/route.ts", import.meta.url), "utf8");
const evalLoopRoute = readFileSync(new URL("../app/api/skills/eval-loop/[familiarId]/route.ts", import.meta.url), "utf8");
const evalLoopRunRoute = readFileSync(new URL("../app/api/skills/eval-loop/[familiarId]/run/route.ts", import.meta.url), "utf8");

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

console.log("eval-loop-panel.test.ts: ok");
