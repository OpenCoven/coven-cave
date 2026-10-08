import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The event plane's watchers start from Next's instrumentation hook, the root
// instrumentation.ts, only in the Node runtime and only when the plane is
// switched on (#5843). With it off there is no daemon poll and no file watch.
const source = readFileSync(new URL("../instrumentation.ts", import.meta.url), "utf8");
const nodeGate = source.indexOf('if (process.env.NEXT_RUNTIME !== "nodejs") return;');
const planeGate = source.indexOf("if (isEventPlaneEnabled(process.env)) {");
const daemon = source.indexOf("startDaemonEventWatcher();");
const familiars = source.indexOf("startFamiliarRosterWatch();");
assert.ok(nodeGate !== -1 && planeGate !== -1 && daemon !== -1 && familiars !== -1, "the hook starts both watchers");
assert.ok(nodeGate < planeGate && planeGate < daemon && planeGate < familiars, "both gates run before either watcher starts");
assert.match(
  source.slice(planeGate - 400, familiars + 500),
  /catch \(error\) \{\s*console\.warn\("\[instrumentation\] event plane watchers could not start:", error\);/,
  "a watcher that fails to start never blocks the server",
);
const board = source.indexOf("startBoardFileWatch();");
assert.ok(board > planeGate, "the board file watch starts behind the same gate (#5858)");
console.log("instrumentation-event-plane.test.ts: ok");
