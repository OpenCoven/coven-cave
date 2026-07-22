import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./task-work-cockpit.tsx", import.meta.url), "utf8");

assert.match(source, /resolveTaskWorkTarget\([\s\S]{0,120}card\.sessionId[\s\S]{0,160}fallbackSession/);
assert.match(source, /<ChatView[\s\S]*sessionId=\{target\.session\.id\}/);
assert.match(source, /onBack=\{onClose\}/);
assert.match(source, /Preparing work session/);
assert.match(source, /Work session unavailable/);
assert.match(source, /onSessionsDeleted=\{\(sessionIds\) =>/);
assert.match(source, /includeArchived: "1"/);
assert.match(source, /Unlink missing session/);
assert.match(source, /onUnlinkSession/);
assert.match(source, /tabIndex=\{-1\}/);
assert.match(source, /focus-ring/);
assert.match(source, /useWorkspaceRailController/);
assert.match(source, /<WorkspaceRail/);
assert.match(source, /<WorkspaceRailSheet/);
assert.doesNotMatch(source, /ChatRouter|ChatList/);
// The resizable Group must remount per pane set: the library retains a layout
// per panel-id set, and without the key a collapsed code rail left the
// conversation panel at its stale two-panel width beside dead space.
assert.match(
  source,
  /<Group\s*\n(?:\s*(?:className|orientation)=[^\n]*\n|\s*\/\/[^\n]*\n)*\s*key=\{railController\.showInline \? "conversation-rail" : "conversation"\}/,
  "cockpit Group is keyed by the visible pane set so a solo conversation fills the cockpit",
);
// ChatView's root carries no width of its own; inside the conversation
// Panel (a horizontal flex row) it shrink-wrapped to content and the thread
// sat left-crammed beside dead space. The cockpit CSS must stretch it.
const cockpitCss = await readFile(new URL("../styles/task-work-cockpit.css", import.meta.url), "utf8");
assert.match(
  cockpitCss,
  /\.task-work-cockpit__group \.cave-chat-linear \{[\s\S]{0,200}?flex: 1;[\s\S]{0,200}?min-width: 0;/,
  "the cockpit conversation fills its panel (task-chat alignment)",
);
