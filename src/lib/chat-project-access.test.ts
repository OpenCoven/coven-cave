// @ts-nocheck
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  chatProjectAccessId,
  resumeRootIsRegisteredProject,
  taskWorktreeProjectAccessId,
} from "./chat-project-access.ts";

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

// REGRESSION (#6210): a project registered through an alias spelling — a
// symlinked ancestor, macOS `/tmp -> /private/tmp` being the everyday case —
// must keep its identity when a chat resumes. The first turn persists the
// realpathed runtime cwd, and comparing that against the registered spelling
// failed the resumed turn closed as unregistered. Built under a realpathed
// temp dir with its own alias symlink, so it holds whatever HOME looks like.
{
  const realBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cpa-alias-")));
  const realParent = path.join(realBase, "real");
  const realProject = path.join(realParent, "cave");
  fs.mkdirSync(realProject, { recursive: true });
  const aliasParent = path.join(realBase, "alias");
  fs.symlinkSync(realParent, aliasParent);
  const aliasProject = path.join(aliasParent, "cave");

  const project = (id, root) => ({
    id,
    name: id,
    root,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  const aliasProjects = [project("proj-alias", aliasProject)];

  assert.equal(
    chatProjectAccessId({ projects: aliasProjects, resumeCwd: realProject, resolvedCwd: realProject }),
    "proj-alias",
    "a resume from the persisted canonical cwd keeps the alias-registered project's identity",
  );
  assert.equal(
    chatProjectAccessId({
      projects: aliasProjects,
      requestedProjectRoot: realProject,
      resolvedCwd: realProject,
    }),
    "proj-alias",
    "an explicit canonical spelling of an alias-registered root is the same project",
  );
  assert.equal(
    chatProjectAccessId({
      projects: [project("proj-real", realProject)],
      resumeCwd: aliasProject,
      resolvedCwd: realProject,
    }),
    "proj-real",
    "the reverse holds: an alias spelling of a canonically registered root is the same project",
  );
  assert.equal(
    chatProjectAccessId({
      projects: aliasProjects,
      requestedProjectRoot: aliasProject,
      resolvedCwd: realProject,
    }),
    "proj-alias",
    "the registered spelling still resolves",
  );

  // Identity is equality of one existing directory, never containment or a
  // shared prefix.
  const sibling = path.join(realParent, "cave-evil");
  fs.mkdirSync(sibling);
  assert.equal(
    chatProjectAccessId({ projects: aliasProjects, resumeCwd: sibling, resolvedCwd: sibling }),
    `unregistered:${sibling}`,
    "a sibling sharing the registered root's prefix is not that project",
  );
  const subdir = path.join(realProject, "src");
  fs.mkdirSync(subdir);
  assert.equal(
    chatProjectAccessId({ projects: aliasProjects, resumeCwd: subdir, resolvedCwd: subdir }),
    `unregistered:${subdir}`,
    "a directory inside the project is not the project itself",
  );
  const elsewhere = path.join(realBase, "elsewhere");
  fs.mkdirSync(elsewhere);
  assert.equal(
    chatProjectAccessId({ projects: aliasProjects, resumeCwd: elsewhere, resolvedCwd: elsewhere }),
    `unregistered:${elsewhere}`,
    "a different root stays unregistered",
  );

  // A path that does not exist has no canonical identity to share.
  const missing = path.join(realParent, "gone");
  assert.equal(
    chatProjectAccessId({
      projects: [project("proj-gone", path.join(aliasParent, "gone"))],
      resumeCwd: missing,
      resolvedCwd: missing,
    }),
    `unregistered:${missing}`,
    "a nonexistent registered root and resume path never match canonically",
  );

  // A registered symlink retargeted after the conversation started: the
  // persisted cwd names the OLD target, which the registered root no longer
  // reaches, so the resumed turn fails closed rather than carrying the grant
  // into a directory the project no longer names.
  const targetA = path.join(realBase, "target-a");
  const targetB = path.join(realBase, "target-b");
  fs.mkdirSync(targetA);
  fs.mkdirSync(targetB);
  const linkRoot = path.join(realBase, "link-root");
  fs.symlinkSync(targetA, linkRoot);
  const linkProjects = [project("proj-link", linkRoot)];
  assert.equal(
    chatProjectAccessId({ projects: linkProjects, resumeCwd: targetA, resolvedCwd: targetA }),
    "proj-link",
    "before the retarget, the persisted target is the registered project",
  );
  fs.unlinkSync(linkRoot);
  fs.symlinkSync(targetB, linkRoot);
  assert.equal(
    chatProjectAccessId({ projects: linkProjects, resumeCwd: targetA, resolvedCwd: targetA }),
    `unregistered:${targetA}`,
    "after the retarget, the old target is no longer that project",
  );

  // Two records naming one directory through different spellings, neither of
  // which the request spells: the grant to check is ambiguous, so fail closed.
  const twinParent = path.join(realBase, "twin");
  fs.symlinkSync(realParent, twinParent);
  assert.equal(
    chatProjectAccessId({
      projects: [project("proj-alias", aliasProject), project("proj-twin", path.join(twinParent, "cave"))],
      resumeCwd: realProject,
      resolvedCwd: realProject,
    }),
    `unregistered:${realProject}`,
    "two records canonicalizing to one directory never pick a grant silently",
  );

  // Roots that are not local absolute paths never take part in canonical
  // matching, even when a relative spelling would resolve to the cwd.
  assert.equal(
    chatProjectAccessId({
      projects: [
        project("proj-remote", `ssh://host${realProject}`),
        project("proj-relative", path.relative(process.cwd(), realProject)),
      ],
      resumeCwd: realProject,
      resolvedCwd: realProject,
    }),
    `unregistered:${realProject}`,
    "remote-looking or relative registered roots never match a local cwd canonically",
  );

  // The Board first-turn handoff checks that the realpathed cwd stays inside
  // the task's registered project. Against an alias-registered root that
  // containment must run in the same canonical namespace, or every legitimate
  // reserved Board turn fails closed — and still fail closed when the cwd
  // really escapes.
  const boardTask = {
    projects: aliasProjects,
    startNewConversation: true,
    hasExistingConversation: false,
    taskProjectId: "proj-alias",
    taskCwd: aliasProject,
    requestedProjectRoot: aliasProject,
  };
  assert.equal(
    taskWorktreeProjectAccessId({ ...boardTask, resolvedCwd: realProject }),
    "proj-alias",
    "a reserved Board turn in an alias-registered project authorizes against it",
  );
  assert.equal(
    taskWorktreeProjectAccessId({ ...boardTask, resolvedCwd: subdir }),
    "proj-alias",
    "a Board cwd inside the alias-registered project stays authorized",
  );
  assert.equal(
    taskWorktreeProjectAccessId({ ...boardTask, resolvedCwd: sibling }),
    `unregistered:${sibling}`,
    "a Board cwd in a prefix-sharing sibling still fails closed",
  );

  // A symlink planted inside a familiar's own workspace that points at an
  // alias-registered project is that project: the caller must hold its grant.
  const workspace = path.join(realBase, "workspace");
  fs.mkdirSync(workspace);
  const planted = path.join(workspace, "planted");
  fs.symlinkSync(aliasProject, planted);
  assert.equal(
    chatProjectAccessId({ projects: aliasProjects, resumeCwd: planted, resolvedCwd: realProject }),
    "proj-alias",
    "a planted symlink to an alias-registered project still requires that project's grant",
  );

  // The canonical step takes a path as spelled. On POSIX a backslash is part
  // of a name, so `foo\bar` is not the registered `foo/bar` directory.
  if (process.platform !== "win32") {
    fs.mkdirSync(path.join(realParent, "foo", "bar"), { recursive: true });
    const backslashDir = path.join(realParent, "foo\\bar");
    fs.mkdirSync(backslashDir);
    assert.equal(
      chatProjectAccessId({
        projects: [project("proj-nested", path.join(aliasParent, "foo", "bar"))],
        resumeCwd: backslashDir,
        resolvedCwd: backslashDir,
      }),
      `unregistered:${backslashDir}`,
      "a POSIX directory named with a backslash never borrows another project's identity",
    );
  }

  // On a case-insensitive volume another letter case names the same directory.
  // The persisted cwd carries the on-disk case, so a registration typed in
  // another case must keep its identity on resume too.
  const caseProbe = path.join(realBase, "CaseProbe");
  fs.mkdirSync(caseProbe);
  if (fs.existsSync(path.join(realBase, "caseprobe"))) {
    const onDisk = path.join(realParent, "MyProj");
    fs.mkdirSync(onDisk);
    const persisted = fs.realpathSync.native(path.join(realParent, "myproj"));
    assert.equal(persisted, onDisk, "the native realpath reports the on-disk case");
    assert.equal(
      chatProjectAccessId({
        projects: [project("proj-case", path.join(aliasParent, "myproj"))],
        resumeCwd: persisted,
        resolvedCwd: persisted,
      }),
      "proj-case",
      "a registration typed in another letter case keeps its identity on resume",
    );
  }

  // The hidden-generation workspace exemption applies only to roots that are
  // not registered projects. Twin records make the grant ambiguous, but the
  // directory is still registered, so it must not read as exempt.
  const twins = [project("proj-alias", aliasProject), project("proj-twin", path.join(twinParent, "cave"))];
  assert.equal(
    resumeRootIsRegisteredProject({ projects: twins, resumeCwd: realProject, resolvedCwd: realProject }),
    true,
    "a directory two records name is registered, even though its grant is ambiguous",
  );
  assert.equal(
    resumeRootIsRegisteredProject({ projects: aliasProjects, resumeCwd: planted, resolvedCwd: realProject }),
    true,
    "an alias-registered directory reached through a planted link is registered",
  );
  assert.equal(
    resumeRootIsRegisteredProject({ projects: aliasProjects, resumeCwd: elsewhere, resolvedCwd: elsewhere }),
    false,
    "an unregistered directory is not registered",
  );
  assert.equal(
    resumeRootIsRegisteredProject({ projects: aliasProjects, resumeCwd: missing, resolvedCwd: missing }),
    false,
    "a nonexistent path is not registered",
  );

  fs.rmSync(realBase, { recursive: true, force: true });
}

console.log("chat-project-access alias identity tests passed");

// REGRESSION (#6216): `.worktrees/` and Board containment compare the runtime
// cwd — which arrives with its on-disk letter case — against the registered
// root. On a case-insensitive volume a project registered in another case is
// the same directory, so its worktree and Board turns must keep its identity,
// while a sibling or a symlink that escapes still fails closed.
{
  const realBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cpa-case-")));
  const realParent = path.join(realBase, "real");
  fs.mkdirSync(realParent);
  fs.symlinkSync(realParent, path.join(realBase, "alias"));
  const project = (id, root) => ({
    id,
    name: id,
    root,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  try {
    fs.mkdirSync(path.join(realBase, "CaseProbe"));
    if (fs.existsSync(path.join(realBase, "caseprobe"))) {
      const onDisk = path.join(realParent, "MyProj");
      const worktree = path.join(onDisk, ".worktrees", "feat-x");
      fs.mkdirSync(worktree, { recursive: true });
      fs.mkdirSync(path.join(realParent, "MyProj-evil", ".worktrees", "feat-x"), { recursive: true });
      const outside = path.join(realBase, "outside");
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(onDisk, ".worktrees", "escape"));

      const typedRoot = path.join(realBase, "alias", "myproj");
      const projects = [project("proj-case", typedRoot)];
      const persistedWorktree = fs.realpathSync.native(path.join(typedRoot, ".worktrees", "feat-x"));
      assert.equal(persistedWorktree, worktree, "the native realpath reports the on-disk case");

      assert.equal(
        chatProjectAccessId({
          projects,
          requestedProjectRoot: path.join(typedRoot, ".worktrees", "feat-x"),
          resolvedCwd: persistedWorktree,
        }),
        "proj-case",
        "a worktree under a project registered in another letter case authorizes against it",
      );
      assert.equal(
        chatProjectAccessId({ projects, resumeCwd: persistedWorktree, resolvedCwd: persistedWorktree }),
        "proj-case",
        "a resumed worktree under a case-variant registration keeps its parent project",
      );
      const evil = path.join(realParent, "MyProj-evil", ".worktrees", "feat-x");
      assert.equal(
        chatProjectAccessId({ projects, requestedProjectRoot: evil, resolvedCwd: evil }),
        `unregistered:${evil}`,
        "a prefix-sharing sibling's worktree is not the case-variant project's",
      );
      const escape = path.join(typedRoot, ".worktrees", "escape");
      assert.equal(
        chatProjectAccessId({ projects, requestedProjectRoot: escape, resolvedCwd: outside }),
        `unregistered:${escape}`,
        "a worktree symlink that escapes the case-variant project still fails closed",
      );

      const boardTask = {
        projects,
        startNewConversation: true,
        hasExistingConversation: false,
        taskProjectId: "proj-case",
        taskCwd: path.join(typedRoot, ".worktrees", "feat-x"),
        requestedProjectRoot: path.join(typedRoot, ".worktrees", "feat-x"),
      };
      assert.equal(
        taskWorktreeProjectAccessId({ ...boardTask, resolvedCwd: persistedWorktree }),
        "proj-case",
        "a reserved Board turn under a case-variant registration authorizes against it",
      );
      assert.equal(
        taskWorktreeProjectAccessId({ ...boardTask, resolvedCwd: outside }),
        `unregistered:${outside}`,
        "a Board cwd outside the case-variant project still fails closed",
      );
    }

    // CI runs on case-sensitive Linux, where the block above is skipped.
    // Simulate a case-insensitive volume by folding one directory's case in
    // the native realpath, so these regressions run on every platform.
    const folded = path.join(realParent, "Folded");
    const foldedWorktree = path.join(folded, ".worktrees", "feat-x");
    fs.mkdirSync(foldedWorktree, { recursive: true });
    const typedFolded = path.join(realParent, "folded");
    const nativeBefore = fs.realpathSync.native;
    const fold = (value) => {
      const text = String(value);
      return text === typedFolded || text.startsWith(typedFolded + path.sep)
        ? folded + text.slice(typedFolded.length)
        : text;
    };
    const { mock: foldMock } = await import("node:test");
    foldMock.method(fs.realpathSync, "native", (value, ...rest) => nativeBefore(fold(value), ...rest));
    try {
      const foldedProjects = [project("proj-folded", typedFolded)];
      const typedWorktree = path.join(typedFolded, ".worktrees", "feat-x");
      assert.equal(
        chatProjectAccessId({ projects: foldedProjects, requestedProjectRoot: typedWorktree, resolvedCwd: foldedWorktree }),
        "proj-folded",
        "(simulated case-insensitive volume) a worktree under a case-variant registration authorizes against it",
      );
      assert.equal(
        taskWorktreeProjectAccessId({
          projects: foldedProjects,
          startNewConversation: true,
          hasExistingConversation: false,
          taskProjectId: "proj-folded",
          taskCwd: typedWorktree,
          requestedProjectRoot: typedWorktree,
          resolvedCwd: foldedWorktree,
        }),
        "proj-folded",
        "(simulated case-insensitive volume) a reserved Board turn under a case-variant registration authorizes against it",
      );
    } finally {
      foldMock.restoreAll();
    }

    // A registered root that is not a local absolute path contains nothing,
    // rather than resolving against the server's working directory.
    const relativeWorktree = path.join(process.cwd(), "cpa-relative-root", ".worktrees", "feat-x");
    assert.equal(
      chatProjectAccessId({
        projects: [project("proj-relative", "cpa-relative-root")],
        requestedProjectRoot: relativeWorktree,
        resolvedCwd: relativeWorktree,
      }),
      `unregistered:${relativeWorktree}`,
      "a relative registered root never contains a worktree under the server's cwd",
    );

    // One registry answer canonicalizes each registered root once, however many
    // lookup steps consult it.
    fs.mkdirSync(path.join(realParent, "cave"));
    fs.symlinkSync(realParent, path.join(realBase, "twin"));
    const twins = [
      project("proj-alias", path.join(realBase, "alias", "cave")),
      project("proj-twin", path.join(realBase, "twin", "cave")),
    ];
    const { mock } = await import("node:test");
    const nativeRealpath = mock.method(fs.realpathSync, "native");
    try {
      assert.equal(
        resumeRootIsRegisteredProject({
          projects: twins,
          resumeCwd: path.join(realParent, "cave"),
          resolvedCwd: path.join(realParent, "cave"),
        }),
        true,
        "the shared cache keeps a directory two records name registered",
      );
    } finally {
      mock.restoreAll();
    }
    for (const twin of twins) {
      assert.equal(
        nativeRealpath.mock.calls.filter((call) => call.arguments[0] === twin.root).length,
        1,
        `${twin.id}'s registered root is canonicalized once per registry answer`,
      );
    }

  } finally {
    fs.rmSync(realBase, { recursive: true, force: true });
  }
}

console.log("chat-project-access case-variant identity tests passed");
