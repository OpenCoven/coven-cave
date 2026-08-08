import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_CHAT_ATTENTION } from "./chat-attention.ts";
import {
  codeSessionActivity,
  codeSessionBranch,
  codeSessionDiffstat,
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
  CODE_ROOM_RAIL_WIDTH_PX,
  CODE_ROOM_MIN_TERMINAL_WIDTH_PX,
  CODE_ROOM_MIN_DOCK_WIDTH_PX,
  CODE_ROOM_SPLIT_MIN_WIDTH_PX,
  CODE_ROOM_RAIL_MIN_WIDTH_PX,
  CODE_WORKBENCH_STEPS,
  codeRoomFits,
  codeRoomFitsRail,
  codeWorkbenchFitsSplit,
} from "./code-surface.ts";
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
    CODE_ROOM_MIN_TERMINAL_WIDTH_PX + CODE_ROOM_MIN_DOCK_WIDTH_PX,
    "the split needs exactly the two zones it contains",
  );
  assert.equal(
    CODE_ROOM_RAIL_MIN_WIDTH_PX,
    CODE_ROOM_RAIL_WIDTH_PX + CODE_ROOM_SPLIT_MIN_WIDTH_PX,
    "the rail breakpoint must move with the split one — the old 768px/900px " +
      "pair disagreed, leaving 768-900px specified as neither shape",
  );
  assert.ok(
    CODE_ROOM_RAIL_MIN_WIDTH_PX > CODE_ROOM_SPLIT_MIN_WIDTH_PX,
    "the rail must give up its column before the dock gives up its own",
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

test("the narrow workbench lands on the terminal", () => {
  assert.deepEqual([...CODE_WORKBENCH_STEPS], ["terminal", "context"]);
  assert.equal(CODE_WORKBENCH_STEPS[0], "terminal", "the shell is the Room's priority surface");
});
