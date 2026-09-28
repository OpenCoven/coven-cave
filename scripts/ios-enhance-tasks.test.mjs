// The iOS Tasks screen can run Enhance (#5652): the same all-tasks sweep as
// the web app, where each open task's assigned familiar reviews it and updates
// or closes it. Behavior is covered by CovenCaveTests/EnhanceTasksTests.swift;
// this pins the wiring that CI's web lanes can see.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../apps/ios/CovenCave/${path}`, import.meta.url), "utf8");
const client = await read("CovenCave/Networking/CaveClient.swift");
const model = await read("CovenCave/State/AppModel.swift");
const list = await read("CovenCave/Views/TasksView.swift");
const tally = await read("CovenCave/Models/EnhanceTasks.swift");
const route = await readFile(
  new URL("../src/app/api/board/enrich-steps/route.ts", import.meta.url),
  "utf8",
);

// The request matches what the route gates on: the intent header and body,
// and the all-tasks scope.
assert.match(route, /req\.headers\.get\("x-coven-cave-intent"\) !== "board-enrich-steps"/);
assert.match(
  client,
  /func enhanceTasks\(\) -> AsyncThrowingStream<EnhanceTasksEvent, Error>[\s\S]*?\["intent": "board-enrich-steps", "scope": "all"\][\s\S]*?request\("api\/board\/enrich-steps", method: "POST"[\s\S]*?setValue\("board-enrich-steps", forHTTPHeaderField: "x-coven-cave-intent"\)/,
  "the client posts the all-tasks Enhance intent",
);
// A sweep runs for many minutes; the REST session's 300 s cap would cut it.
assert.match(
  client,
  /func enhanceTasks\(\)[\s\S]*?\(injectedSession \?\? Self\.streamSession\)\.bytes\(for: req\)/,
  "Enhance streams on the long-lived session",
);

// The model runs one sweep at a time, reloads Tasks, and toasts the summary.
assert.match(model, /func enhanceAllTasks\(\) \{\s*guard enhanceTasksRun == nil, let client else \{ return \}/);
assert.match(model, /if tally\.total > 0 \|\| tally\.completed \{ await loadTasks\(\) \}/);
assert.match(model, /showToast\(tally\.summary, systemImage: "sparkles"\)/);

// The action lives in the Tasks View options menu and is disabled mid-run.
assert.match(
  list,
  /Button \{\s*app\.enhanceAllTasks\(\)\s*\} label: \{[\s\S]*?"Enhance tasks"[\s\S]*?systemImage: "sparkles"[\s\S]*?\.disabled\(app\.enhancingTasks\)/,
  "Tasks offers Enhance, disabled while a run is in flight",
);

// The phone and web summaries stay in step.
const web = await readFile(new URL("../src/lib/enrich-tasks-summary.ts", import.meta.url), "utf8");
for (const phrase of ["No open tasks to enhance right now.", "unassigned", "skipped", "not reached", "open task"]) {
  assert.ok(web.includes(phrase) && tally.includes(phrase), `both summaries say "${phrase}"`);
}

console.log("ios-enhance-tasks: ok");
