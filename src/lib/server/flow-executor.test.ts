import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./flow-executor.ts", import.meta.url), "utf8");

// A flow runs as a plain harness session. Passing `familiarId` natively to the
// daemon makes some setups try to run the session *as* that familiar and reject
// it with "no familiar configured for this harness". The familiar is carried in
// the compiled prompt and mirrored into cave-state via recordSessionFamiliar, so
// the daemon body must NOT include familiarId.
assert.match(
  source,
  /body: \{ projectRoot, harness: binding\.harness, prompt \},/,
  "flow session spawn must not pass familiarId natively to the daemon",
);
assert.match(source, /recordSessionFamiliar\(sessionId, familiarId\)/, "familiar is still mirrored into cave-state");

console.log("flow-executor.test.ts: ok");
