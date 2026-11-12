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

// ── cave-g8fqc: the exemption describes an UNREGISTERED workspace directory.
// Nothing enforced that: a user can register a project whose root lives under
// ~/.coven/workspaces/familiars/<id>/, and the containment test alone then
// handed a genuinely registered project an auth-free launch.

test("a registered project inside the familiar's workspace is gated, not exempt", () => {
  for (const resume of [
    "/home/val/.coven/workspaces/familiars/milo",
    "/home/val/.coven/workspaces/familiars/milo/registered-repo",
  ]) {
    assert.deepEqual(
      launch({ resumeCwd: resume, resumeCwdIsRegisteredProject: true }),
      { kind: "gated" },
      `${resume} maps to a registered project, so its grant must be checked`,
    );
  }
});

test("registration does not widen the exemption beyond the workspace", () => {
  // The containment test still runs first. A root outside the workspace is
  // gated whether or not it is registered, so this flag can only ever REMOVE
  // an exemption, never grant one.
  for (const registered of [true, false, undefined]) {
    assert.deepEqual(
      launch({ resumeCwd: "/home/val/code/other", resumeCwdIsRegisteredProject: registered }),
      { kind: "gated" },
      `an outside root stays gated with resumeCwdIsRegisteredProject=${String(registered)}`,
    );
  }
});

test("an unregistered workspace root keeps its auth-free launch", () => {
  // The multi-turn canvas case this exemption exists for must be untouched.
  const resume = "/home/val/.coven/workspaces/familiars/milo/scratch";
  for (const registered of [false, undefined]) {
    assert.deepEqual(
      launch({ resumeCwd: resume, resumeCwdIsRegisteredProject: registered }),
      { kind: "workspace", root: resume },
      `an unregistered workspace root stays exempt with registered=${String(registered)}`,
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

// REGRESSION (#6210): the send route resolves a resumed turn's project id from
// the realpathed cwd the first turn persisted. Composed the way the route
// wires it (real fs, the real registry lookup), an alias-registered project
// must keep its identity on resume while every grant, registration and
// existence check still decides the launch.
test("an alias-registered project keeps its identity on resume and still needs its grant", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { chatProjectAccessId } = await import("../chat-project-access.ts");

  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cpl-alias-")));
  try {
    const realParent = path.join(base, "real");
    const realProject = path.join(realParent, "cave");
    fs.mkdirSync(realProject, { recursive: true });
    fs.symlinkSync(realParent, path.join(base, "alias"));
    const aliasProject = path.join(base, "alias", "cave");
    const projects = [{
      id: "proj-alias",
      name: "Cave",
      root: aliasProject,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }];
    const grants = new Set(["milo:proj-alias"]);
    const deps = {
      // validateCaveProjectRoot's contract: an existing directory, realpathed.
      validateProjectRoot: (root) => {
        try {
          if (!fs.statSync(root).isDirectory()) return { ok: false, error: "root must be a directory" };
        } catch {
          return { ok: false, error: "root does not exist" };
        }
        return { ok: true, root: fs.realpathSync(root) };
      },
      resolveProjectId: (requestedRoot, resolvedRoot) =>
        chatProjectAccessId({ projects, requestedProjectRoot: requestedRoot, resolvedCwd: resolvedRoot }),
      isProjectRegistered: (projectId) => projects.some((project) => project.id === projectId),
      hasProjectAccess: async (familiarId, projectId) => grants.has(`${familiarId}:${projectId}`),
    };
    const resume = (familiarId, projectRoot) =>
      authorizeChatProjectLaunch(deps, { familiarId, projectRoot, surface: "chat" });

    assert.deepEqual(
      await resume("milo", aliasProject),
      { root: realProject, projectId: "proj-alias" },
      "turn 1 names the registered spelling and launches at its canonical root",
    );
    assert.deepEqual(
      await resume("milo", realProject),
      { root: realProject, projectId: "proj-alias" },
      "the resumed turn from the persisted canonical cwd is the same project",
    );

    await assert.rejects(
      resume("nova", realProject),
      (error) => error instanceof ChatProjectLaunchError && error.code === "project_access_denied",
      "a familiar without a grant is still denied",
    );
    grants.delete("milo:proj-alias");
    await assert.rejects(
      resume("milo", realProject),
      (error) => error instanceof ChatProjectLaunchError && error.code === "project_access_denied",
      "a revoked grant still denies the resumed turn",
    );
    grants.add("milo:proj-alias");

    const sibling = path.join(realParent, "cave-evil");
    fs.mkdirSync(sibling);
    await assert.rejects(
      resume("milo", sibling),
      (error) => error instanceof ChatProjectLaunchError && error.code === "project_not_registered",
      "a different root sharing the project's prefix is not registered",
    );
    await assert.rejects(
      resume("milo", path.join(realParent, "gone")),
      (error) => error instanceof ChatProjectLaunchError && error.code === "project_root_unavailable",
      "a nonexistent resume root never reaches the registry",
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

// REGRESSION (#6210): the hidden-generation workspace exemption covers only a
// root that is NOT a registered project (cave-g8fqc). Composed with the
// registry answer the send route derives, a project registered through an
// alias spelling inside the familiar's workspace — or one that two records
// name — must stay gated, while an unregistered workspace directory keeps the
// auth-free exemption.
test("an alias-registered project inside the familiar workspace is gated, not exempt", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { resumeRootIsRegisteredProject } = await import("../chat-project-access.ts");

  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cpl-ws-")));
  try {
    const workspace = path.join(base, "workspaces", "milo");
    const registered = path.join(workspace, "notes");
    const scratch = path.join(workspace, "scratch");
    fs.mkdirSync(registered, { recursive: true });
    fs.mkdirSync(scratch);
    fs.symlinkSync(path.join(base, "workspaces"), path.join(base, "alias"));
    fs.symlinkSync(path.join(base, "workspaces"), path.join(base, "twin"));
    const record = (id, root) => ({
      id,
      name: id,
      root,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const decide = (projects, resumeCwd) => {
      const resumeCwdResolved = fs.realpathSync(resumeCwd);
      return launch({
        familiarWorkspace: workspace,
        resumeCwd,
        resumeCwdResolved,
        resumeCwdIsRegisteredProject: resumeRootIsRegisteredProject({
          projects,
          resumeCwd,
          resolvedCwd: resumeCwdResolved,
        }),
      });
    };
    const aliasNotes = path.join(base, "alias", "milo", "notes");

    assert.deepEqual(
      decide([record("notes", aliasNotes)], registered),
      { kind: "gated" },
      "an alias-registered project inside the workspace needs its grant",
    );
    assert.deepEqual(
      decide([record("notes", aliasNotes), record("notes-twin", path.join(base, "twin", "milo", "notes"))], registered),
      { kind: "gated" },
      "two records naming the directory leave it registered, so it stays gated",
    );
    assert.deepEqual(
      decide([record("notes", aliasNotes)], scratch),
      { kind: "workspace", root: scratch },
      "an unregistered workspace directory keeps the auth-free exemption",
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
