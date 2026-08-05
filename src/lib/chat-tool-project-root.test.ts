import assert from "node:assert/strict";
import { test } from "node:test";

import {
  sessionToolProjectRoot,
  sessionToolProjectRootForIdentity,
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

test("legacy turns use only an evidence-based local session fallback", () => {
  assert.equal(
    turnToolProjectRoot(assistantTurn(), sessionToolProjectRoot("local:/projects/original", "/other")),
    "/projects/original",
  );
  assert.equal(sessionToolProjectRoot(undefined, "/projects/legacy"), "/projects/legacy");
  assert.equal(sessionToolProjectRoot("ssh:builder:/srv/repo", "/projects/local-shadow"), null);
  assert.equal(turnToolProjectRoot(assistantTurn("ssh:builder:/srv/repo"), "/projects/local-shadow"), null);
  assert.equal(turnToolProjectRoot(assistantTurn("not-a-runtime"), "/projects/local-shadow"), null);
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

test("legacy session fallback is captured from session metadata, never a later project", () => {
  const roots = new Map<string, string | null>();

  assert.equal(
    sessionToolProjectRootForIdentity(roots, "session-a", undefined, undefined),
    null,
    "missing metadata is not mistaken for evidence",
  );
  assert.equal(
    sessionToolProjectRootForIdentity(
      roots,
      "session-a",
      "local:/projects/original",
      "/projects/original",
    ),
    "/projects/original",
  );
  assert.equal(
    sessionToolProjectRootForIdentity(
      roots,
      "session-a",
      "local:/projects/newly-selected",
      "/projects/newly-selected",
    ),
    "/projects/original",
  );
  assert.equal(
    sessionToolProjectRootForIdentity(
      roots,
      "session-ssh",
      "ssh:builder:/srv/repo",
      "/projects/local-shadow",
    ),
    null,
    "a recorded SSH session remains fail-closed",
  );
});
