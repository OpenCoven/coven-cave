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

console.log("chat-project-access tests passed");
