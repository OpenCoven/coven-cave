import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_CHAT_ATTENTION } from "./chat-attention.ts";
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
  codeRailTabForWorkbenchTab,
  normalizeCodeTopTab,
  parseCodeDeepLink,
  CODE_ROOM_RAIL_WIDTH_PX,
  CODE_ROOM_TREE_WIDTH_PX,
  CODE_ROOM_MIN_VIEWER_WIDTH_PX,
  CODE_ROOM_MIN_REVIEW_WIDTH_PX,
  CODE_ROOM_SPLIT_MIN_WIDTH_PX,
  CODE_ROOM_RAIL_MIN_WIDTH_PX,
  CODE_WORKBENCH_STEPS,
  CODE_STEP_ANNOUNCEMENT,
  codeRoomFits,
  codeRoomFitsRail,
  codeWorkbenchFitsSplit,
  resolveCodeWorkbenchFilePath,
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
    attention: overrides.attention ?? NO_CHAT_ATTENTION,
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
    nonce: 1,
  };
  const target = codeSessionForPendingOpen([current, historical], review);
  assert.equal(target?.id, "historical", "a root-only review selects its captured workbench");
  assert.equal(codePendingOpenProjectRoot(review), "/repo-a");
  assert.equal(review.path, "/repo-a/src/shared.ts", "the review path stays under the captured root");

  assert.equal(
    codeSessionForPendingOpen(
      [current],
      { ...review, sessionId: "current" },
    )?.id,
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

test("captured source session outranks another workbench with the same historical root", () => {
  const source = row({ id: "source-chat", project_root: "/repo-now" });
  source.git = { ...source.git, worktreeRoot: "/repo-source-worktree" };
  const sameRoot = row({ id: "newer-code-session", project_root: "/repo-history" });
  const pending: PendingCodeOpen = {
    kind: "files",
    path: "src/history.ts",
    root: "/repo-history",
    sessionId: "source-chat",
    nonce: 61,
  };

  assert.equal(
    codeSessionForPendingOpen([sameRoot, source], pending)?.id,
    "source-chat",
    "the handoff stays beside its source chat while the dock reads the captured historical root",
  );
});

test("a scope change cannot resolve a rooted open against stale inventory", () => {
  const pending: PendingCodeOpen = {
    kind: "files",
    path: "src/history.ts",
    root: "/repo-b",
    sessionId: "repo-b-session",
    nonce: 7,
  };
  const staleRows = [
    row({ id: "repo-a-session", project_root: "/repo-a" }),
    row({ id: "repo-b-session", project_root: "/repo-b" }),
  ];

  assert.equal(
    resolveCodePendingOpen(staleRows, pending, false).status,
    "waiting",
    "even a matching stale row is not authoritative for the new scope",
  );
  assert.equal(
    resolveCodePendingOpen([], pending, false).status,
    "waiting",
    "clearing stale rows does not make the still-loading inventory definitive",
  );
  assert.equal(
    resolveCodePendingOpen(
      [row({ id: "repo-b-session", project_root: "/repo-b" })],
      pending,
      true,
    ).target?.id,
    "repo-b-session",
    "the later scope load resolves the captured-root target",
  );
});

test("rootless opens fail closed instead of borrowing a session workbench root", () => {
  const pending: PendingCodeOpen = {
    kind: "files",
    path: "src/history.ts",
    sessionId: "historical",
    nonce: 8,
  };

  assert.equal(
    codeSessionForPendingOpen(
      [row({ id: "historical", project_root: "/repo-a" })],
      pending,
    ),
    null,
    "a session id cannot supply missing immutable root provenance",
  );
  assert.deepEqual(
    resolveCodePendingOpen([], pending, false),
    { status: "invalid", capturedRoot: null, target: null },
    "missing provenance is invalid immediately rather than waiting to borrow a later root",
  );
  assert.deepEqual(
    resolveCodePendingOpen(
      [row({ id: "historical", project_root: "/repo-a" })],
      pending,
      true,
    ),
    { status: "invalid", capturedRoot: null, target: null },
    "a historical rootless payload fails closed after inventory loads",
  );
  assert.deepEqual(
    resolveCodePendingOpen(
      [row({ id: "selected", project_root: "/repo-selected" })],
      { kind: "files", path: "/repo-selected/src/current.ts", nonce: 9 },
      true,
    ),
    { status: "invalid", capturedRoot: null, target: null },
    "an unscoped absolute path cannot inherit the currently selected workbench root",
  );
});

test("rooted pending resolution distinguishes invalid and definitively absent roots", () => {
  const invalid = resolveCodePendingOpen(
    [],
    { kind: "files", path: "src/file.ts", root: "relative/repo", nonce: 9 },
    false,
  );
  assert.equal(invalid.status, "invalid", "malformed provenance fails closed without waiting forever");

  const absent = resolveCodePendingOpen(
    [row({ id: "other", project_root: "/repo-b" })],
    { kind: "files", path: "src/file.ts", root: "/repo-a", nonce: 10 },
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

test("workbench file opens recognize POSIX, drive, and UNC absolute paths on every host", () => {
  assert.equal(resolveCodeWorkbenchFilePath("/repo", "/outside/file.ts"), "/outside/file.ts");
  assert.equal(
    resolveCodeWorkbenchFilePath("/repo", "C:\\Repos\\App\\src\\file.ts"),
    "C:\\Repos\\App\\src\\file.ts",
  );
  assert.equal(
    resolveCodeWorkbenchFilePath("/repo", "\\\\Server\\Share\\Repo\\src\\file.ts"),
    "\\\\Server\\Share\\Repo\\src\\file.ts",
  );
  assert.equal(resolveCodeWorkbenchFilePath("/repo/", "./src/file.ts"), "/repo/src/file.ts");
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

// ── Review-rail vocabulary (cave-98o51, rebuilt cave-0rcku) ────────────────
// The Room replaced the tabbed workbench first with a terminal centre and a
// dock, and then — from the `Cody Code Reading v2` frame — with three columns
// and a terminal drawer. Legacy `?wtab=` links predate both, so they must keep
// resolving. `terminal` and `files` now name parts of the room that are always
// on screen, so neither selects a rail tab at all.

test("legacy ?wtab= deep links resolve onto the review rail", () => {
  assert.equal(codeRailTabForWorkbenchTab("diff"), "changes");
  assert.equal(codeRailTabForWorkbenchTab("pr"), "pr");
  assert.equal(
    codeRailTabForWorkbenchTab("terminal"),
    null,
    "the terminal is the drawer, present at every width — it opens no rail tab",
  );
  assert.equal(
    codeRailTabForWorkbenchTab("files"),
    null,
    "the tree is a column, not a tab — the link lands on a room already showing it",
  );
  // A stale/hand-edited ?wtab= value is untyped at runtime, so the guard must
  // survive one even though the signature forbids it at compile time.
  assert.equal(codeRailTabForWorkbenchTab("bogus" as never), null);
  assert.equal(codeRailTabForWorkbenchTab(null), null);
});

// ---------------------------------------------------------------------------
// Room layout model (cave-k3a9u)
//
// The shipped Room tried to stack itself with a CSS media query that
// `react-resizable-panels` overrode with an inline `flex-direction`, so the
// narrow layout never rendered at all. The replacement decides in JS from a
// measured width, which is what these cover.
// ---------------------------------------------------------------------------

test("the rail breakpoint is derived from the split breakpoint, not written twice", () => {
  assert.equal(
    CODE_ROOM_SPLIT_MIN_WIDTH_PX,
    CODE_ROOM_TREE_WIDTH_PX + CODE_ROOM_MIN_VIEWER_WIDTH_PX + CODE_ROOM_MIN_REVIEW_WIDTH_PX,
    "the split needs exactly the three columns it contains",
  );
  assert.equal(
    CODE_ROOM_RAIL_MIN_WIDTH_PX,
    CODE_ROOM_RAIL_WIDTH_PX + CODE_ROOM_SPLIT_MIN_WIDTH_PX,
    "the rail breakpoint must move with the split one — the old 768px/900px " +
      "pair disagreed, leaving 768-900px specified as neither shape",
  );
  assert.ok(
    CODE_ROOM_RAIL_MIN_WIDTH_PX > CODE_ROOM_SPLIT_MIN_WIDTH_PX,
    "the session rail must give up its column before the workbench columns do",
  );
});

test("an unmeasured width falls back to the caller's guess rather than reading as narrow", () => {
  // null/undefined mean "no measurement yet" (SSR, first paint, or no
  // ResizeObserver). Treating that as 0 would render the narrow layout on
  // every desktop first paint and flash.
  for (const width of [null, undefined, 0, -1, Number.NaN]) {
    assert.equal(
      codeRoomFits(width, 500, true),
      false,
      `unmeasured ${String(width)} on a phone stays narrow`,
    );
    assert.equal(
      codeRoomFits(width, 500, false),
      true,
      `unmeasured ${String(width)} on a desktop stays wide`,
    );
  }
});

test("a measured width beats the fallback in both directions", () => {
  // The whole point of measuring: a wide viewport holding a narrow Room must
  // resolve narrow, and vice versa.
  assert.equal(codeRoomFits(400, 500, false), false, "a narrow Room in a wide window");
  assert.equal(codeRoomFits(600, 500, true), true, "a wide Room reported by a mobile UA");
  assert.equal(codeRoomFits(500, 500, true), true, "exactly the minimum still fits");
  assert.equal(codeRoomFits(499, 500, false), false, "one pixel under does not");
});

test("the two Room breakpoints apply their own constants", () => {
  assert.ok(codeWorkbenchFitsSplit(CODE_ROOM_SPLIT_MIN_WIDTH_PX, true));
  assert.ok(!codeWorkbenchFitsSplit(CODE_ROOM_SPLIT_MIN_WIDTH_PX - 1, false));
  assert.ok(codeRoomFitsRail(CODE_ROOM_RAIL_MIN_WIDTH_PX, true));
  assert.ok(!codeRoomFitsRail(CODE_ROOM_RAIL_MIN_WIDTH_PX - 1, false));
  // A 390px phone is the case that was broken: two columns whose minimums
  // already sum past the whole screen.
  assert.ok(!codeWorkbenchFitsSplit(390, true), "a phone drills in");
  assert.ok(!codeRoomFitsRail(390, true), "a phone lands on the rail");
});

test("the narrow workbench lands on the source, and the shell is not a step", () => {
  assert.deepEqual([...CODE_WORKBENCH_STEPS], ["files", "source", "review"]);
  assert.equal(
    CODE_WORKBENCH_STEPS[1],
    "source",
    "the landing step is the file you opened — this is a reading surface",
  );
  // The terminal deliberately is NOT a step (cave-0rcku). It is the drawer,
  // docked at every width, so narrowing the room can never take the shell
  // away — the same commitment the terminal-centre room made, paid for in
  // height instead of width.
  assert.ok(
    !(CODE_WORKBENCH_STEPS as readonly string[]).includes("terminal"),
    "the shell is the drawer, present at every width, never a step you can lose",
  );
  // Every step must have live-region copy, or a drill-in announces nothing.
  for (const step of CODE_WORKBENCH_STEPS) {
    assert.ok(CODE_STEP_ANNOUNCEMENT[step], `${step} announces itself`);
  }
});
