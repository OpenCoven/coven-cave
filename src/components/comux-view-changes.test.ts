// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Files / Changes toggle in the comux pane: review the selected project's
// working-tree diffs (revert + checkpoints) without leaving the coding surface.

const comux = await readFile(new URL("./comux-view.tsx", import.meta.url), "utf8");
const changes = await readFile(new URL("./session-changes-panel.tsx", import.meta.url), "utf8");

// The reusable inner panel is exported for embedding.
assert.match(
  changes,
  /export function SessionChangesInner\(\{ projectRoot, running \}/,
  "SessionChangesInner must be exported so other surfaces can embed the diff review",
);

// comux imports it and renders it for the SELECTED project (not the active
// chat session), keyed by root so state resets when the project changes.
assert.match(comux, /import \{ SessionChangesInner \} from "@\/components\/session-changes-panel"/, "comux imports SessionChangesInner");
assert.match(
  comux,
  /<SessionChangesInner[\s\S]*?key=\{selectedProject\.root\}[\s\S]*?projectRoot=\{selectedProject\.root\}[\s\S]*?running=\{projectHasRunningSession\}/,
  "comux renders SessionChangesInner for the selected project, polling while a session runs",
);

// A right-pane view toggle drives it.
assert.match(comux, /useState<"files" \| "changes">\("files"\)/, "right pane defaults to the Files view");
assert.match(comux, /onClick=\{\(\) => setRightView\("changes"\)\}/, "a Changes toggle switches the right pane");
assert.match(comux, /onClick=\{\(\) => setRightView\("files"\)\}/, "a Files toggle switches back");
assert.match(
  comux,
  /rightView === "changes" \? \([\s\S]*?<SessionChangesInner/,
  "the Changes view replaces the file preview when selected",
);

// Polling flag is derived from a running session in the selected project.
assert.match(
  comux,
  /projectHasRunningSession = recentProjectSessions\.some\(\(s\) => s\.status === "running"\)/,
  "live diff polling keys off a running session in the selected project",
);

console.log("comux-view-changes.test.ts: ok");
