// @ts-nocheck
import assert from "node:assert/strict";

import {
  addTerminalSession,
  closeTerminalSession,
  createTerminalLayout,
  focusTerminalSession,
  moveTerminalPane,
  normalizeTerminalLayout,
  removeTerminalPaneView,
  renameTerminalSession,
  reorderTerminalSessions,
  splitTerminalPane,
  terminalLayoutVisibleSessionIds,
  type TerminalLayoutState,
} from "./terminal-layout.ts";

function session(id: string, label = id, projectRoot = `/tmp/${id}`) {
  return { id, label, projectRoot };
}

function ids(state: TerminalLayoutState): string[] {
  return terminalLayoutVisibleSessionIds(state);
}

// The full session (tab) list, in tab order — what reorder/close mutate. Read
// inline off `state.sessions` now that the terminalLayoutSessionIds helper (dead
// in production) is gone.
function sessionIds(state: TerminalLayoutState): string[] {
  return state.sessions.map((session) => session.id);
}

{
  const state = createTerminalLayout([session("a")], "a");

  assert.deepEqual(ids(state), ["a"], "initial layout renders the first session");
  assert.equal(state.activeSessionId, "a", "initial layout focuses requested session");
  assert.deepEqual(state.root, { kind: "leaf", sessionId: "a" });
}

{
  let state = createTerminalLayout([session("a")], "a");
  state = addTerminalSession(state, session("b"), {
    placement: "split",
    targetSessionId: "a",
    side: "right",
  });

  assert.deepEqual(ids(state), ["a", "b"], "split inserts the new session once");
  assert.deepEqual(
    state.root,
    {
      kind: "horizontal",
      children: [
        { size: 50, node: { kind: "leaf", sessionId: "a" } },
        { size: 50, node: { kind: "leaf", sessionId: "b" } },
      ],
    },
    "same-axis split is represented as a branch instead of a flat pane list",
  );
}

{
  let state = createTerminalLayout([session("a")], "a");
  state = addTerminalSession(state, session("b"), {
    placement: "split",
    targetSessionId: "a",
    side: "right",
  });
  state = addTerminalSession(state, session("c"), {
    placement: "split",
    targetSessionId: "a",
    side: "bottom",
  });

  assert.deepEqual(ids(state), ["a", "c", "b"], "nested mixed-direction splits preserve visual order");
  assert.deepEqual(
    state.root,
    {
      kind: "horizontal",
      children: [
        {
          size: 50,
          node: {
            kind: "vertical",
            children: [
              { size: 50, node: { kind: "leaf", sessionId: "a" } },
              { size: 50, node: { kind: "leaf", sessionId: "c" } },
            ],
          },
        },
        { size: 50, node: { kind: "leaf", sessionId: "b" } },
      ],
    },
    "Cast Codes-style pane tree can nest vertical splits inside horizontal splits",
  );

  state = moveTerminalPane(state, {
    sourceSessionId: "b",
    targetSessionId: "c",
    side: "left",
  });
  assert.deepEqual(ids(state), ["a", "b", "c"], "moving a pane rehosts its existing session");
  assert.equal(new Set(ids(state)).size, ids(state).length, "moving a pane never duplicates a session");
  assert.equal(state.activeSessionId, "b", "moved pane becomes the active focus target");
}

{
  let state = createTerminalLayout([session("a"), session("b")], "b");
  state = splitTerminalPane(state, {
    sourceSessionId: "b",
    targetSessionId: "a",
    side: "right",
  });
  state = removeTerminalPaneView(state, "b");

  assert.deepEqual(ids(state), ["a"], "removing a split hides the pane from the tree");
  assert.deepEqual(sessionIds(state), ["a", "b"], "removing a split does not close the shell session");
  assert.equal(state.activeSessionId, "a", "focus falls back to a visible session");

  state = focusTerminalSession(state, "b");
  assert.deepEqual(ids(state), ["b"], "focusing a hidden session reattaches it into the visible tree");
  assert.equal(state.activeSessionId, "b", "reattached session becomes active");
}

{
  const root = {
    kind: "horizontal",
    children: [
      { size: 50, node: { kind: "leaf", sessionId: "a" } },
      { size: 50, node: { kind: "leaf", sessionId: "b" } },
    ],
  };
  const state: TerminalLayoutState = {
    version: 1,
    sessions: [session("a"), session("b"), session("c")],
    activeSessionId: "b",
    root,
  };
  const next = reorderTerminalSessions(state, "c", "a");

  assert.deepEqual(
    sessionIds(next),
    ["c", "a", "b"],
    "dropping a terminal tab onto another tab reorders only the tab list",
  );
  assert.equal(next.activeSessionId, "b", "reordering tabs preserves the active pane");
  assert.equal(next.root, root, "reordering tabs does not mutate the split pane tree");
}

{
  let state = createTerminalLayout([session("a"), session("b")], "a");
  state = splitTerminalPane(state, {
    sourceSessionId: "b",
    targetSessionId: "a",
    side: "right",
  });
  state = renameTerminalSession(state, "b", "Build");
  state = closeTerminalSession(state, "a");

  assert.deepEqual(sessionIds(state), ["b"], "closing removes the session record");
  assert.deepEqual(ids(state), ["b"], "closing collapses singleton branches");
  assert.equal(state.sessions[0].label, "Build", "renames stay on the session record");
  assert.equal(state.activeSessionId, "b", "closing active pane chooses the surviving visible session");
}

{
  let state = createTerminalLayout([session("a"), session("b")], "a");
  state = closeTerminalSession(state, "a");

  assert.deepEqual(sessionIds(state), ["b"], "closing removes only the requested session");
  assert.deepEqual(ids(state), ["b"], "closing the last visible pane reattaches a remaining hidden session");
  assert.equal(state.activeSessionId, "b", "the reattached session receives focus");
}

{
  const persisted: TerminalLayoutState = {
    version: 1,
    sessions: [session("a"), session("b")],
    activeSessionId: "missing",
    root: { kind: "leaf", sessionId: "missing" },
  };
  const state = normalizeTerminalLayout(persisted);

  assert.deepEqual(ids(state), ["a"], "invalid persisted roots fall back to a visible known session");
  assert.equal(state.activeSessionId, "a", "invalid persisted active ids fall back to the visible root");
}

console.log("terminal-layout.test.ts OK");
