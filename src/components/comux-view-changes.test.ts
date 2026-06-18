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

// A right-pane view toggle drives it. Clicking a toggle pins the choice so the
// diff-first auto-switch won't override an explicit selection.
assert.match(comux, /useState<"files" \| "changes">\("files"\)/, "right pane defaults to the Files view");
assert.match(comux, /pinnedRightViewRef\.current = true; setRightView\("changes"\)/, "Changes toggle switches + pins the view");
assert.match(comux, /pinnedRightViewRef\.current = true; setRightView\("files"\)/, "Files toggle switches + pins the view");
assert.match(
  comux,
  /rightView === "changes" \? \([\s\S]*?<SessionChangesInner/,
  "the Changes view replaces the file preview when selected",
);

// Diff-first review: the comux pane polls a lightweight changes summary and
// auto-switches to Changes the first time edits appear (0 → >0), unless pinned.
assert.match(comux, /import \{ useChangesSummary \} from "@\/lib\/use-changes-summary"/, "comux uses the changes-summary hook");
assert.match(
  comux,
  /useChangesSummary\(\s*selectedProject\?\.root,\s*rightView !== "changes" && projectHasRunningSession,/,
  "the summary poll is gated to Files view + a running session (pauses when Changes is shown)",
);
assert.match(
  comux,
  /!pinnedRightViewRef\.current &&[\s\S]*?rightView === "files" &&[\s\S]*?prev === 0 &&[\s\S]*?changesSummary\.count > 0[\s\S]*?setRightView\("changes"\)/,
  "auto-switch to Changes on the first edit transition when the user hasn't pinned a view",
);

console.log("comux-view-changes.test.ts (diff-first) checks passed");

// Polling flag is derived from a running session in the selected project.
assert.match(
  comux,
  /projectHasRunningSession = recentProjectSessions\.some\(\(s\) => s\.status === "running"\)/,
  "live diff polling keys off a running session in the selected project",
);

console.log("comux-view-changes.test.ts: ok");
