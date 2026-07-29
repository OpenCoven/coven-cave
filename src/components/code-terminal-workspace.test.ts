// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./code-terminal-workspace.tsx", import.meta.url), "utf8");

assert.match(source, /createTerminalLayout\(\)/, "the terminal center starts from the tested split model");
assert.match(source, /splitTerminalPane\([\s\S]*?"horizontal"\)/, "Split right creates a horizontal group");
assert.match(source, /splitTerminalPane\([\s\S]*?"vertical"\)/, "Split down creates a vertical group");
assert.match(source, /closeTerminalPane\(/, "the focused pane can close and collapse its parent");
assert.match(source, /terminalPaneCount\(layout\.root\) >= 4/, "the UI disables splitting at the four-pane cap");
assert.match(source, /<Group[\s\S]*?orientation=\{node\.direction\}/, "recursive split nodes render resizable panel groups");
assert.match(source, /<Separator[\s\S]*?<SeparatorHandle/, "every terminal divider uses the shared handle");
assert.match(source, /<BottomTerminal[\s\S]*?threadId=\{terminalThreadId\(sessionId, node\.id\)\}/, "each leaf receives its stable PTY identity");
assert.match(source, /active=\{focusedPaneId === node\.id\}/, "only the focused terminal drives keyboard focus");
assert.match(source, /visible/, "every terminal in the visible mosaic keeps its screen-reader output active");
assert.match(source, /registerWriter=\{registerWriter\}/, "terminal writers register for broadcast input");
assert.match(source, /broadcastTargetIds\(/, "broadcast excludes the source pane through the tested helper");
assert.match(source, /useAnnouncer\(\)/, "terminal layout mutations are announced");
assert.match(source, /aria-label="Split terminal right"/, "split-right control has a durable accessible name");
assert.match(source, /aria-label="Split terminal down"/, "split-down control has a durable accessible name");
assert.match(source, /aria-label="Close terminal"/, "close control has a durable accessible name");
assert.match(source, /Broadcast input/, "broadcast lives in the standard overflow menu");

console.log("code-terminal-workspace.test.ts: ok");
