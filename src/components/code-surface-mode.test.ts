// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Pin suite for the dedicated Code surface (cave-k0ua).
//
// History: a standalone "code" WorkspaceMode was retired and this file's
// predecessor (code-view.test.ts) was the retirement guard keeping it deleted.
// The owner requested a Codex-style multi-session coding surface — diffs,
// files, terminal, per-session PR context, worktrees, branches, with GitHub
// absorbed as a tab — so the mode returned behind caveCodeSurface(). Phase 2
// (cave-m6ys) made it default-on. Phase 3 (cave-cc5r) moved the surface into
// the Coding familiar's Role Surface room: "code" is now an alias landing on
// `surface:code` (role-gated, explicit familiar Type picker in the Studio),
// and GitHub is available only inside that role-gated room. These pins
// document that sanctioned shape.

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const modeType = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const codeView = await readFile(new URL("./code-view.tsx", import.meta.url), "utf8");
const lazySurfaces = await readFile(new URL("./lazy-surfaces.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = await readFile(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const registerRooms = await readFile(new URL("./role-surfaces/register.tsx", import.meta.url), "utf8");
const codeRoom = await readFile(new URL("./role-surfaces/code-room.tsx", import.meta.url), "utf8");
const pendingGithub = await readFile(new URL("../lib/pending-code-github.ts", import.meta.url), "utf8");
const contextDock = await readFile(new URL("./code-context-dock.tsx", import.meta.url), "utf8");
const terminalWorkspace = await readFile(new URL("./code-terminal-workspace.tsx", import.meta.url), "utf8");

// ── Mode vocabulary ──────────────────────────────────────────────────────────

assert.match(modeType, /\|\s*"code"/, "the code mode stays in the vocabulary (as an alias) so deep links keep working");

// ── The Code room (cave-cc5r) ────────────────────────────────────────────────

// Code is the Coding familiar's room: registered in the Role Surface registry
// under the "coder" role, granted by the Studio's explicit Type picker or a
// matching role label — never rendered as an ungated top-level surface.
assert.match(
  registerRooms,
  /id: CODE_SURFACE_ID,\s*role: "coder",\s*aliases: \["coding", "developer", "engineer", "programmer", "software-engineer", "code"\]/,
  "the Code room registers under the coder role with the sanctioned alias set",
);
assert.match(
  registerRooms,
  /const CodeRoom = dynamic\(\s*\(\) => import\("\.\/code-room"\)\.then\(\(m\) => m\.CodeRoom\)/,
  "the Code room is code-split — the workbench chunk (CodeMirror et al.) must not join the boot bundle",
);
assert.match(
  codeRoom,
  /<CodeView\s+sessions=\{context\.runtimeState\.sessions\}/,
  "the room adapter feeds CodeView the context's familiar-scoped sessions",
);
assert.match(
  codeRoom,
  /pendingOpen=\{pendingOpen\}\s+onPendingOpenHandled=\{clearPendingCodeOpen\}/,
  "the room consumes pending file/diff opens from the module store and clears them",
);
assert.match(
  codeRoom,
  /pendingGithubOpen=\{pendingGithubOpen\}\s+onPendingGithubOpenHandled=\{clearPendingCodeGithubOpen\}/,
  "the room consumes pending GitHub opens from the module store and clears them",
);

// ── Workspace wiring ─────────────────────────────────────────────────────────

assert.match(
  workspace,
  /code: "Code"/,
  "WORKSPACE_MODE_TITLES names the Code surface (canonical-nav agreement)",
);
assert.match(
  workspace,
  /if \(next === "code"\) \{[\s\S]{0,700}?commitMode\(roleSurfaceMode\(CODE_SURFACE_ID\)\)/,
  "setMode funnels every code entry point (deep links, palette, navigate-mode, persisted restore) into the room",
);
assert.doesNotMatch(workspace, /mode === "github" \?[\s\S]{0,400}?<GitHubView/, "Workspace has no standalone GitHub render branch");
assert.doesNotMatch(workspace, /\bGitHubView,\s*\n/, "Workspace does not import the standalone GitHub surface");
assert.match(
  lazySurfaces,
  /export const GitHubView = dynamic\(\s*timed\("github", loadGitHubView\)/,
  "GitHubView stays code-split behind lazy-surfaces — its chunk must not join the boot bundle",
);
assert.doesNotMatch(
  lazySurfaces,
  /loadCodeView|export const CodeView/,
  "no lazy CodeView wrapper survives — the workbench chunk rides the Code room's dynamic import",
);

// Default-on (cave-m6ys): the build-time flag is retired. No workspace wiring
// may resurrect a gate in front of the surface, and the vocabulary records
// the room routing — "code" is an alias landing on the surface:code room.
const featureFlags = await readFile(new URL("../lib/feature-flags.ts", import.meta.url), "utf8");
assert.doesNotMatch(
  featureFlags,
  /caveCodeSurface|CAVE_CODE_SURFACE/,
  "the Code-surface feature flag is retired — default-on, no env gate",
);
assert.doesNotMatch(
  workspace,
  /caveCodeSurface/,
  "no flag-off fallbacks survive in the Workspace wiring",
);
assert.match(
  modeType,
  /code: "surface:code"/,
  "MODE_ALIASES routes the code alias onto the Coding familiar's room (cave-cc5r)",
);
assert.match(
  modeType,
  /github: "surface:code"/,
  "MODE_ALIASES routes the legacy github mode onto the Coding familiar's room",
);
assert.doesNotMatch(
  modeType,
  /CANONICAL_WORKSPACE_MODES[\s\S]{0,300}"github"/,
  "GitHub is not a canonical standalone workspace surface",
);
assert.match(
  workspace,
  /if \(next === "github"\) \{[\s\S]{0,500}?enqueuePendingCodeGithubOpen\([\s\S]{0,300}?commitMode\(roleSurfaceMode\(CODE_SURFACE_ID\)\)/,
  "setMode funnels legacy GitHub navigation into the Coding Room",
);
assert.match(
  workspace,
  /const openGitHubTarget[\s\S]{0,500}?enqueuePendingCodeGithubOpen\(\{[\s\S]{0,250}?target,[\s\S]{0,250}?setMode\("code"\)/,
  "GitHub item URLs enqueue their detail target before opening the Coding Room",
);
assert.match(pendingGithub, /export function enqueuePendingCodeGithubOpen/, "the GitHub Room open store is available");

// File/diff links from chat transcripts, inbox cards, the Projects hub —
// everywhere — land on the Code room (cave-ohcj, cave-cc5r): the workspace
// enqueues into the pending-code-open store and navigates; the room consumes.
assert.match(
  workspace,
  /File\/diff links land on the Code room[\s\S]*?enqueuePendingCodeOpen\([\s\S]*?setMode\("code"\)/,
  "file-open events route to the Code room, not Chat's code rail",
);

// The primary keyboard cluster is unchanged: Code is a quiet destination, not
// a ⌘1-5 surface.
assert.match(
  workspace,
  /const SURFACE_ORDER: WorkspaceMode\[\] = \[\s*"home", "chat", "board", "inbox", "browser",\s*\]/,
  "keyboard surface order keeps the primary cluster without Code",
);

// ── Sidebar row ──────────────────────────────────────────────────────────────

// GitHub is not a standalone destination. The Code room's row arrives via the
// registry-driven roleSurfaces cluster and owns all GitHub affordances.
assert.doesNotMatch(sidebar, /\{ id: "github", label: "GitHub"/, "the sidebar has no standalone GitHub row");
assert.doesNotMatch(
  sidebar,
  /\{ id: "code", label: "Code"/,
  "no static Code row survives in FOLDER_MODES — the room row is registry-driven",
);
assert.doesNotMatch(sidebar, /hideGithubRow/, "the retired conditional GitHub-row prop is gone");
assert.doesNotMatch(sidebar, /githubAssignedCount/, "the retired standalone GitHub badge prop is gone");
assert.match(
  contextDock,
  /import\("@\/components\/github-view"\)\.then\(\(module\) => module\.GitHubView\)/,
  "the Coding Room lazy-loads GitHubView inside its context dock",
);

// ── Workbench (terminal center | context dock) ────────────────────────────────

const workbench = await readFile(new URL("./code-workbench.tsx", import.meta.url), "utf8");
const workbenchFiles = await readFile(new URL("./code-workbench-files.tsx", import.meta.url), "utf8");

// Every tab scopes to the session's WORK root (worktree over shared checkout,
// cave-9q24) — pointing any of them at project_root directly would show a
// different session's churn on shared checkouts.
assert.match(
  workbench,
  /const workRoot = codeSessionWorkRoot\(row\);/,
  "the workbench derives one work root for all tabs",
);
assert.match(
  contextDock,
  /<SessionChangesInner\s+key=\{workRoot\}\s+projectRoot=\{workRoot\}\s+running=\{running\}/,
  "the Changes dock tab mounts the proven changes panel keyed+scoped to the work root",
);
assert.match(
  contextDock,
  /import\("@\/components\/code-workbench-files"\)/,
  "Files stays dynamic so CodeMirror stays out of the Room's initial chunk",
);
assert.match(
  workbench,
  /<CodeTerminalWorkspace[\s\S]*?sessionId=\{row\.id\}[\s\S]*?projectRoot=\{workRoot\}[\s\S]*?allowSplits=\{!isMobile\}/,
  "the selected session mounts a persistent terminal center",
);
assert.match(
  terminalWorkspace,
  /<BottomTerminal[\s\S]*?threadId=\{terminalThreadId\(sessionId, node\.id\)\}[\s\S]*?active=\{focusedPaneId === node\.id\}[\s\S]*?visible/,
  "every visible terminal stays mounted while only the focused pane owns input",
);
assert.match(
  workbenchFiles,
  /<RailFilePreview[\s\S]*?projectRoot=\{projectRoot\}/,
  "Files tab reuses RailFilePreview — editing + Cmd/Ctrl+S save come with it",
);

// ── PR tab (stage pipeline + checks + review + merge) ────────────────────────

const prPanel = await readFile(new URL("./code-session-pr-panel.tsx", import.meta.url), "utf8");

assert.match(
  contextDock,
  /import\("@\/components\/code-session-pr-panel"\)/,
  "the Pull request dock tab stays dynamic",
);
assert.match(
  contextDock,
  /\{tab === "pr" \? <LazyPullRequest key=\{row\.id\} row=\{row\} \/> : null\}/,
  "Pull request mounts keyed by session id so switching sessions never shows stale state",
);
assert.match(
  prPanel,
  /resolveStageForBranch\(\{ branch, open: state\.open, merged: state\.merged, beads: state\.beads \}\)/,
  "the stage strip uses the SAME resolveStageForBranch as the work queue + chat header",
);
assert.match(
  prPanel,
  /const branch = codeSessionBranch\(row\);/,
  "stage branch comes from the session's ATTRIBUTED branch (cave-9q24), never the checkout's current branch",
);
for (const call of [
  '/api/github/checks?repo=',
  '/api/github/comments?repo=',
  '"/api/github/resolve-thread"',
  '"/api/github/review"',
  '"/api/github/merge"',
] as const) {
  assert.ok(prPanel.includes(call), `PR panel reuses the existing GitHub API surface (${call})`);
}
assert.match(
  prPanel,
  /method: "squash"/,
  "merge is squash-only — the repo's protected-main convention",
);
assert.match(
  prPanel,
  /if \(!confirmMerge\) \{\s*setConfirmMerge\(true\);\s*return;\s*\}/,
  "merge requires a second confirming click — no one-click merges",
);

// ── Composer + new-session flow ──────────────────────────────────────────────

const composer = await readFile(new URL("./code-composer.tsx", import.meta.url), "utf8");
const newSession = await readFile(new URL("./code-new-session.tsx", import.meta.url), "utf8");
const rail = await readFile(new URL("./code-session-rail.tsx", import.meta.url), "utf8");

assert.match(
  composer,
  /streamFamiliarText\(\{\s*familiarId: row\.familiarId,\s*sessionId: row\.id,/,
  "the composer RESUMES the selected session (sessionId rides) — never forks a new thread",
);
const composerSend = composer.match(/result = await streamFamiliarText\(\{[\s\S]*?\}\);/)?.[0] ?? "";
assert.ok(composerSend.length > 0, "the composer resume send is present");
assert.ok(
  !composerSend.includes("projectRoot"),
  "composer resumes assert NO projectRoot — the server derives the cwd from the conversation record; an explicit worktree root fails closed as unregistered (403, cave-kv8a)",
);
assert.match(
  composer,
  /catch \(err\) \{[\s\S]*?if \(controller\.signal\.aborted\) \{\s*setPhase\(\{ kind: "done" \}\);/,
  "a mid-stream Stop rejects the reader — the catch keeps the partial reply and lands on done instead of wedging the streaming phase (cave-kv8a)",
);
assert.match(
  composer,
  /"\/api\/chat\/stop"[\s\S]*?runId: phase\.runId, sessionId: row\.id/,
  "Stop cancels via /api/chat/stop with the send's runId before dropping the stream",
);
assert.match(
  newSession,
  /action: "create-worktree", branch: branch\.trim\(\)/,
  "fresh-worktree option provisions through the existing /api/changes action",
);
const kickoff = newSession.match(/void streamFamiliarText\(\{[\s\S]*?\}\)\s*\.then/)?.[0] ?? "";
assert.ok(kickoff.length > 0, "the new-session kickoff send is present");
assert.ok(
  !kickoff.includes("sessionId:"),
  "the kickoff send carries NO sessionId — a fresh thread, saved like any chat",
);
assert.match(
  newSession,
  /onSession: announce,/,
  "the rail learns the new session id the moment the bridge announces it",
);
assert.match(
  newSession,
  /const announce = \(sessionId: string\) => \{[\s\S]*?reset\(\);\s*onCreated\(sessionId\);/,
  "success restores idle state before handing off — the mounted modal otherwise reopens bricked on 'Starting session…' (cave-kv8a)",
);
assert.match(
  newSession,
  /\.catch\(\(err\) => \{[\s\S]*?if \(!announced\) \{/,
  "a kickoff stream failure surfaces as an error phase instead of an unhandled rejection (cave-kv8a)",
);
assert.match(
  rail,
  /onNewSession\?: \(\) => void;/,
  "the rail exposes the + New session entry point",
);
assert.match(
  codeView,
  /pendingNewIdRef\.current === selectedId\) return;/,
  "a just-created session's selection survives until /api/sessions/list catches up",
);
assert.match(
  workbench,
  /<CodeComposer row=\{row\} onJumpToSession=\{onJumpToSession\} \/>/,
  "the follow-up composer remains available below the terminal/context split",
);

// ── Inspector: branches / worktrees / session env (right column) ─────────────

// The inspector reuses the exact /api/changes surface chat's composer git chip
// speaks (?branches=1, switch-branch, create-worktree) but scopes every call
// to the session's WORK ROOT — a worktree session mutates its own checkout,
// never the shared root (cave-9q24).
const inspector = await readFile(new URL("./code-inspector.tsx", import.meta.url), "utf8");
assert.match(
  inspector,
  /const workRoot = codeSessionWorkRoot\(row\);/,
  "every inspector call is scoped to the session's work root",
);
assert.match(
  inspector,
  /\/api\/changes\?projectRoot=\$\{encodeURIComponent\(projectRoot\)\}&branches=1/,
  "branch list comes from the same ?branches=1 contract as chat's git chip",
);
assert.match(
  inspector,
  /action: "switch-branch", branch: name/,
  "one-click branch switch posts the existing switch-branch action",
);
assert.match(
  inspector,
  /action: "create-worktree", branch: name/,
  "fresh-worktree provisioning posts the existing create-worktree action",
);
assert.match(
  inspector,
  /disabled=\{b\.current \|\| busyBranch != null\}/,
  "the checked-out branch is not a switch target and switches don't overlap",
);
assert.match(
  contextDock,
  /\{ id: "inspector", label: "Inspector"/,
  "Inspector is a first-class context dock tab",
);
assert.match(
  contextDock,
  /<LazyInspector key=\{workRoot\} row=\{row\} onChanged=\{onRefresh\} \/>/,
  "inspector mutations re-poll the enriched session list via onRefresh",
);
assert.match(
  codeView,
  /onRefresh=\{onTasksRefresh\}/,
  "code-view threads the workspace's tasks refresh into the workbench",
);

// ── Mobile drill-in (list-first below md) ────────────────────────────────────

// Below the md breakpoint the rail is the landing screen: no newest-session
// auto-pick on narrow mounts, an explicit Back (null) suppresses re-selection,
// and the rail/workbench swap is pure CSS (hidden md:block / hidden md:flex)
// so desktop keeps the three-pane layout untouched.
assert.match(
  codeView,
  /useState<string \| null \| undefined>\(\s*deepLink\?\.sessionId \?\? undefined,?\s*\)/,
  "selection is tri-state: undefined = auto-pick allowed, null = user went Back",
);
assert.match(
  codeView,
  /if \(selectedId === null\) return;/,
  "an explicit Back is terminal — auto-pick must not re-select",
);
// StrictMode double-invokes state initializers in dev: parsing must stay pure
// there and the URL strip must live in a mount effect, or the second
// initializer run reads an already-stripped URL and loses the deep link
// (caught by tests/code-surface.spec.ts against next dev).
assert.match(
  codeView,
  /return parseCodeDeepLink\(new URLSearchParams\(window\.location\.search\)\);/,
  "the deep-link initializer is pure (StrictMode-safe)",
);
assert.match(
  codeView,
  /useEffect\(\(\) => \{\s*const params = new URLSearchParams\(window\.location\.search\);\s*if \(!params\.has\("session"\)/,
  "the ?session/ctab/wtab strip happens in a mount effect, not the initializer",
);
assert.match(
  codeView,
  /window\.matchMedia\("\(max-width: 767px\)"\)\.matches/,
  "narrow mounts land on the session list, not the newest workbench",
);
assert.match(
  codeView,
  /if \(narrowMountRef\.current\) return;/,
  "the auto-pick effect honors the narrow-mount guard",
);
assert.match(
  codeView,
  /const showWorkbench = Boolean\(selected \|\| githubOpen\)/,
  "a selected session or in-Room GitHub context can drive the compact workbench",
);
assert.match(
  codeView,
  /\$\{showWorkbench \? "hidden md:block" : "block"\}[\s\S]*?\$\{showWorkbench \? "flex" : "hidden md:flex"\}/,
  "the rail and workbench swap below md when session or GitHub context is open",
);
assert.match(
  codeView,
  /aria-label="Back to sessions"[\s\S]{0,180}?setSelectedId\(null\);[\s\S]{0,80}?setGithubOpen\(null\);/,
  "the mobile Back affordance clears session and GitHub context explicitly",
);

// ── Chat stays untouched this phase ──────────────────────────────────────────

// Phase 1 builds the surface *behind the flag* without slimming Chat: the code
// rail, its surface-agnostic shape, and composer copy are exactly as the
// retirement left them. Removing/redirecting them is the follow-up phase.
assert.doesNotMatch(
  chatSurface,
  /surface\s*=\s*"chat"|surface === "code"|isCodeSurface|CodeInlineToolbar|data-surface=\{surface\}/,
  "ChatSurface must not regrow a code-surface branch",
);
assert.match(chatSurface, /const compactRail = hideThreadRail/, "ChatSurface compact mode is driven only by hideThreadRail");
assert.match(chatSurface, /\{\s*id:\s*"projects",\s*label:\s*"Projects"\s*\}/, "Chat keeps Projects as its second primary tab");
assert.match(workspace, /const contextualNav = mode === "chat" \? chatSidebar : sidebar;/, "chat mode replaces the global nav with the contextual Chats sidebar");
assert.match(workspace, /nav=\{contextualNav\}\s*list=\{undefined\}/, "workspace mounts the contextual Chat nav without an independent list pane");
assert.doesNotMatch(chatRouter, /surface\?:|surface=\{surface\}/, "ChatRouter must not forward a surface prop");
assert.doesNotMatch(chatView, /surface\?:|surface === "code"|Ask for follow-up changes/, "ChatView must not carry Code-specific composer copy this phase");

console.log("code-surface-mode.test.ts: ok");
