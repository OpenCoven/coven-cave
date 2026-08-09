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

console.log("rail-terminal-panel.test.ts OK");
