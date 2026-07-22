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
  /body: \{ projectRoot, harness: binding\.harness, prompt, launchMode: "nonInteractive" \},/,
  "flow session spawn must not pass familiarId natively to the daemon",
);
assert.match(source, /launchMode: "nonInteractive"/, "flow session output should be plain assistant text, not harness TUI output");
assert.match(source, /recordSessionFamiliar\(sessionId, familiarId\)/, "familiar is still mirrored into cave-state");
assert.match(
  source,
  /function initialFlowRunStepStatus/,
  "flow runs should seed local trigger/input step status immediately",
);
assert.match(
  source,
  /def\?\.isTrigger[\s\S]*"succeeded"/,
  "trigger nodes should start as succeeded so runs visibly move past Start",
);
assert.match(
  source,
  /node\?\.type\.startsWith\("input\."\)[\s\S]*"succeeded"/,
  "input nodes should start as succeeded because required inputs were already collected",
);
assert.match(
  source,
  /seenActiveAgentStep[\s\S]*"running"/,
  "first non-local executable node should start as running until live markers arrive",
);

assert.match(
  source,
  /const hubAuthority = config\.multiHost\?\.mode === "hub";[\s\S]*binding\.harness === "copilot" && !sshBound && !hubAuthority/,
  "direct copilot flow spawn must not bypass configured hub authority",
);

// Flow prompts direct familiars to write memory/self-reports into their own
// workspace, but the spawn cwd is the project root and a non-interactive run
// can't prompt for permission — the workspace must ride as a harness-level
// trust grant or every such write hard-fails. Callers (e.g. research
// missions) can grant additional roots such as the mission workspace.
assert.match(
  source,
  /startCopilotFlowRun\(\{[\s\S]*?addDirs: \[[\s\S]*?\.\.\.\(options\.addDirs \?\? \[\]\),[\s\S]*?\.\.\.await flowFamiliarAddDirs\(familiarId, projectRoot\),[\s\S]*?\],[\s\S]*?\}\);/,
  "direct copilot flow spawn must trust caller grants and the familiar's own workspace via addDirs",
);
assert.match(
  source,
  /function flowFamiliarAddDirs[\s\S]*?isValidFamiliarId\(familiarId\)[\s\S]*?realpath\(await familiarWorkspace\(familiarId\)\)/,
  "the workspace grant must be slug-validated and canonicalized before trusting",
);

console.log("flow-executor.test.ts: ok");
