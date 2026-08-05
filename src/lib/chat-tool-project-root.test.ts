import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mapConversationHistoryTurns,
  sessionToolProjectRoot,
  turnToolProjectRoot,
  type Turn,
} from "./chat-turn-state.ts";

function assistantTurn(runtime?: string): Turn {
  return {
    id: "assistant-1",
    role: "assistant",
    text: "",
    createdAt: "2026-08-05T00:00:00.000Z",
    ...(runtime
      ? {
          responseMetadata: {
            familiarId: "nova",
            harness: "claude",
            model: "model",
            runtime,
          },
        }
      : {}),
  };
}

test("historical tool actions use the turn runtime after the active project switches", () => {
  const historical = assistantTurn("local:/projects/original");

  assert.equal(turnToolProjectRoot(historical, "/projects/original"), "/projects/original");
  assert.equal(
    turnToolProjectRoot(historical, "/projects/newly-selected"),
    "/projects/original",
    "a later session or picker root cannot retarget a turn with execution metadata",
  );
});

test("legacy turns never inherit a session root, including after transcript reload", () => {
  const sessionRoot = sessionToolProjectRoot("local:/projects/original", "/other");
  assert.equal(sessionRoot, "/projects/original");
  assert.equal(
    turnToolProjectRoot(assistantTurn(), sessionRoot),
    null,
    "a legacy in-memory turn has no immutable execution provenance",
  );

  const [reloaded] = mapConversationHistoryTurns([
    {
      id: "legacy-assistant",
      role: "assistant",
      text: "",
      createdAt: "2026-08-05T00:00:00.000Z",
    },
  ]);
  assert.ok(reloaded);
  assert.equal(
    turnToolProjectRoot(reloaded, sessionToolProjectRoot("local:/projects/latest", "/projects/latest")),
    null,
    "reloading cannot attach the session's latest root to a legacy turn",
  );
  assert.equal(sessionToolProjectRoot(undefined, "/projects/legacy"), "/projects/legacy");
  assert.equal(sessionToolProjectRoot("ssh:builder:/srv/repo", "/projects/local-shadow"), null);
  assert.equal(turnToolProjectRoot(assistantTurn("ssh:builder:/srv/repo"), "/projects/local-shadow"), null);
  assert.equal(turnToolProjectRoot(assistantTurn("not-a-runtime"), "/projects/local-shadow"), null);
});

test("a malformed non-empty session runtime cannot fall back to mutable project metadata", () => {
  assert.equal(sessionToolProjectRoot("not-a-runtime", "/projects/latest"), null);
  assert.equal(sessionToolProjectRoot("local:", "/projects/latest"), null);
});

test("an in-flight turn without execution metadata fails closed", () => {
  assert.equal(
    turnToolProjectRoot({ ...assistantTurn(), pending: true }, "/projects/previous-turn"),
    null,
  );
  assert.equal(
    turnToolProjectRoot(
      { ...assistantTurn(), lifecycle: "failed" },
      "/projects/previous-turn",
    ),
    null,
  );
});
