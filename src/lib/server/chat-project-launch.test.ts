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
  projectlessGenerationLaunch,
} = await import(moduleUrl.href);

function launch(overrides = {}) {
  const input = {
    origin: "canvas",
    hasRequestedProjectRoot: false,
    sshRuntime: false,
    sshHome: "/home/val",
    familiarWorkspace: "/home/val/.coven/workspaces/familiars/milo",
    ...overrides,
  };
  // Most cases have no symlink in play, so default the resolved form to the raw
  // one. A case that cares about symlinks passes resumeCwdResolved explicitly.
  if (input.resumeCwd !== undefined && !("resumeCwdResolved" in overrides)) {
    input.resumeCwdResolved = input.resumeCwd;
  }
  return projectlessGenerationLaunch(input);
}

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

// ── cave-o3nq7: the projectless exemption covers the familiar's own workspace
// and nothing else. A resume root reaches the branch from the conversation
// runtime OR from the daemon's global session list, and that list is not
// scoped to the requesting familiar — adopting one unchecked launched a
// familiar in another session's project with no grant for it.

test("a hidden generation with no resume root runs auth-free in its own workspace", () => {
  assert.deepEqual(launch(), {
    kind: "workspace",
    root: "/home/val/.coven/workspaces/familiars/milo",
  });
});

test("an ssh hidden generation keeps its remote home runtime", () => {
  assert.deepEqual(launch({ sshRuntime: true }), { kind: "workspace", root: "/home/val" });
});

test("a hidden generation with no workspace at all is refused, not launched", () => {
  assert.deepEqual(launch({ familiarWorkspace: undefined }), { kind: "unavailable" });
});

test("a resume root inside the familiar's own workspace stays auth-free", () => {
  // Multi-turn canvas: turn 1 ran auth-free in the workspace and persisted it
  // as the conversation runtime, so turn 2 must not start demanding a grant
  // for a directory that is not a registered project.
  for (const resume of [
    "/home/val/.coven/workspaces/familiars/milo",
    "/home/val/.coven/workspaces/familiars/milo/scratch",
  ]) {
    assert.deepEqual(
      launch({ resumeCwd: resume }),
      { kind: "workspace", root: resume },
      `${resume} is the familiar's own workspace`,
    );
  }
});

test("a daemon-derived resume root outside the workspace is gated", () => {
  for (const resume of [
    "/home/val/code/someone-elses-project",
    "/home/val/.coven/workspaces/familiars/milo/../nyx",
    "/home/val/.coven/workspaces/familiars/nyx",
  ]) {
    assert.deepEqual(
      launch({ resumeCwd: resume }),
      { kind: "gated" },
      `${resume} must pass the launch gate`,
    );
  }
});

test("a resume root is gated when the familiar has no workspace to compare against", () => {
  assert.deepEqual(
    launch({ resumeCwd: "/home/val/code/project", familiarWorkspace: undefined }),
    { kind: "gated" },
  );
});

test("every non-hidden origin is gated regardless of resume root", () => {
  for (const origin of [undefined, "chat", "mention", "board", "call", "cron", "heartbeat"]) {
    assert.deepEqual(
      launch({ origin, resumeCwd: undefined }),
      { kind: "gated" },
      `${origin ?? "missing"} origin is project-gated`,
    );
  }
});

test("a request that names its own project root is always gated", () => {
  assert.deepEqual(launch({ hasRequestedProjectRoot: true }), { kind: "gated" });
});

// ── cave-o3nq7 review (#4582): the containment test runs on the SYMLINK-RESOLVED
// resume root. The spawn realpaths the root and enforces only "inside $HOME", so
// a lexical check on the raw string would let a symlink planted in the familiar's
// own workspace — a directory the familiar can write to — resolve into another
// project with the launch gate skipped.

test("a workspace path that resolves outside the workspace is gated", () => {
  assert.deepEqual(
    launch({
      resumeCwd: "/home/val/.coven/workspaces/familiars/milo/link",
      resumeCwdResolved: "/home/val/code/someone-elses-project",
    }),
    { kind: "gated" },
    "a symlink out of the workspace must not inherit the exemption",
  );
});

test("an exempt resume root launches at its resolved path, not the raw one", () => {
  assert.deepEqual(
    launch({
      resumeCwd: "/home/val/.coven/workspaces/familiars/milo/link",
      resumeCwdResolved: "/home/val/.coven/workspaces/familiars/milo/real",
    }),
    { kind: "workspace", root: "/home/val/.coven/workspaces/familiars/milo/real" },
    "the decision and the launched root must be the same path",
  );
});

test("an unresolvable resume root is gated, never dropped back to the workspace", () => {
  assert.deepEqual(
    launch({ resumeCwd: "/home/val/code/gone", resumeCwdResolved: undefined }),
    { kind: "gated" },
  );
});
