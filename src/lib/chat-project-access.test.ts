// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { chatProjectAccessId, taskWorktreeProjectAccessId } from "./chat-project-access.ts";

const projects = [
  {
    id: "proj-1",
    name: "Cave",
    root: "/Users/me/dev/cave",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const codyWorkspace = "/Users/me/.coven/workspaces/familiars/cody";

assert.equal(
  chatProjectAccessId({ projects, resolvedCwd: "/Users/me" }),
  null,
  "a chat with no project root is not project-scoped",
);

assert.equal(
  chatProjectAccessId({
    projects,
    requestedProjectRoot: "/Users/me/dev/cave",
    resolvedCwd: "/Users/me/dev/cave",
  }),
  "proj-1",
  "an explicit registered root resolves to its project id (grant check applies)",
);

assert.equal(
  chatProjectAccessId({
    projects,
    requestedProjectRoot: "/Users/me/dev/cave/",
    resolvedCwd: "/Users/me",
  }),
  "proj-1",
  "trailing slashes still match the registered project",
);

assert.equal(
  chatProjectAccessId({
    projects,
    resumeCwd: "/Users/me/dev/cave",
    resolvedCwd: "/Users/me/dev/cave",
  }),
  "proj-1",
  "a resumed conversation in a registered project keeps the grant check",
);

assert.equal(
  chatProjectAccessId({
    projects,
    requestedProjectRoot: "/Users/me/somewhere-else",
    resolvedCwd: "/Users/me/somewhere-else",
  }),
  "unregistered:/Users/me/somewhere-else",
  "an explicit unregistered root fails closed through the permission chokepoint",
);

assert.equal(
  chatProjectAccessId({
    projects,
    resumeCwd: codyWorkspace,
    resolvedCwd: codyWorkspace,
  }),
  `unregistered:${codyWorkspace}`,
  "a resumed unregistered cwd fails closed instead of bypassing project access",
);

// Chat project launch now requires a registered project. A familiar workspace
// is no longer a project-free authorization bypass.
assert.equal(
  chatProjectAccessId({
    projects,
    requestedProjectRoot: codyWorkspace,
    resolvedCwd: codyWorkspace,
    familiarWorkspace: codyWorkspace,
  }),
  `unregistered:${codyWorkspace}`,
  "an unregistered familiar workspace fails closed",
);

assert.equal(
  chatProjectAccessId({
    projects,
    requestedProjectRoot: `${codyWorkspace}/`,
    resolvedCwd: codyWorkspace,
    familiarWorkspace: codyWorkspace,
  }),
  `unregistered:${codyWorkspace}/`,
  "a trailing slash cannot revive the retired workspace exemption",
);

assert.equal(
  chatProjectAccessId({
    projects,
    requestedProjectRoot: "/Users/me/.coven/workspaces/familiars/sage",
    resolvedCwd: "/Users/me/.coven/workspaces/familiars/sage",
    familiarWorkspace: codyWorkspace,
  }),
  "unregistered:/Users/me/.coven/workspaces/familiars/sage",
  "another familiar's workspace still fails closed",
);

assert.equal(
  chatProjectAccessId({
    projects,
    requestedProjectRoot: "/Users/me/dev/cave",
    resolvedCwd: "/Users/me/dev/cave",
    familiarWorkspace: codyWorkspace,
  }),
  "proj-1",
  "a registered project wins over the workspace exemption",
);

assert.equal(
  taskWorktreeProjectAccessId({
    projects,
    startNewConversation: true,
    hasExistingConversation: false,
    taskProjectId: "proj-1",
    taskCwd: "/Users/me/dev/cave/.git/cave-worktrees/task-42",
    requestedProjectRoot: "/Users/me/dev/cave/.git/cave-worktrees/task-42",
    resolvedCwd: "/Users/me/dev/cave/.git/cave-worktrees/task-42",
  }),
  "proj-1",
  "a fresh Board worktree handoff inside the assigned project authorizes through the task project",
);

assert.equal(
  taskWorktreeProjectAccessId({
    projects,
    startNewConversation: true,
    hasExistingConversation: false,
    taskProjectId: "proj-1",
    taskCwd: "/Users/me/dev/cave/.git/cave-worktrees/task-42",
    requestedProjectRoot: "/Users/me/dev/cave/.git/cave-worktrees/task-42",
    resolvedCwd: "/Users/me/private-unapproved-workspace",
  }),
  "unregistered:/Users/me/private-unapproved-workspace",
  "a symlink-swapped Board worktree fails closed when the resolved cwd escapes the assigned project",
);

// REGRESSION (cave-kv8a): the Code surface's fresh-worktree kickoff sends the
// just-provisioned `.worktrees/<branch>` checkout as an explicit projectRoot.
// Worktrees are intentionally not separate project records, so the request
// must authorize against the PARENT project's grant — not fail closed as an
// arbitrary unregistered directory (403 on every kickoff).
assert.equal(
  chatProjectAccessId({
    projects,
    requestedProjectRoot: "/Users/me/dev/cave/.worktrees/feat-x",
    resolvedCwd: "/Users/me/dev/cave/.worktrees/feat-x",
  }),
  "proj-1",
  "an explicit root under a registered project's .worktrees/ vets the parent project's grant",
);

assert.equal(
  chatProjectAccessId({
    projects,
    requestedProjectRoot: "/Users/me/dev/cave-evil/.worktrees/feat-x",
    resolvedCwd: "/Users/me/dev/cave-evil/.worktrees/feat-x",
  }),
  "unregistered:/Users/me/dev/cave-evil/.worktrees/feat-x",
  "sibling-dir evasion (cave-evil) misses the containment check and fails closed",
);

assert.equal(
  chatProjectAccessId({
    projects,
    requestedProjectRoot: "/Users/me/dev/cave/.worktrees",
    resolvedCwd: "/Users/me/dev/cave/.worktrees",
  }),
  "unregistered:/Users/me/dev/cave/.worktrees",
  "the .worktrees directory itself is not a worktree — fails closed",
);

assert.equal(
  chatProjectAccessId({
    projects,
    requestedProjectRoot: "/Users/me/dev/cave/.worktrees/../../elsewhere",
    resolvedCwd: "/Users/me/dev/cave/.worktrees/../../elsewhere",
  }),
  "unregistered:/Users/me/dev/cave/.worktrees/../../elsewhere",
  "a traversal escape below .worktrees/ resolves outside and fails closed",
);

assert.equal(
  chatProjectAccessId({
    projects,
    requestedProjectRoot: "/Users/me/dev/cave/.worktrees/feat-x/",
    resolvedCwd: "/Users/me/dev/cave/.worktrees/feat-x",
  }),
  "proj-1",
  "a trailing slash on the worktree root still maps to the parent project",
);

assert.equal(
  chatProjectAccessId({
    projects,
    resumeCwd: "/Users/me/dev/cave/.worktrees/feat-x",
    resolvedCwd: "/Users/me/dev/cave/.worktrees/feat-x",
  }),
  "proj-1",
  "a resumed worktree rechecks access through the registered parent project",
);

console.log("chat-project-access tests passed");

// SECURITY: the requested root is client-supplied, so a `.worktrees/<name>`
// symlink pointing outside the project would otherwise borrow the parent
// project's grant while the harness ran elsewhere. The realpathed cwd must
// land under the same prefix.
assert.equal(
  chatProjectAccessId({
    projects,
    requestedProjectRoot: "/Users/me/dev/cave/.worktrees/evil",
    resolvedCwd: "/Users/me/victim-ungranted-project",
  }),
  "unregistered:/Users/me/dev/cave/.worktrees/evil",
  "a symlinked worktree request whose real cwd escapes the parent project fails closed",
);

// REGRESSION: `resolvedCwd` arrives realpath-resolved from
// resolveLocalRuntimeCwd, so a lexically-resolved prefix built from a
// symlink-registered project root could never match it, and every legitimate
// worktree chat under that project fail-closed as unregistered.
{
  const realBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cpa-")));
  const realProject = path.join(realBase, "real", "cave");
  fs.mkdirSync(path.join(realProject, ".worktrees", "feat-x"), { recursive: true });
  const linkedProject = path.join(realBase, "linked-cave");
  fs.symlinkSync(realProject, linkedProject);

  const linkedProjects = [
    {
      id: "proj-linked",
      name: "Cave",
      root: linkedProject,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  assert.equal(
    chatProjectAccessId({
      projects: linkedProjects,
      requestedProjectRoot: path.join(linkedProject, ".worktrees", "feat-x"),
      resolvedCwd: path.join(realProject, ".worktrees", "feat-x"),
    }),
    "proj-linked",
    "a worktree under a symlink-registered project still authorizes against that project",
  );

  fs.mkdirSync(path.join(realBase, "elsewhere"), { recursive: true });
  assert.equal(
    chatProjectAccessId({
      projects: linkedProjects,
      requestedProjectRoot: path.join(linkedProject, ".worktrees", "feat-x"),
      resolvedCwd: path.join(realBase, "elsewhere"),
    }),
    `unregistered:${path.join(linkedProject, ".worktrees", "feat-x")}`,
    "canonicalizing the project root does not widen containment",
  );

  fs.rmSync(realBase, { recursive: true, force: true });
}

console.log("chat-project-access worktree cwd containment tests passed");
