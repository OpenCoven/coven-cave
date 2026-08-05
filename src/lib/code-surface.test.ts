import assert from "node:assert/strict";
import { test } from "node:test";
import {
  codeSessionActivity,
  codeSessionBranch,
  codeSessionDiffstat,
  codePendingOpenProjectRoot,
  resolveCodePendingOpen,
  codeSessionForPendingOpen,
  codeSessionWorkRoot,
  groupCodeRailSessions,
  isCodeGithubTab,
  isCodeRailSession,
  isCodeTopTab,
  isCodeWorkbenchTab,
  isCodeDockTab,
  codeDockTabForWorkbenchTab,
  CODE_DOCK_TABS,
  codeDockTabWantsExpanded,
  CODE_DOCK_SIZES,
  normalizeCodeTopTab,
  parseCodeDeepLink,
} from "./code-surface.ts";
import {
  clearPendingCodeOpen,
  enqueuePendingCodeOpen,
  getPendingCodeOpen,
  type PendingCodeOpen,
} from "./pending-code-open.ts";
import type { SessionRow } from "./types.ts";

// Behavioral tests for the Code surface's pure model (cave-k0ua): session rail
// grouping, per-session git attribution badges, and deep-link parsing.

function row(overrides: Partial<SessionRow>): SessionRow {
  return {
    id: "s1",
    project_root: "/repo/a",
    harness: "coven",
    title: "Session",
    status: "idle",
    exit_code: null,
    archived_at: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

test("rail hides archived and generator-spawned sessions", () => {
  assert.ok(isCodeRailSession(row({})));
  assert.ok(!isCodeRailSession(row({ archived_at: "2026-07-01T00:00:00Z" })));
  assert.ok(!isCodeRailSession(row({ generated: true })));
});

test("groups by project root, newest group and newest session first", () => {
  const groups = groupCodeRailSessions([
    row({ id: "a-old", project_root: "/repo/a", updated_at: "2026-07-01T00:00:00Z" }),
    row({ id: "b-new", project_root: "/repo/b", updated_at: "2026-07-03T00:00:00Z" }),
    row({ id: "a-new", project_root: "/repo/a", updated_at: "2026-07-02T00:00:00Z" }),
    row({ id: "hidden", project_root: "/repo/b", generated: true, updated_at: "2026-07-04T00:00:00Z" }),
  ]);
  assert.deepEqual(
    groups.map((g) => ({ label: g.label, ids: g.sessions.map((s) => s.id) })),
    [
      { label: "b", ids: ["b-new"] },
      { label: "a", ids: ["a-new", "a-old"] },
    ],
  );
});

test("sessions without a project root land in a trailing (unknown) group", () => {
  const groups = groupCodeRailSessions([
    row({ id: "rootless", project_root: "", updated_at: "2026-07-09T00:00:00Z" }),
    row({ id: "rooted", project_root: "/repo/a", updated_at: "2026-07-01T00:00:00Z" }),
  ]);
  assert.deepEqual(
    groups.map((g) => g.label),
    ["a", "(unknown)"],
    "the unknown group trails even when its sessions are newer",
  );
});

test("group labels come from the root basename, tolerating trailing slashes", () => {
  const groups = groupCodeRailSessions([
    row({ id: "x", project_root: "/home/user/proj/" }),
    row({ id: "y", project_root: "C:\\repos\\win-proj", updated_at: "2026-06-30T00:00:00Z" }),
  ]);
  assert.deepEqual(groups.map((g) => g.label), ["proj", "win-proj"]);
});

test("session branch prefers workBranch, then worktree branch, then PR branch — never a shared checkout's git.branch", () => {
  assert.equal(codeSessionBranch(row({ workBranch: "feat/x", git: { branch: "main" } })), "feat/x");
  assert.equal(
    codeSessionBranch(row({ git: { branch: "feat/wt", isWorktree: true, worktreeRoot: "/wt" } })),
    "feat/wt",
  );
  assert.equal(
    codeSessionBranch(row({ git: { branch: "main", isWorktree: false } })),
    null,
    "a shared checkout's current branch is not this session's branch (cave-9q24)",
  );
  assert.equal(
    codeSessionBranch(row({ pullRequest: { repo: "o/r", branch: "pr-branch" } })),
    "pr-branch",
  );
});

test("diffstat renders +N −N and hides when clean or unknown", () => {
  assert.equal(codeSessionDiffstat(row({ diff: { additions: 3, deletions: 1 } })), "+3 \u22121");
  assert.equal(codeSessionDiffstat(row({ diff: { additions: 0, deletions: 0 } })), null);
  assert.equal(codeSessionDiffstat(row({ diff: null })), null);
  assert.equal(codeSessionDiffstat(row({})), null);
});

test("activity maps running/exit-code/idle", () => {
  assert.equal(codeSessionActivity(row({ status: "running" })), "running");
  assert.equal(codeSessionActivity(row({ status: "exited", exit_code: 1 })), "error");
  assert.equal(codeSessionActivity(row({ status: "exited", exit_code: 0 })), "idle");
  assert.equal(codeSessionActivity(row({})), "idle");
});

test("work root prefers the session's worktree over the shared project root", () => {
  assert.equal(codeSessionWorkRoot(row({})), "/repo/a");
  assert.equal(
    codeSessionWorkRoot(row({ git: { worktreeRoot: "/repo/a/.worktrees/feat", isWorktree: true, branch: "feat" } })),
    "/repo/a/.worktrees/feat",
  );
  assert.equal(
    codeSessionWorkRoot(row({ git: { worktreeRoot: null, isWorktree: false, branch: "main" } })),
    "/repo/a",
    "a null worktreeRoot falls back to the project root",
  );
});

test("historical review selects the captured root when projects share a relative filename", () => {
  const current = row({ id: "current", project_root: "/repo-b" });
  const historical = row({ id: "historical", project_root: "/repo-a" });
  const review = {
    kind: "changes" as const,
    path: "/repo-a/src/shared.ts",
    root: "/repo-a",
    sessionId: "current",
    nonce: 1,
  };
  const target = codeSessionForPendingOpen([current, historical], review);
  assert.equal(target?.id, "historical", "captured root outranks the currently active chat session");
  assert.equal(codePendingOpenProjectRoot(review), "/repo-a");
  assert.equal(review.path, "/repo-a/src/shared.ts", "the review path stays under the captured root");

  assert.equal(
    codeSessionForPendingOpen([current], review)?.id,
    "current",
    "the raising session can host a captured-root review after that session switches projects",
  );
  assert.equal(
    codeSessionForPendingOpen(
      [current],
      {
        kind: "changes",
        path: "/repo-b/src/shared.ts",
        root: "/repo-a",
        sessionId: "current",
        nonce: 2,
      },
    ),
    null,
    "a path outside the captured root fails closed instead of using the current project",
  );
  assert.equal(
    codePendingOpenProjectRoot({
      kind: "changes",
      path: "/repo-a/src/shared.ts",
      root: "relative/repo-a",
      sessionId: "current",
      nonce: 3,
    }),
    null,
    "a malformed captured root cannot retarget the current project",
  );
  assert.equal(
    codePendingOpenProjectRoot({
      kind: "changes",
      path: "/repo-a/src/shared.ts",
      root: "/repo/../repo-a",
      sessionId: "current",
      nonce: 4,
    }),
    null,
    "a traversing captured root is not canonical immutable provenance",
  );
});

test("pending historical review retains its captured root and path after a project switch", () => {
  let activeProjectRoot = "/repo-a";
  const review: PendingCodeOpen = {
    kind: "changes",
    path: "/repo-a/src/shared.ts",
    root: "/repo-a",
    sessionId: "current",
    nonce: 5,
  };
  enqueuePendingCodeOpen(review);
  try {
    activeProjectRoot = "/repo-b";
    assert.equal(activeProjectRoot, "/repo-b");
    assert.equal(getPendingCodeOpen()?.root, "/repo-a");
    assert.equal(getPendingCodeOpen()?.path, "/repo-a/src/shared.ts");
  } finally {
    clearPendingCodeOpen();
  }
});

test("rooted pending open waits for sessions to load, then opens the matching workbench once", () => {
  let pending: PendingCodeOpen | null = {
    kind: "files",
    path: "src/history.ts",
    root: "/repo-a",
    sessionId: "current",
    nonce: 6,
  };
  let handled = 0;
  const opened: string[] = [];

  const consume = (sessions: SessionRow[], sessionsLoaded: boolean) => {
    if (!pending) return;
    const resolution = resolveCodePendingOpen(sessions, pending, sessionsLoaded);
    if (resolution.status === "waiting") return;
    if (resolution.status === "ready" && resolution.target) {
      opened.push(resolution.target.id);
    }
    handled += 1;
    pending = null;
  };

  consume([], false);
  assert.ok(pending, "the rooted open stays pending while the session list is loading");
  assert.equal(handled, 0, "loading is not acknowledged as a handled open");

  consume([row({ id: "historical", project_root: "/repo-a" })], true);
  assert.deepEqual(opened, ["historical"], "the captured-root workbench opens after sessions arrive");
  assert.equal(handled, 1);

  consume([row({ id: "historical", project_root: "/repo-a" })], true);
  assert.deepEqual(opened, ["historical"], "the acknowledged open does not replay");
  assert.equal(handled, 1);
});

test("rooted pending resolution distinguishes invalid and definitively absent roots", () => {
  const invalid = resolveCodePendingOpen(
    [],
    { kind: "files", path: "src/file.ts", root: "relative/repo", nonce: 7 },
    false,
  );
  assert.equal(invalid.status, "invalid", "malformed provenance fails closed without waiting forever");

  const absent = resolveCodePendingOpen(
    [row({ id: "other", project_root: "/repo-b" })],
    { kind: "files", path: "src/file.ts", root: "/repo-a", nonce: 8 },
    true,
  );
  assert.equal(absent.status, "absent", "a loaded session list can definitively reject an unknown root");
});

test("captured-root matching follows Windows and POSIX case semantics", () => {
  const drive = row({ id: "drive", project_root: "c:\\Repos\\App" });
  const unc = row({ id: "unc", project_root: "\\\\Server\\Share\\Repo" });
  const posix = row({ id: "posix", project_root: "/Users/Val/Repo" });

  assert.equal(
    codeSessionForPendingOpen(
      [drive],
      { kind: "files", path: "C:/REPOS/APP/src/file.ts", root: "C:/REPOS/APP", nonce: 9 },
    )?.id,
    "drive",
    "drive roots match across case and separator variants",
  );
  assert.equal(
    codeSessionForPendingOpen(
      [unc],
      {
        kind: "files",
        path: "//server/share/repo/src/file.ts",
        root: "//server/share/repo",
        nonce: 10,
      },
    )?.id,
    "unc",
    "UNC server, share, and path segments match case-insensitively",
  );
  assert.equal(
    codeSessionForPendingOpen(
      [posix],
      { kind: "files", path: "/users/val/repo/src/file.ts", root: "/users/val/repo", nonce: 11 },
    ),
    null,
    "POSIX roots remain case-sensitive",
  );
});

test("deep-link parsing falls back to defaults on unknown values", () => {
  const parsed = parseCodeDeepLink(new URLSearchParams("session=abc&ctab=reviews&wtab=files"));
  assert.deepEqual(parsed, { sessionId: "abc", topTab: "reviews", workbenchTab: "files" });
  const legacy = parseCodeDeepLink(new URLSearchParams("ctab=github"));
  assert.equal(legacy.topTab, "activity");
  const fallback = parseCodeDeepLink(new URLSearchParams("ctab=bogus&wtab=nope"));
  assert.deepEqual(fallback, { sessionId: null, topTab: "sessions", workbenchTab: "diff" });
});

test("tab guards accept exactly the fixed vocabularies", () => {
  for (const tab of ["diff", "files", "terminal", "pr"]) assert.ok(isCodeWorkbenchTab(tab));
  for (const tab of ["sessions", "activity", "prs", "issues", "reviews"]) assert.ok(isCodeTopTab(tab));
  for (const tab of ["activity", "prs", "issues", "reviews"]) assert.ok(isCodeGithubTab(tab));
  assert.ok(!isCodeGithubTab("sessions"));
  assert.ok(!isCodeWorkbenchTab("overview"));
  assert.ok(!isCodeTopTab("code"));
  assert.ok(!isCodeTopTab("github"), "github remains compatibility input, not a rendered tab");
  assert.ok(!isCodeWorkbenchTab(null));
  assert.ok(!isCodeTopTab(undefined));
});

test("normalizeCodeTopTab maps legacy + unknown values", () => {
  assert.equal(normalizeCodeTopTab("github"), "activity", "legacy github → Activity");
  assert.equal(normalizeCodeTopTab("activity"), "activity");
  assert.equal(normalizeCodeTopTab("issues"), "issues");
  assert.equal(normalizeCodeTopTab("bogus"), "sessions");
  assert.equal(normalizeCodeTopTab(null), "sessions");
});

// ── Context dock vocabulary (cave-98o51) ────────────────────────────────────
// The Room replaced the tabbed workbench with a persistent terminal center and
// a dock on the right. Legacy `?wtab=` links predate that split, so they must
// keep resolving — a `terminal` link now names the center, which is always on
// screen, and therefore selects no dock tab at all.

test("dock tabs are a fixed vocabulary distinct from the retired workbench tabs", () => {
  for (const tab of CODE_DOCK_TABS) assert.ok(isCodeDockTab(tab));
  assert.deepEqual(
    [...CODE_DOCK_TABS],
    ["changes", "files", "pr", "inspector", "github", "browser"],
    "the approved dock, in tab order",
  );
  assert.ok(!isCodeDockTab("terminal"), "the terminal is the center zone, never a dock tab");
  assert.ok(!isCodeDockTab("diff"), "diff was renamed to changes in the Room");
  assert.ok(!isCodeDockTab(null));
  assert.ok(!isCodeDockTab("bogus"));
});

test("legacy ?wtab= deep links resolve onto the dock", () => {
  assert.equal(codeDockTabForWorkbenchTab("diff"), "changes");
  assert.equal(codeDockTabForWorkbenchTab("files"), "files");
  assert.equal(codeDockTabForWorkbenchTab("pr"), "pr");
  assert.equal(
    codeDockTabForWorkbenchTab("terminal"),
    null,
    "the terminal is always visible, so its link opens no dock tab",
  );
  // A stale/hand-edited ?wtab= value is untyped at runtime, so the guard must
  // survive one even though the signature forbids it at compile time.
  assert.equal(codeDockTabForWorkbenchTab("bogus" as never), null);
  assert.equal(codeDockTabForWorkbenchTab(null), null);
});

test("dock sizes are ordered widest-last so collapse/expand steps through them", () => {
  assert.deepEqual([...CODE_DOCK_SIZES], ["collapsed", "normal", "expanded"]);
});

// Some dock tabs are illegible at sidebar width, so selecting one has to widen
// the dock rather than render something nobody can use.
test("only the wide tabs force the dock open expanded", () => {
  assert.ok(codeDockTabWantsExpanded("browser"), "a native webview needs the room");
  assert.ok(codeDockTabWantsExpanded("github"), "a list/detail split needs the room");
  for (const tab of ["changes", "files", "pr", "inspector"] as const) {
    assert.ok(!codeDockTabWantsExpanded(tab), `${tab} reads fine at normal width`);
  }
});
