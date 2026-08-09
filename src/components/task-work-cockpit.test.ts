import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./task-work-cockpit.tsx", import.meta.url), "utf8");

assert.match(source, /resolveTaskWorkTarget\([\s\S]{0,120}card\.sessionId[\s\S]{0,160}fallbackSession/);
assert.match(source, /<ChatView[\s\S]*sessionId=\{conversation\.sessionId\}/);
assert.match(source, /sessionId: target\.session\.id/, "a resumed task still drives ChatView from the resolved target session");
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
  /\.task-work-cockpit__body > \.cave-chat-linear,\n\.task-work-cockpit__group \.cave-chat-linear \{[\s\S]{0,200}?flex: 1;[\s\S]{0,200}?min-width: 0;/,
  "the cockpit conversation fills its row in BOTH branches (task-chat alignment)",
);
// Both entry paths go through ONE Group/Panel tree (cave-6une3). The bridge
// handoff used to render a bare ChatView straight into the body, which is how
// it ended up with no width (cave-itm75) and then no code rail at all. Exactly
// one <ChatView> in the file is the structural guarantee.
assert.equal(
  source.match(/<ChatView/g)?.length,
  1,
  "both cockpit entry paths share a single ChatView inside the conversation Panel",
);
assert.match(
  source,
  /<div className="task-work-cockpit__body">\s*\{conversation && familiar \? \(\s*<Group/,
  "the cockpit body opens straight into the resizable Group for both paths",
);

// The Group is keyed by the pane set, so toggling the rail REMOUNTS ChatView.
// The auto-send guard is an instance ref, so without a remount-proof latch that
// remount re-sent the task's first prompt. The handoff id is what survives it.
assert.match(
  source,
  /initialPromptHandoffId=\{conversation\.handoffId\}/,
  "the bridge handoff passes a remount-proof id so a rail toggle cannot re-send it",
);
assert.match(
  source,
  /handoffId: card\.sessionId \?\? card\.id/,
  "the handoff id is the reserved conversation id, stable across the Group remount",
);
assert.match(
  source,
  /handoffId: null/,
  "a resumed task has no handoff to latch",
);
// The latch is module-scoped on purpose, so leaving the task must release it —
// otherwise reopening the card sits on a claimed id and never sends.
assert.match(
  source,
  /return \(\) => releaseInitialPromptHandoff\(CHAT_VIEW_HANDOFF_SCOPE, handoffId\)/,
  "the cockpit releases its handoff latch on unmount",
);
// The rail mounts for BOTH paths now; gating it on the ready branch is what
// made the reopen strip a dead end during a bridge-start session.
assert.match(
  source,
  /railController\.showInline && conversation\.railSessionId/,
  "the code rail Panel mounts from the shared descriptor, not the resumed branch",
);

// The collapsed code rail is an in-flow flex child sized against a flex ROW
// (44px wide, full height). The cockpit root is a flex COLUMN, so hosting it
// there docked it as a stub in the bottom-left corner under the composer.
// It belongs inside the body row, before the body closes.
const bodyStart = source.indexOf('<div className="task-work-cockpit__body">');
const railStart = source.indexOf('className="workspace-rail-reopen focus-ring"');
const sheetStart = source.indexOf("<WorkspaceRailSheet");
assert.ok(bodyStart > -1 && railStart > bodyStart, "the reopen rail renders after the cockpit body opens");
// The `</div>` immediately before the rail sheet closes the body row, so the
// rail button must fall on the inside of it.
const bodyEnd = source.lastIndexOf("</div>", sheetStart);
assert.ok(bodyEnd > bodyStart, "the cockpit body row closes before the rail sheet");
assert.ok(railStart < bodyEnd, "the reopen rail renders inside the cockpit body row, not as a column child");
assert.match(
  cockpitCss,
  /\.task-work-cockpit__body > \.workspace-rail-reopen \{[\s\S]{0,200}?flex: 0 0 44px;[\s\S]{0,200}?align-self: stretch;/,
  "the reopen rail reserves a full-height 44px column beside the conversation",
);
