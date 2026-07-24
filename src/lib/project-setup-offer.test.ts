// @ts-nocheck
// The in-place "Set up as project" offer (spec 2026-07-24) applies ONLY to a
// chat actively running in an ad-hoc unregistered folder. Registered projects,
// bare No-project chats (familiar workspaces carry no unregisteredRoot), and
// `.worktrees/` checkouts (they authorize against their parent project) are
// all excluded — this matrix is the contract.
import assert from "node:assert/strict";
import {
  PROJECT_SETUP_COLOR_CHOICES,
  projectSetupCandidateRoot,
  projectSetupDismissKey,
} from "./project-setup-offer.ts";
import { NO_PROJECT_ID } from "./chat-projects.ts";

const projects = [{ id: "p1", name: "cave", root: "/code/cave" }];

// Ad-hoc unregistered root → offered, normalized (trailing slash stripped).
assert.equal(
  projectSetupCandidateRoot(
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: "/code/other/" },
    projects,
  ),
  "/code/other",
);

// Backslashes normalize like every other root comparison in chat-projects.
assert.equal(
  projectSetupCandidateRoot(
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: "C:\\code\\thing" },
    projects,
  ),
  "C:/code/thing",
);

// A registered-project selection → no offer.
assert.equal(
  projectSetupCandidateRoot({ projectId: "p1", project: projects[0] }, projects),
  null,
);

// Bare No-project (no unregisteredRoot — e.g. the familiar's own workspace,
// whose cwd is never surfaced) → no offer.
assert.equal(
  projectSetupCandidateRoot({ projectId: NO_PROJECT_ID, project: null }, projects),
  null,
);

// A root that IS a registered project (stale selection) → no offer.
assert.equal(
  projectSetupCandidateRoot(
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: "/code/cave/" },
    projects,
  ),
  null,
);

// Worktree child of a registered project → no offer (parent-project auth).
assert.equal(
  projectSetupCandidateRoot(
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: "/code/cave/.worktrees/feat-x" },
    projects,
  ),
  null,
);

// The `.worktrees` directory itself → no offer either.
assert.equal(
  projectSetupCandidateRoot(
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: "/code/cave/.worktrees" },
    projects,
  ),
  null,
);

// A sibling that merely shares a path prefix is NOT a worktree child.
assert.equal(
  projectSetupCandidateRoot(
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: "/code/cave-evil" },
    projects,
  ),
  "/code/cave-evil",
);

// Blank/whitespace unregisteredRoot → no offer.
assert.equal(
  projectSetupCandidateRoot(
    { projectId: NO_PROJECT_ID, project: null, unregisteredRoot: "   " },
    projects,
  ),
  null,
);

// Dismissal key is per NORMALIZED root, so `/x/` and `/x` share one dismissal.
assert.equal(projectSetupDismissKey("/code/other/"), "cave:project-setup-dismissed:/code/other");

// Fixed identity palette for the modal's swatch row: the projectTint recipe
// (same lightness/chroma, spread hues) so explicit colors match auto tints.
assert.equal(PROJECT_SETUP_COLOR_CHOICES.length, 6);
for (const color of PROJECT_SETUP_COLOR_CHOICES) {
  assert.match(color, /^oklch\(0\.74 0\.12 \d+\)$/);
}

console.log("project-setup-offer.test.ts OK");
