// @ts-nocheck
// PR 2 / Task 2: the Terminal tab of the code rail hosts the reusable
// BottomTerminal on a per-session pty thread id. Source-text guard.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./rail-terminal-panel.tsx", import.meta.url), "utf8");

assert.match(src, /export function RailTerminalPanel\(/, "exports RailTerminalPanel");
assert.match(
  src,
  /import \{ BottomTerminal \} from "@\/components\/bottom-terminal"/,
  "hosts the reusable BottomTerminal",
);
// Rail fallback stays stable, while split instances receive their own PTY
// identity so they never steal a sibling terminal's process.
assert.match(src, /paneInstanceId\?: string/, "accepts a workspace pane instance");
assert.match(src, /const threadId = paneInstanceId \? `cave\.pane\.\$\{paneInstanceId\}\.\$\{sessionId\}` : `cave\.rail\.\$\{sessionId\}`/, "uses pane-stable PTY identities with the rail fallback");
assert.match(src, /threadId=\{threadId\}/, "passes the derived identity to BottomTerminal");
assert.match(src, /projectRoot=\{projectRoot \?\? undefined\}/, "threads projectRoot as the cwd");
assert.match(src, /active=\{active\}/, "forwards the active flag (fit/focus only when visible)");
// Null-session empty state — no pty without a session.
assert.match(src, /if \(!sessionId\)/, "guards the null-sessionId case");
assert.match(src, /Open a session to use the terminal/, "renders a muted empty state");
// Minimal host — no broadcast/split wiring.
assert.doesNotMatch(src, /registerWriter|onUserInput|paneId/, "no broadcast/split wiring");

// A split pane the user just opened focuses its own host before the shell
// starts, once per pane (#5807); one a layout restored leaves focus alone.
assert.match(src, /focusOnOpen\?: boolean/, "accepts focusOnOpen");
assert.match(src, /if \(!focusOnOpen \|\| !paneInstanceId \|\| !host\) return;/, "only a user-opened split pane takes focus");
assert.match(src, /if \(focusedPaneInstances\.has\(paneInstanceId\)\) return;\s*focusedPaneInstances\.add\(paneInstanceId\);/, "a remounted pane does not pull focus back");
assert.match(src, /if \(!host\.contains\(document\.activeElement\)\) host\.focus\(\);/, "focus moves into the host");
assert.match(src, /data-terminal-host=""\s*tabIndex=\{-1\}/, "the split pane has a focusable terminal host");
assert.match(src, /if \(!paneInstanceId\) return terminal;/, "the rail keeps its own host");

const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
assert.match(workspace, /openedByUser\(normalizeWorkspacePaneRequest\(nextPaneInstanceId\(\), m\)\)/, "a split drop is the user opening the page");
assert.match(workspace, /focusOnOpen=\{request\.openedByUser === true\}/, "the terminal pane is told whether the user opened it");

console.log("rail-terminal-panel.test.ts OK");
