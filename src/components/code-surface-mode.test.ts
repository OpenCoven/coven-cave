// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Pin suite for the dedicated Code surface (cave-k0ua).
//
// History: a standalone "code" WorkspaceMode was retired and this file's
// predecessor (code-view.test.ts) was the retirement guard keeping it deleted.
// The owner requested a Codex-style multi-session coding surface — diffs,
// files, terminal, per-session PR context, worktrees, branches, with GitHub
// absorbed as a tab — so the mode returned, flag-gated by caveCodeSurface()
// (NEXT_PUBLIC_CAVE_CODE_SURFACE). These pins document the sanctioned shape:
// the surface exists, the flag gates entry, and Chat's own code rail stays
// untouched until the flagged follow-up that slims it.

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const modeType = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const codeView = await readFile(new URL("./code-view.tsx", import.meta.url), "utf8");
const lazySurfaces = await readFile(new URL("./lazy-surfaces.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = await readFile(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");

// ── Mode vocabulary ──────────────────────────────────────────────────────────

assert.match(modeType, /\|\s*"code"/, "WorkspaceMode includes the Code surface again (cave-k0ua)");

// ── Workspace wiring ─────────────────────────────────────────────────────────

assert.match(
  workspace,
  /code: "Code"/,
  "WORKSPACE_MODE_TITLES names the Code surface (canonical-nav agreement)",
);
assert.match(
  workspace,
  /mode === "code" \? \(\s*<CodeView/,
  "Workspace renders CodeView on the code mode",
);
assert.match(
  lazySurfaces,
  /const loadCodeView = \(\) => import\("@\/components\/code-view"\)\.then\(\(m\) => m\.CodeView\)/,
  "CodeView stays code-split behind lazy-surfaces — its chunk must not join the boot bundle",
);

// Flag gating: while caveCodeSurface() is off, "code" deep links keep the
// retirement-era fallback (newest repo chat); with it on they land on the
// surface. Both behaviors live in the same navigate-mode branch.
assert.match(
  workspace,
  /if \(targetMode === "code" && !caveCodeSurface\(\)\) \{[\s\S]*?filter\(\(s\) => s\.project_root\)[\s\S]*?openFamiliarSession\(repoSession\.id, repoSession\.familiarId\)[\s\S]*?setMode\("chat"\)/,
  "flag-off code deep-links redirect to the newest repo chat or Chat fallback",
);
// The setMode funnel is the choke point for every other entry (?mode= deep
// link, persisted last-surface restore): flag off, "code" lands on Chat
// instead of rendering a gated surface.
assert.match(
  workspace,
  /if \(next === "code" && !caveCodeSurface\(\)\) \{[\s\S]{0,600}?setModeRaw\("chat"\);\s*return;/,
  "setMode funnels flag-off code requests to Chat",
);

// File/diff links from inbox cards etc. still target Chat's code rail this
// phase — retargeting them to the Code surface is an explicit follow-up.
assert.match(
  workspace,
  /File\/diff links target ChatSurface's code rail[\s\S]*?setPendingCodeRailOpen\([\s\S]*?setMode\("chat"\)/,
  "file-open events keep targeting Chat's code rail until the flagged follow-up",
);

// The primary keyboard cluster is unchanged: Code is a quiet destination, not
// a ⌘1-5 surface.
assert.match(
  workspace,
  /const SURFACE_ORDER: WorkspaceMode\[\] = \[\s*"home", "chat", "board", "inbox", "browser",\s*\]/,
  "keyboard surface order keeps the primary cluster without Code",
);

// ── Sidebar row swap ─────────────────────────────────────────────────────────

// One quiet slot, two vocabularies: flag on → Code row (GitHub becomes a tab
// inside the surface); flag off → the standalone GitHub row, byte-identical to
// the pre-flag sidebar. The conditional spread keeps FOLDER_MODES a single
// literal so palette/mobile/canonical-name extraction regexes stay valid.
assert.match(
  sidebar,
  /\.\.\.\(caveCodeSurface\(\)\s*\?\s*\[\{ id: "code", label: "Code", iconName: "ph:code"/,
  "flag on: the Code quiet row takes the GitHub slot",
);
assert.match(
  sidebar,
  /\{ id: "github", label: "GitHub", iconName: "ph:github-logo"/,
  "flag off: the GitHub row literal survives in FOLDER_MODES",
);
assert.match(
  codeView,
  /import\("@\/components\/github-view"\)\.then\(\(m\) => m\.GitHubView\)/,
  "the Code surface mounts GitHubView whole under its GitHub tab",
);

// ── Workbench (Diff | Files | Terminal) ──────────────────────────────────────

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
  workbench,
  /<SessionChangesInner key=\{workRoot\} projectRoot=\{workRoot\} running=\{running\} \/>/,
  "Diff tab mounts the proven changes panel keyed+scoped to the work root",
);
assert.match(
  workbench,
  /import\("@\/components\/code-workbench-files"\)/,
  "Files tab is dynamic() so CodeMirror stays out of the surface's initial chunk",
);
assert.match(
  workbench,
  /import\("@\/components\/rail-terminal-panel"\)/,
  "Terminal tab is dynamic() so xterm stays out of the surface's initial chunk",
);
assert.match(
  workbench,
  /\{terminalOpened \? \([\s\S]*?active=\{tab === "terminal"\}/,
  "the terminal stays mounted once opened (keepalive) with active tracking the tab",
);
assert.match(
  workbenchFiles,
  /<RailFilePreview[\s\S]*?projectRoot=\{projectRoot\}/,
  "Files tab reuses RailFilePreview — editing + Cmd/Ctrl+S save come with it",
);

// ── PR tab (stage pipeline + checks + review + merge) ────────────────────────

const prPanel = await readFile(new URL("./code-session-pr-panel.tsx", import.meta.url), "utf8");

assert.match(
  workbench,
  /import\("@\/components\/code-session-pr-panel"\)/,
  "PR tab is dynamic() — its fetch stack stays out of the surface's initial chunk",
);
assert.match(
  workbench,
  /\{tab === "pr" \? <LazyPrTab key=\{row\.id\} row=\{row\} \/> : null\}/,
  "PR tab mounts keyed by session id so switching sessions never shows stale PR state",
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
  /\{tab !== "terminal" \? <CodeComposer row=\{row\} onJumpToSession=\{onJumpToSession\} \/> : null\}/,
  "the composer rides under every tab except Terminal (which owns its input)",
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
  workbench,
  /aria-pressed=\{inspectorOpen\}/,
  "the header exposes an accessible inspector toggle",
);
assert.match(
  workbench,
  /\{inspectorOpen \? \(\s*<aside/,
  "the inspector column mounts only when toggled open",
);
assert.match(
  workbench,
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
  /\$\{selected \? "hidden md:block" : "block"\}/,
  "picking a session hides the rail below md only",
);
assert.match(
  codeView,
  /\$\{selected \? "flex" : "hidden md:flex"\}/,
  "the workbench column is hidden below md until a session is picked",
);
assert.match(
  codeView,
  /aria-label="Back to sessions"[\s\S]{0,80}onClick=\{\(\) => setSelectedId\(null\)\}/,
  "the mobile Back affordance clears the selection explicitly",
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
