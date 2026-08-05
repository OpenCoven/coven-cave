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
  const historical = assistantTurn("local:/repo-a");

  assert.equal(turnToolProjectRoot(historical, "/repo-a"), "/repo-a");
  assert.equal(
    turnToolProjectRoot(historical, "/repo-b"),
    "/repo-a",
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
  assert.equal(
    turnToolProjectRoot(assistantTurn("local:relative/repo"), "/repo-b"),
    null,
    "a relative runtime cwd is not a trustworthy historical root snapshot",
  );
  assert.equal(sessionToolProjectRoot("local:relative/repo", "/repo-b"), null);
  assert.equal(
    turnToolProjectRoot(assistantTurn("local:../repo-a"), "/repo-b"),
    null,
    "a traversing runtime cwd cannot authorize historical mutation actions",
  );
});

test("local execution provenance preserves significant POSIX trailing spaces", () => {
  if (process.platform !== "win32") {
    assert.equal(
      turnToolProjectRoot(assistantTurn("local:/projects/repo "), "/projects/repo"),
      "/projects/repo ",
      "a trailing space is part of the recorded POSIX repository name",
    );
    assert.equal(
      sessionToolProjectRoot(undefined, "/projects/repo "),
      "/projects/repo ",
      "session display metadata preserves the same POSIX root bytes",
    );
  }

  assert.equal(
    turnToolProjectRoot(assistantTurn("local:   "), "/projects/repo"),
    null,
    "a whitespace-only execution root is not authority",
  );
  assert.equal(
    turnToolProjectRoot(assistantTurn("local:/projects/repo\tchild"), "/projects/repo"),
    null,
    "control characters are rejected rather than normalized into another path",
  );
  assert.equal(
    turnToolProjectRoot(assistantTurn("local:C:\\Projects\\Repo\\ "), "/projects/repo"),
    "C:/Projects/Repo",
    "Windows roots retain their portable trimming and separator normalization",
  );
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
