import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const exists = (rel: string) => existsSync(path.join(root, rel));

const workspaceMode = read("src/lib/workspace-mode.ts");
const workspace = read("src/components/workspace.tsx");
const lazySurfaces = read("src/components/lazy-surfaces.tsx");
const globals = read("src/app/globals.css");
const slash = read("src/lib/slash-commands.ts");
const apiContracts = read("src/app/api/api-contracts.test.ts");
const analytics = read("src/components/familiar-analytics-view.tsx");
const threadSignals = read("src/components/thread-signals-section.tsx");

assert.doesNotMatch(workspaceMode, /\|\s*"evals"|\|\s*"retro"/, "workspace modes should not include evals or legacy retro");
assert.doesNotMatch(workspace, /EvalsView|mode === "evals"|mode === "retro"|case "\/evals"|case "\/retro"/, "workspace should not route or render the Evals surface");
assert.doesNotMatch(lazySurfaces, /EvalsView|components\/evals/, "lazy surfaces should not load Evals");
assert.doesNotMatch(globals, /evals\.css/, "global CSS should not import evals styles");
assert.doesNotMatch(slash, /\/evals|\/eval-loops|Open Evals/, "slash commands should not expose Evals");
assert.doesNotMatch(apiContracts, /\/evals\//, "API contract list should not include evals routes");

for (const rel of [
  "src/app/api/evals",
  "src/components/evals",
  "src/lib/evals",
  "src/lib/server/eval-store.ts",
  "src/components/eval-loop-panel.tsx",
  "src/styles/evals.css",
  "src/app/api/skills/eval-loop/[familiarId]/run",
  "src/app/api/skills/eval-loop/[familiarId]/run-lock",
]) {
  assert.equal(exists(rel), false, `${rel} should be removed`);
}

assert.match(analytics, /ThreadSignalsSection/, "familiar analytics keeps thread signal analytics");
assert.match(analytics, /ResponseConfidenceSection/, "familiar analytics keeps response confidence analytics");
assert.doesNotMatch(analytics, /EvalLoopPanel/, "familiar analytics should not embed eval-loop UI");
assert.doesNotMatch(threadSignals, /origin:\s*"eval"/, "thread signal discussions should not be tagged as eval threads");
assert.match(threadSignals, /dashboard\/familiars\/\$\{encodeURIComponent\(familiarId\)\}\/analytics/, "thread signal follow-up stays tied to familiar analytics");

console.log("evals-removal.test.ts: ok");
