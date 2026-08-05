import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileCodeReadingTargetRoot,
  resolveCodeReadingTargetPath,
} from "./code-reading-target.ts";

const pending = {
  turnId: "turn-a",
  sourceSessionId: "session-a",
  projectRoot: null,
  code: "const value = 1;",
};

test("pending reader target gains settled provenance without changing identity", () => {
  const settled = reconcileCodeReadingTargetRoot(
    pending,
    "session-a",
    new Map([["turn-a", "/repo/a"]]),
  );

  assert.equal(settled?.projectRoot, "/repo/a");
  assert.equal(settled?.turnId, pending.turnId);
  assert.equal(settled?.sourceSessionId, pending.sourceSessionId);
  assert.equal(settled?.code, pending.code);
  assert.equal(
    reconcileCodeReadingTargetRoot(settled, "session-a", new Map([["turn-a", "/repo/b"]])),
    settled,
    "an immutable settled root is never retargeted",
  );
});

test("active session switch cannot reconcile a reader from another pane", () => {
  const unchanged = reconcileCodeReadingTargetRoot(
    pending,
    "session-b",
    new Map([["turn-a", "/repo/b"]]),
  );

  assert.equal(unchanged, pending);
  assert.equal(unchanged?.projectRoot, null);
  assert.equal(unchanged?.sourceSessionId, "session-a");
});

test("an open pre-session reader is promoted in place when the chat gets its session id", () => {
  const preSession = {
    ...pending,
    sourceSessionId: null,
    projectRoot: null,
  };

  const promoted = reconcileCodeReadingTargetRoot(
    preSession,
    "session-assigned",
    new Map([["turn-a", "/repo/a"]]),
    "session-assigned",
  );

  assert.equal(promoted?.sourceSessionId, "session-assigned");
  assert.equal(promoted?.projectRoot, "/repo/a");
  assert.equal(promoted?.turnId, preSession.turnId);
  assert.equal(promoted?.code, preSession.code);
});

test("a pre-session reader is not promoted when the user opens an unrelated session", () => {
  const preSession = {
    ...pending,
    sourceSessionId: null,
    projectRoot: null,
  };

  const unchanged = reconcileCodeReadingTargetRoot(
    preSession,
    "existing-session",
    new Map([["turn-a", "/repo/a"]]),
    null,
  );

  assert.equal(unchanged, preSession);
  assert.equal(unchanged?.sourceSessionId, null);
  assert.equal(unchanged?.projectRoot, null);
});

test("code-fence working-tree targets resolve only within their captured project", () => {
  assert.deepEqual(resolveCodeReadingTargetPath("/repo/packages/app", "src/a.ts"), {
    absolutePath: "/repo/packages/app/src/a.ts",
    relativePath: "src/a.ts",
  });
  assert.equal(resolveCodeReadingTargetPath("/repo/packages/app", "../src/a.ts"), null);
  assert.equal(resolveCodeReadingTargetPath("/repo/packages/app", "/repo/src/a.ts"), null);
  assert.equal(
    resolveCodeReadingTargetPath("C:/Repo/App", "c:/repo/other/a.ts"),
    null,
  );
});
