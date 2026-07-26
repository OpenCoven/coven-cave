// @ts-nocheck
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const moduleUrl = new URL("./chat-project-launch.ts", import.meta.url);
assert.equal(
  existsSync(moduleUrl),
  true,
  "the shared typed/voice project launch gate should exist",
);

const {
  authorizeChatProjectLaunch,
  ChatProjectLaunchError,
  isProjectlessGenerationOrigin,
} = await import(moduleUrl.href);

function harness(overrides = {}) {
  const calls = {
    validate: [],
    resolve: [],
    access: [],
  };
  const deps = {
    validateProjectRoot: (root) => {
      calls.validate.push(root);
      return { ok: true, root: `/real${root}` };
    },
    resolveProjectId: (requestedRoot, resolvedRoot) => {
      calls.resolve.push([requestedRoot, resolvedRoot]);
      return "project-1";
    },
    isProjectRegistered: () => true,
    hasProjectAccess: async (familiarId, projectId, surface) => {
      calls.access.push([familiarId, projectId, surface]);
      return true;
    },
    ...overrides,
  };
  return { deps, calls };
}

async function expectLaunchError(run, code, status) {
  await assert.rejects(
    run,
    (error) =>
      error instanceof ChatProjectLaunchError &&
      error.code === code &&
      error.status === status,
  );
}

test("only hidden generation origins may use the legacy projectless runtime", () => {
  for (const origin of ["enhance", "journal", "canvas"]) {
    assert.equal(isProjectlessGenerationOrigin(origin), true, `${origin} is a hidden generation`);
  }
  for (const origin of [undefined, "chat", "mention", "board", "call", "cron", "heartbeat"]) {
    assert.equal(isProjectlessGenerationOrigin(origin), false, `${origin ?? "missing"} is project-gated`);
  }
});

test("missing project root fails before validation or access", async () => {
  const { deps, calls } = harness();
  await expectLaunchError(
    () => authorizeChatProjectLaunch(deps, {
      familiarId: "milo",
      projectRoot: null,
      surface: "chat",
    }),
    "project_root_required",
    400,
  );
  assert.deepEqual(calls, { validate: [], resolve: [], access: [] });
});

test("a missing directory fails before registration or access checks", async () => {
  const { deps, calls } = harness({
    validateProjectRoot: (root) => {
      calls.validate.push(root);
      return { ok: false, error: "root does not exist" };
    },
  });
  await expectLaunchError(
    () => authorizeChatProjectLaunch(deps, {
      familiarId: "milo",
      projectRoot: "/missing",
      surface: "chat",
    }),
    "project_root_unavailable",
    400,
  );
  assert.deepEqual(calls.resolve, []);
  assert.deepEqual(calls.access, []);
});

test("an unregistered directory is rejected before access assertion", async () => {
  const { deps, calls } = harness({
    resolveProjectId: (requestedRoot, resolvedRoot) => {
      calls.resolve.push([requestedRoot, resolvedRoot]);
      return `unregistered:${requestedRoot}`;
    },
  });
  await expectLaunchError(
    () => authorizeChatProjectLaunch(deps, {
      familiarId: "milo",
      projectRoot: "/scratch",
      surface: "session-launch",
    }),
    "project_not_registered",
    400,
  );
  assert.deepEqual(calls.access, []);
});

test("a stale server-owned project override is rejected before access assertion", async () => {
  const { deps, calls } = harness({
    isProjectRegistered: () => false,
  });
  await expectLaunchError(
    () => authorizeChatProjectLaunch(deps, {
      familiarId: "milo",
      projectRoot: "/board-worktree",
      projectIdOverride: "deleted-project",
      surface: "chat",
    }),
    "project_not_registered",
    400,
  );
  assert.deepEqual(calls.resolve, []);
  assert.deepEqual(calls.access, []);
});

test("a registered project without familiar access is denied", async () => {
  const { deps, calls } = harness({
    hasProjectAccess: async (familiarId, projectId, surface) => {
      calls.access.push([familiarId, projectId, surface]);
      return false;
    },
  });
  await expectLaunchError(
    () => authorizeChatProjectLaunch(deps, {
      familiarId: "milo",
      projectRoot: "/repo",
      surface: "chat",
    }),
    "project_access_denied",
    403,
  );
  assert.deepEqual(calls.access, [["milo", "project-1", "chat"]]);
});

test("a registered accessible directory returns its canonical root and id", async () => {
  const { deps, calls } = harness();
  const result = await authorizeChatProjectLaunch(deps, {
    familiarId: "milo",
    projectRoot: " /repo ",
    surface: "session-launch",
  });
  assert.deepEqual(result, { root: "/real/repo", projectId: "project-1" });
  assert.deepEqual(calls.resolve, [["/repo", "/real/repo"]]);
  assert.deepEqual(calls.access, [["milo", "project-1", "session-launch"]]);
});

test("a registered worktree authorizes through its parent project id", async () => {
  const { deps, calls } = harness({
    resolveProjectId: (requestedRoot, resolvedRoot) => {
      calls.resolve.push([requestedRoot, resolvedRoot]);
      return requestedRoot.includes("/.worktrees/") ? "parent-project" : null;
    },
  });
  const result = await authorizeChatProjectLaunch(deps, {
    familiarId: "milo",
    projectRoot: "/repo/.worktrees/feature",
    surface: "chat",
  });
  assert.deepEqual(result, {
    root: "/real/repo/.worktrees/feature",
    projectId: "parent-project",
  });
  assert.deepEqual(calls.access, [["milo", "parent-project", "chat"]]);
});
