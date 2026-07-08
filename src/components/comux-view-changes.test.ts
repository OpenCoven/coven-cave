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
  /export function SessionChangesInner\(\{\s*projectRoot,\s*running/,
  "SessionChangesInner must be exported so other surfaces can embed the diff review",
);

// Jump-to-diff: SessionChangesInner accepts focusPath/focusNonce and expands the
// matching file's diff (repo-relative or suffix match) when a transcript edit
// tool is clicked.
assert.match(changes, /focusPath\?: string \| null;/, "SessionChangesInner takes a focusPath prop");
// cave-bvbw moved the raw endsWith pair to a /-boundary suffix helper so
// sibling files with a common string suffix can't cross-match.
assert.match(
  changes,
  /suffixMatch\(focusPath, f\.path\) \|\| suffixMatch\(f\.path, focusPath\)/,
  "focusPath matches repo-relative or absolute paths by /-boundary suffix",
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

// Transcript edit tool → diff jump: comux listens for cave:open-file-diff,
// pins + switches to Changes, and focuses the file via a nonce.
assert.match(comux, /window\.addEventListener\("cave:open-file-diff"/, "comux listens for the open-file-diff jump");
assert.match(
  comux,
  /setRightView\("changes"\);\s*setFocusDiff\(\(prev\) => \(\{ path: detail\.path!, nonce: \(prev\?\.nonce \?\? 0\) \+ 1 \}\)\)/,
  "open-file-diff pins Changes and bumps the focus nonce",
);
assert.match(comux, /focusPath=\{focusDiff\?\.path \?\? null\}[\s\S]*?focusNonce=\{focusDiff\?\.nonce\}/, "focus is forwarded to SessionChangesInner");

const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
assert.match(chatView, /const isEditTool = inputDiff != null/, "ToolBlock detects edit tools by their input diff");
assert.match(
  chatView,
  /isEditTool \? "cave:open-file-diff" : "cave:open-project-file"/,
  "edit tools jump to the diff; other file tools open the preview",
);

console.log("comux-view-changes.test.ts (diff-first) checks passed");

// Polling flag is derived from a running session in the selected project.
assert.match(
  comux,
  /projectHasRunningSession = recentProjectSessions\.some\(\(s\) => s\.status === "running"\)/,
  "live diff polling keys off a running session in the selected project",
);

// ── 2026-07-03 code-surface audit (perf): changes poll content guard ─────────
assert.match(changes, /import \{ arrayContentEqual \} from "@\/lib\/array-content-equal"/, "changes panel imports the content-equality guard");
assert.match(changes, /setFiles\(\(prev\) => \(arrayContentEqual\(prev, nextFiles\) \? prev : nextFiles\)\)/, "the 5s changes poll keeps the previous reference when the diff is unchanged");
// ── 2026-07-03 code a11y batch ────────────────────────────────────────────────
assert.match(comux, /const \{ announce \} = useAnnouncer\(\)/, "comux consumes the announcer");
assert.match(comux, /announce\("File saved\."\)/, "saving a file announces");
assert.match(comux, /role="group" aria-label="Right pane view"[\s\S]*?aria-pressed=\{rightView === "files"\}/, "Files/Changes toggle is a group with aria-pressed");
assert.match(comux, /role="group" aria-label="Preview format"[\s\S]*?aria-pressed=\{!previewRaw\}/, "Rendered/Raw toggle is a group with aria-pressed");
assert.match(changes, /const \{ announce \} = useAnnouncer\(\)/, "the changes panel consumes the announcer");
assert.match(changes, /announce\("Changes committed\."\)/, "committing announces");
assert.match(changes, /announce\("Pull request opened\."\)/, "opening a PR announces");
assert.match(changes, /announce\("File reverted/, "reverting announces");

console.log("comux-view-changes.test.ts: ok");
