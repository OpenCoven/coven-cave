// @ts-nocheck
import assert from "node:assert/strict";

import { chatProjectAccessId } from "./chat-project-access.ts";

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
  null,
  "a resumed unregistered cwd is not an explicit project request",
);

// REGRESSION (2026-07-01): a no-project chat boots in the familiar's own
// workspace, the daemon records that dir as the session cwd, and the client
// echoes it back as an explicit projectRoot on the next turn. That echo must
// not fail closed — it denied the familiar its own home with a 403
// "project access denied" on turn 2 of every no-project chat.
assert.equal(
  chatProjectAccessId({
    projects,
    requestedProjectRoot: codyWorkspace,
    resolvedCwd: codyWorkspace,
    familiarWorkspace: codyWorkspace,
  }),
  null,
  "a familiar chatting in its own workspace is allowed (no project scope)",
);

assert.equal(
  chatProjectAccessId({
    projects,
    requestedProjectRoot: `${codyWorkspace}/`,
    resolvedCwd: codyWorkspace,
    familiarWorkspace: codyWorkspace,
  }),
  null,
  "the own-workspace exemption tolerates unnormalized paths",
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

console.log("chat-project-access tests passed");
