// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  codeSessionHasOpenPr,
  resolveCodeWorkbenchPanels,
} from "../lib/code-surface.ts";

// Pin suite for the dedicated Code surface (cave-k0ua).
//
// History: a standalone "code" WorkspaceMode was retired and this file's
// predecessor (code-view.test.ts) was the retirement guard keeping it deleted.
// The owner requested a Codex-style multi-session coding surface — diffs,
// files, terminal, per-session PR context, worktrees, branches, with GitHub
// absorbed as a tab — so the mode returned behind caveCodeSurface(). Phase 2
// (cave-m6ys) made it default-on. Phase 3 (cave-cc5r) moved the surface into
// the Coding familiar's Role Surface room: "code" is now an alias landing on
// `surface:code` (role-gated, explicit familiar Type picker in the Studio).
// Legacy "github" entry points are now compatibility routing into that same
// room while the sidebar row still exists. These pins document that sanctioned
// shape.

const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const navigation = await readFile(new URL("../lib/workspace-navigation.ts", import.meta.url), "utf8");
const modeType = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const pageRegistry = await readFile(new URL("../lib/workspace-page-registry.ts", import.meta.url), "utf8");
const codeView = await readFile(new URL("./code-view.tsx", import.meta.url), "utf8");
const githubView = await readFile(new URL("./github-view.tsx", import.meta.url), "utf8");
const lazySurfaces = await readFile(new URL("./lazy-surfaces.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const chatRouter = await readFile(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const registerRooms = await readFile(new URL("./role-surfaces/register.tsx", import.meta.url), "utf8");
const codeRoom = await readFile(new URL("./role-surfaces/code-room.tsx", import.meta.url), "utf8");
const pendingNavigation = await readFile(new URL("../lib/pending-code-navigation.ts", import.meta.url), "utf8");

const reviewRow = (over = {}) => ({
  diff: null,
  pullRequest: null,
  ...over,
});

assert.equal(codeSessionHasOpenPr(reviewRow()), false, "sessions without PR context do not count as open review work");
assert.equal(
  codeSessionHasOpenPr(reviewRow({ pullRequest: { repo: "acme/alpha" } })),
  true,
  "PR context with no terminal state still counts as open by current queue semantics",
);
assert.equal(
  codeSessionHasOpenPr(reviewRow({ pullRequest: { repo: "acme/alpha", state: "open" } })),
  true,
  "explicitly open PRs count as open review work",
);
assert.equal(
  codeSessionHasOpenPr(reviewRow({ pullRequest: { repo: "acme/alpha", state: "closed" } })),
  false,
  "closed PRs do not auto-open the review rail",
);
assert.equal(
  codeSessionHasOpenPr(reviewRow({ pullRequest: { repo: "acme/alpha", state: "merged" } })),
  false,
  "merged PRs do not auto-open the review rail",
);
assert.deepEqual(
  resolveCodeWorkbenchPanels({ row: reviewRow() }),
  { reviewOpen: false, terminalOpen: false },
  "a clean session starts with the compact bottom bar and the review rail closed",
);
assert.deepEqual(
  resolveCodeWorkbenchPanels({
    row: reviewRow({ diff: { additions: 3, deletions: 1 } }),
  }),
  { reviewOpen: true, terminalOpen: false },
  "a changed session starts with the review rail open",
);
assert.deepEqual(
  resolveCodeWorkbenchPanels({
    row: reviewRow({ pullRequest: { repo: "acme/alpha", state: "open" } }),
  }),
  { reviewOpen: true, terminalOpen: false },
  "an open PR starts with the review rail open even when the diff is clean",
);
assert.deepEqual(
  resolveCodeWorkbenchPanels({
    row: reviewRow(),
    reviewOpen: false,
    terminalOpen: false,
    initialTab: "pr",
  }),
  { reviewOpen: true, terminalOpen: false },
  "routed PR navigation reopens the rail even when the stored state says closed",
);
assert.deepEqual(
  resolveCodeWorkbenchPanels({
    row: reviewRow(),
    reviewOpen: false,
    terminalOpen: false,
    initialTab: "terminal",
  }),
  { reviewOpen: false, terminalOpen: true },
  "routed terminal navigation reopens the drawer even when the stored state says closed",
);
assert.deepEqual(
  resolveCodeWorkbenchPanels({
    row: reviewRow(),
    reviewOpen: false,
    terminalOpen: false,
    openTarget: { kind: "changes", path: "src/example.ts", nonce: 7 },
  }),
  { reviewOpen: true, terminalOpen: false },
  "routed diff navigation reopens the rail even when the stored state says closed",
);

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
  pendingNavigation,
  /export type PendingCodeNavigation =[\s\S]*kind: "tab"[\s\S]*kind: "github-item"/,
  "Code navigation has one shared tab/item handoff contract",
);
assert.match(
  codeRoom,
  /subscribePendingCodeNavigation[\s\S]*getPendingCodeNavigation[\s\S]*navigationRequest=\{pendingNavigation\}[\s\S]*onNavigationHandled=\{acknowledgePendingCodeNavigation\}/,
  "the room consumes pending GitHub navigation after the role surface mounts",
);

// ── Workspace wiring ─────────────────────────────────────────────────────────

assert.match(
  pageRegistry,
  /code: \{\s*id: "code",\s*title: "Code",\s*canonicalId: CODE_ROLE_SURFACE_MODE,/,
  "the page registry names the Code alias and maps it to the canonical role surface",
);
assert.match(
  workspace,
  /if \(next === "code"\) \{[\s\S]{0,700}?commitMode\(roleSurfaceMode\(CODE_SURFACE_ID\)\)/,
  "setMode funnels every code entry point (deep links, palette, navigate-mode, persisted restore) into the room",
);
assert.match(
  modeType,
  /github: "surface:code"/,
  "MODE_ALIASES routes the github compatibility alias onto the Coding familiar's room",
);
assert.doesNotMatch(
  workspace,
  /mode === "github" \?[\s\S]{0,400}?<GitHubView/,
  "Workspace no longer renders a standalone GitHub surface; legacy github requests funnel into the room",
);
assert.doesNotMatch(
  lazySurfaces,
  /loadGitHubView|export const GitHubView|case "github"/,
  "the standalone GitHub chunk and sidebar preload path are removed",
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

// One room-driven vocabulary (cave-cc5r): GitHub no longer owns a peer
// workspace row. The Code room arrives via the registry-driven roleSurfaces
// cluster and hosts GitHub's demand-loaded tabs itself.
assert.doesNotMatch(
  navigation,
  /\{ id: "github", label: "GitHub"/,
  "GitHub has no peer workspace row",
);
assert.doesNotMatch(
  workspace,
  /hideGithubRow=|githubAssignedCount=/,
  "Workspace no longer carries standalone row props",
);
assert.doesNotMatch(
  navigation,
  /\{ id: "code", label: "Code"/,
  "no static Code row survives in workspace navigation — the room row is registry-driven",
);
assert.doesNotMatch(
  workspace,
  /visibleSurfaces\.some\(\(s\) => s\.id === surfaceId\)\) setMode\("home"\)/,
  "Workspace lets RoleSurfaceHost render the explicit wrong-role closed-room state",
);
assert.match(
  codeView,
  /import\("@\/components\/github-view"\)\.then\(\(m\) => m\.GitHubView\)/,
  "the Code surface mounts GitHubView whole under its GitHub tab",
);
assert.match(
  codeView,
  /role="tablist"[\s\S]*aria-label="Code surface"[\s\S]*Review[\s\S]*Work[\s\S]*GitHub/,
  "the primary Coding Desk tablist is simplified to Review, Work, and GitHub",
);
assert.match(
  codeView,
  /const githubTab: CodeGithubTab \| null = isCodeGithubTab\(topTab\) \? topTab : null;/,
  "the simplified GitHub primary selection is still driven by the existing CodeTopTab GitHub values",
);
assert.match(
  codeView,
  /const \[lastGithubTab, setLastGithubTab\] = useState<CodeGithubTab>\([\s\S]*?\?\? "activity",\s*\);[\s\S]*const lastGithubTabRef = useRef\(lastGithubTab\);/,
  "CodeView keeps a remembered GitHub subtab in state and a ref so leaving GitHub does not reset the secondary filter",
);
assert.match(
  codeView,
  /aria-selected=\{githubTab !== null\}[\s\S]*onClick=\{\(\) => setTopTab\(lastGithubTabRef\.current\)\}/,
  "activating the GitHub primary tab re-enters the last remembered GitHub subtab instead of always resetting to Activity",
);
assert.match(
  codeView,
  /githubTab \? \(\s*<div[\s\S]*role="tablist"[\s\S]*aria-label="GitHub filter"[\s\S]*CODE_GITHUB_TABS\.map\(\(id\) =>/,
  "an active GitHub tab renders the secondary GitHub filter tablist from the existing tab metadata",
);
assert.match(
  codeView,
  /role="tablist"[\s\S]*aria-label="GitHub filter"[\s\S]*aria-orientation="horizontal"[\s\S]*CODE_GITHUB_TABS\.map\(\(id\) =>[\s\S]*id=\{githubFilterTabId\(id\)\}[\s\S]*aria-controls=\{githubFilterPanelId\(id\)\}[\s\S]*tabIndex=\{githubTab === id \? 0 : -1\}[\s\S]*onKeyDown=\{\(event\) => handleGithubFilterKeyDown\(event, id\)\}/,
  "the secondary GitHub filter is a keyboard-operable tablist with roving tabindex and stable aria wiring",
);
assert.match(
  codeView,
  /role="tabpanel"[\s\S]*id=\{githubFilterPanelId\(githubTab\)\}[\s\S]*aria-labelledby=\{githubFilterTabId\(githubTab\)\}/,
  "the visible GitHub surface is exposed as the tabpanel controlled by the selected GitHub filter tab",
);
assert.match(
  codeView,
  /activity: "all"[\s\S]*prs: "pr"[\s\S]*issues: "issue"[\s\S]*reviews: "review_request"/,
  "Coding Desk preserves the former all feed and each specialized filter",
);
assert.match(
  codeView,
  /const \[topTab, setTopTab\] = useState<CodeTopTab>\(\s*pendingOpen\s*\?\s*"sessions"\s*:\s*navigationRequest\s*\?\s*topTabForNavigation\(navigationRequest\)\s*:\s*deepLink\?\.topTab \?\? "sessions",\s*\);/,
  "simultaneous file/diff navigation prevents even the first stale GitHub render.",
);
assert.match(
  codeView,
  /const \[initialGithubTarget, setInitialGithubTarget\] = useState<GitHubItemTarget \| null>\(\s*pendingOpen\s*\?\s*null\s*:\s*navigationRequest\?\.kind === "github-item"\s*\?\s*navigationRequest\.target\s*:\s*null,\s*\);/,
  "simultaneous file/diff navigation prevents even the first stale GitHub render.",
);
assert.match(
  codeView,
  /onInitialTargetHandled=\{\(\) => setInitialGithubTarget\(null\)\}/,
  "CodeView drops the host target after GitHubView captures it",
);
assert.match(
  codeView,
  /const \[githubNavigationKey, setGithubNavigationKey\] = useState\(\s*navigationRequest\?\.nonce \?\? 0,\s*\);/,
  "CodeView tracks a GitHub remount key from the current request nonce so a newer null-target tab request can clear stale detail",
);
assert.match(
  codeView,
  /setInitialGithubTarget\([\s\S]*?\);\s*setGithubNavigationKey\(navigationRequest\.nonce\);[\s\S]*?onNavigationHandled\?\.\(navigationRequest\.nonce\)/,
  "each newly handled GitHub navigation request refreshes the remount key before acknowledgement",
);
assert.match(
  codeView,
  /<LazyGitHubView\s+key=\{githubNavigationKey\}[\s\S]*initialTarget=\{initialGithubTarget\}/,
  "GitHubView remounts only on a newer request nonce, so clearing the captured target alone cannot leave stale detail authoritative",
);
assert.match(
  githubView,
  /if \(!initialTarget\) return;[\s\S]*setDeepLink\(initialTarget\);[\s\S]*onInitialTargetHandled\?\.\(\)/,
  "clearing the host prop does not erase GitHubView's local deep-linked detail",
);
assert.match(
  codeView,
  /const pendingQueueSelectedId = useMemo\(\s*\(\) => resolvePendingCodeOpenSessionId\(sessions, pendingOpen\),[\s\S]*const queueSelectedId = pendingQueueSelectedId \?\? \(typeof selectedId === "string" \? selectedId : null\);[\s\S]*const queue = useMemo\(\s*\(\) => codeReviewQueue\(sessions, queueMode, queueSelectedId\),/,
  "CodeView resolves a root-only pending open into the selected queue override before reviewable filtering, with selectedId as the fallback",
);
assert.match(
  codeView,
  /import\s*\{[\s\S]*codeComboFromEvent[\s\S]*isCodeShortcutTarget[\s\S]*\}\s*from "@\/lib\/code-shortcuts";/,
  "CodeView reuses the shared combo normalizer and shortcut-target guard rather than re-implementing typing detection",
);
assert.match(
  codeView,
  /useRef\(new Map<string, boolean>\(\)\)[\s\S]*useRef\(new Map<string, boolean>\(\)\)/,
  "CodeView keeps review-rail and terminal open state in per-session ref Maps",
);
assert.match(
  codeView,
  /if \(event\.defaultPrevented\) return;[\s\S]*if \(!isCodeShortcutTarget\(event\.target\)\) return;[\s\S]*const combo = codeComboFromEvent\(event\);[\s\S]*combo === "\/"[\s\S]*stopImmediatePropagation\(\)[\s\S]*activeQueuePickerTrigger\(\)[\s\S]*\[data-code-picker-panel\] \[data-code-session-search\]/,
  "the room keydown handler normalizes combos once, claims slash before broader listeners can steal it, and focuses the active picker search",
);
assert.match(
  codeView,
  /querySelectorAll<HTMLButtonElement>\("\[data-code-session-id\]"\)[\s\S]*combo === "J" \|\| combo === "K"[\s\S]*rows\[nextIndex\]\?\.focus\(\)[\s\S]*combo === "Shift\+A"/,
  "the room keydown handler walks visible session rows and toggles scope from normalized fixed queue combos",
);
assert.match(
  codeView,
  /window\.addEventListener\("keydown", onKeyDown, true\)/,
  "queue shortcuts listen in capture phase so the narrow landing's slash reaches the Code surface before broader slash search handlers",
);
assert.match(
  codeView,
  /if \(!pendingOpen\) return;[\s\S]*const byId = pendingQueueSelectedId\s*\?\s*queueSessions\.find\(\(row\) => row\.id === pendingQueueSelectedId\)/,
  "the pending-open effect reuses the resolved queue override id so excluded sessions remain selectable from queue.sessions",
);
assert.match(
  codeView,
  /if \(!pendingOpen\) return;[\s\S]*setTopTab\("sessions"\);\s*setInitialGithubTarget\(null\);\s*if \(target\) setSelectedId\(target\.id\);[\s\S]*setWorkbenchTarget\(root && !target \? null : \{ open: pendingOpen, sessionId: target\?\.id \?\? null \}\);/,
  "file/diff navigation supersedes a pending GitHub detail so it cannot replay: the pending-open effect must switch to Sessions, clear the latched GitHub target, then keep the existing session/workbench selection flow",
);

// ── Workbench: the reading room (tree | source | review, terminal drawer) ────
//
// Rebuilt from the `Cody Code Reading v2` frame (cave-0rcku). The previous
// shape put the terminal in the CENTRE column, which honoured "never hide the
// shell" but left the source itself without a column on a surface whose whole
// job is reading. The frame keeps the commitment and pays for it in height: the
// shell is a permanently-present bottom drawer.

const workbench = await readFile(new URL("./code-workbench.tsx", import.meta.url), "utf8");
const reviewRail = await readFile(new URL("./code-review-rail.tsx", import.meta.url), "utf8");
const terminalDrawer = await readFile(new URL("./code-terminal-drawer.tsx", import.meta.url), "utf8");
const workbenchTree = await readFile(new URL("./code-workbench-tree.tsx", import.meta.url), "utf8");
const terminalWorkspace = await readFile(new URL("./code-terminal-workspace.tsx", import.meta.url), "utf8");

// Every column scopes to the session's WORK root (worktree over shared
// checkout, cave-9q24) — pointing any of them at project_root directly would
// show a different session's churn on shared checkouts.
assert.match(
  workbench,
  /const workRoot = codeSessionWorkRoot\(row\);/,
  "the workbench derives one work root for the tree, the viewer and the rail",
);
assert.match(
  workbench,
  /const panels = resolveCodeWorkbenchPanels\(\{[\s\S]*row,[\s\S]*initialTab,[\s\S]*openTarget[\s\S]*\}\);/,
  "CodeWorkbench derives its panel defaults from the shared pure model so source tests can pin the content-aware opening rules",
);

// The three columns, in order.
assert.match(
  workbench,
  /<CodeWorkbenchTree[\s\S]*?<RailFilePreview[\s\S]*?<CodeReviewRail/,
  "the room renders file tree, source viewer, then the review rail",
);

// THE COMMITMENT THAT SURVIVED THE REBUILD. The terminal must never unmount —
// remounting it would drop the live PTY attachment and the scrollback with it.
// It keeps ONE slot in the tree at every width and every drill-in step, and
// only its `visible` prop changes.
assert.match(
  workbench,
  /<CodeTerminalDrawer[\s\S]{0,240}open=\{panels\.terminalOpen\}/,
  "the terminal drawer sits outside the column body, so no step can unmount it",
);
assert.doesNotMatch(
  workbench,
  /step === "terminal"/,
  "the terminal is not a drill-in step — narrowing the room must never take the shell away",
);
assert.match(
  terminalDrawer,
  /visible=\{open\}/,
  "the drawer hides the workspace via its supported keepalive prop, never by unmounting",
);
assert.doesNotMatch(
  terminalDrawer,
  /\{open \? <CodeTerminalWorkspace/,
  "the workspace must not be conditionally rendered — that is an unmount, and the PTY goes with it",
);

// The composer rides under every column, so a follow-up stays available while
// reading any of them.
assert.match(
  workbench,
  /<CodeComposer row=\{row\} onJumpToSession=\{onJumpToSession\} \/>/,
  "the composer rides under the whole room",
);

// Session switches reset the split tree; carrying another session's panes over
// would attach terminals to the wrong work root.
assert.match(
  terminalDrawer,
  /useEffect\(\(\) => \{[\s\S]*?createTerminalLayout\(\);[\s\S]*?\}, \[sessionId\]\);/,
  "the terminal layout resets per session",
);

// The review rail keeps the PR panel code-split — the room opens far more often
// than the PR tab, and its fetch stack must not ride the first chunk.
assert.match(
  reviewRail,
  /import\("@\/components\/code-session-pr-panel"\)/,
  "the PR panel is dynamic() so its fetch stack stays out of the room's initial chunk",
);
assert.match(
  reviewRail,
  /<SessionChangesInner\s+key=\{projectRoot\}\s+projectRoot=\{projectRoot\}\s+running=\{running\}/,
  "Changes mounts the proven changes panel keyed+scoped to the work root",
);

// A CLOSED rail still has to answer "is there anything to review?" — a panel
// that vanished entirely would make that unanswerable without reopening it.
assert.match(
  reviewRail,
  /className="focus-ring code-rail__spine"[\s\S]{0,700}code-rail__spine-stat/,
  "the closed rail leaves a spine that still prints the diffstat",
);

// The divider is a real control, not a pointer-only hazard.
assert.match(
  reviewRail,
  /role="separator"[\s\S]{0,400}onKeyDown=\{onSeparatorKeyDown\}/,
  "the resize handle is keyboard-operable",
);

// cave-uod42, kept: the rail and the drill-in swap content under a stationary
// cursor, so a change nobody can see must at least be a change somebody hears.
assert.match(
  reviewRail,
  /const \{ announce \} = useAnnouncer\(\)/,
  "the rail announces through the shared live region",
);
assert.match(
  terminalDrawer,
  /announce\(next \? "Terminal drawer open\." : "Terminal drawer closed\."\)/,
  "opening and closing the drawer is announced",
);

// The tree's status marks and the rail's diffstat read the SAME summary, so the
// two can never disagree about what changed.
assert.match(
  workbench,
  /const changes = useWorktreeChanges\(workRoot, running\);/,
  "one changes subscription feeds the tree and the rail",
);
assert.match(
  workbenchTree,
  /decorate=\{decorate\}/,
  "the tree decorates rows from that same summary rather than fetching its own",
);
// Status is never carried by colour alone.
assert.match(
  workbenchTree,
  /\{STATUS_LETTER\[file\.status\]\}/,
  "the porcelain letter is always rendered beside the tint",
);

// The primary pane must keep the session's shared rail shell, or a shell
// started in Chat becomes a different process here.
assert.match(
  terminalWorkspace,
  /terminalPaneThreadId\(sessionId, paneId\)/,
  "each pane derives its PTY thread id from the shared pure model",
);
assert.match(
  terminalWorkspace,
  /visible=\{visible\}/,
  "every visible leaf keeps its screen-reader mirror flowing, not just the focused one",
);
assert.match(
  terminalWorkspace,
  /active=\{visible && isFocused\}/,
  "only the focused leaf is active — that is what drives refit and refocus",
);
assert.match(
  terminalWorkspace,
  /aria-current=\{isFocused \? "true" : undefined\}/,
  "pane focus is exposed to AT, not signalled by colour alone",
);
// Split affordances read the pane they act on. Measuring only the focused pane
// mis-states every other pane's header buttons, which stay live regardless of
// where focus sits — and pointer focus is not committed before the click.
assert.match(
  terminalWorkspace,
  /const fits = paneFits\(paneId\);/,
  "each pane's split buttons use that pane's own measurement",
);
assert.match(
  terminalWorkspace,
  /const fits = fitsByPaneRef\.current\[paneId\] \?\? DEFAULT_PANE_FITS;/,
  "the split handler re-checks the target pane's measurement, not the focused pane's",
);
assert.match(
  workbench,
  /<RailFilePreview[\s\S]*?projectRoot=\{workRoot\}/,
  "the viewer reuses RailFilePreview — editing + Cmd/Ctrl+S save come with it",
);


// ── Full PR reader (cave-l82dm) ─────────────────────────────────────────────
//
// `Coven Pr.dc.html`: the rail links to it as "Full PR view" because a
// conversation, a commit list and a unified diff are not sidebar shapes.

const prReader = await readFile(new URL("./github-pr-reader.tsx", import.meta.url), "utf8");

assert.match(
  workbench,
  /const LazyPrReader = dynamic\(/,
  "the reader is dynamic() — it pulls a markdown renderer and a diff highlighter, and the room opens far more often than the full PR view",
);
// A reader with no PR to read would render a permanent error. The affordance
// and the surface are both gated on the session actually having one.
assert.match(
  workbench,
  /\{prFull && prRepo && prNumber != null \? \(/,
  "the reader only mounts when the session has a repo AND a number",
);
assert.match(
  workbench,
  /onOpenFullPr=\{prRepo && prNumber != null \? \(\) => setPrFull\(true\) : undefined\}/,
  "the Full PR view affordance is absent when there is no PR, rather than opening an error",
);
assert.match(
  reviewRail,
  /\{tab === "pr" && onOpenFullPr \?/,
  "the affordance belongs to the PR tab, not the Changes tab",
);
// THE HONESTY RULE. Gate state and the merge verdict come from the shared
// model, which returns `unknown` when GitHub is still computing mergeability
// or reported no checks — and refuses to merge on anything short of a pass.
// A local boolean here would be free to say "clear" when nothing verified it.
assert.match(
  prReader,
  /const gates = prLandingGates\(\{ counts, reviews, mergeable, mergeableState \}\);\s*\n\s*const verdict = prMergeVerdict\(gates\);/,
  "gates and the merge verdict come from the shared model, never a local boolean",
);
// Skipped runs are named, never folded into the passing count — a rollup that
// counts skips as passes is a green wall that means nothing.
assert.match(
  prReader,
  /counts\.neutral \? ` · \$\{counts\.neutral\} skipped` : ""/,
  "skipped checks are reported separately from passes",
);
// Every gate prints its state as a WORD beside the bar.
assert.match(
  prReader,
  /className="pr-reader__gate-state"> — \{gate\.state\}/,
  "gate state is carried by a word, not by the bar's colour alone",
);
// A capped diff and a capped commit list both say so.
assert.match(prReader, /files\.truncated \? \(/, "a truncated diff is disclosed");
assert.match(prReader, /commits\.truncated \? \(/, "a truncated commit list is disclosed");

// ── PR tab (stage pipeline + checks + review + merge) ────────────────────────

const prPanel = await readFile(new URL("./code-session-pr-panel.tsx", import.meta.url), "utf8");

assert.match(
  reviewRail,
  /<LazyPr key=\{row\.id\} row=\{row\} \/>/,
  "Pull request mounts keyed by session id so switching sessions never shows stale PR state",
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
assert.match(
  prPanel,
  /const trustedForActions = hasPr && isTrustedPrAttribution\(pr\?\.attribution\);/,
  "review/merge trust uses an explicit attribution allowlist helper",
);
assert.match(
  prPanel,
  /trustedForActions \? \(\s*<ActionsSection/,
  "review and merge controls render only after the PR is resolved from an authoritative branch attribution",
);
assert.match(
  prPanel,
  /allowResolve=\{trustedForActions\}/,
  "review-thread resolve controls are withheld whenever PR actions are untrusted",
);
assert.match(
  prPanel,
  /detected from the chat transcript[\s\S]*?shown for reference only[\s\S]*?Review and merge actions stay disabled/,
  "the PR tab explains why transcript-derived PRs have destructive actions withheld",
);

// ── Composer + new-session flow ──────────────────────────────────────────────

const composer = await readFile(new URL("./code-composer.tsx", import.meta.url), "utf8");
const newSession = await readFile(new URL("./code-new-session.tsx", import.meta.url), "utf8");
const rail = await readFile(new URL("./code-session-rail.tsx", import.meta.url), "utf8");

assert.match(
  codeView,
  /<SurfaceRail[\s\S]*storageKey="cave:code:sessions-rail"[\s\S]*title="Sessions"[\s\S]*ariaLabel="Coding sessions"/,
  "Code Workshop sessions use the shared persisted left rail",
);
assert.match(
  codeView,
  /\{fitsRail \? \(\s*<SurfaceRail[\s\S]*\) : \(\s*<div[\s\S]*<CodeSessionRail/,
  "the measured layout uses the collapsible rail only when it fits and preserves narrow list-first drill-in",
);
assert.match(
  codeView,
  /\{!selected \? \(\s*<div className="px-2 pt-2">[\s\S]*<CodeSessionPicker[\s\S]*selected=\{null\}/,
  "the narrow list-first landing mounts the shared picker with no selected session so slash search still has an owner after Back",
);
assert.match(
  codeView,
  /const \[queueMode, setQueueMode\] = useState<CodeQueueMode>\("reviewable"\);[\s\S]*const pendingQueueSelectedId = useMemo\(/,
  "CodeView owns the non-persisted reviewable/all mode and one shared precomputed queue",
);
assert.match(
  codeView,
  /<CodeSessionRail[\s\S]*queue=\{queue\}[\s\S]*mode=\{queueMode\}[\s\S]*onModeChange=\{setQueueMode\}/,
  "the rail renders from the shared queue and the room-owned scope toggle",
);
assert.match(
  codeView,
  /<CodeWorkbench[\s\S]*queue=\{queue\}[\s\S]*queueMode=\{queueMode\}[\s\S]*onQueueModeChange=\{setQueueMode\}/,
  "the selected workbench receives the same queue and scope control the rail uses",
);
assert.match(
  rail,
  /const groups = queue\.groups;/,
  "the rail renders the precomputed queue groups instead of regrouping sessions locally",
);
assert.doesNotMatch(
  rail,
  /groupCodeRailSessions/,
  "the rail never re-runs session grouping — queue ownership stays in CodeView",
);
assert.match(
  rail,
  /aria-current=\{selected \? "true" : undefined\}[\s\S]*data-code-session-id=\{row\.id\}/,
  "visible rail row buttons expose the same stable session-id marker the queue shortcuts walk",
);
assert.match(
  rail,
  /aria-label=\{open \? undefined : `Open \$\{title\} in \$\{group\.label\}, \$\{ACTIVITY_A11Y\[activity\]\}`\}/,
  "collapsed session buttons identify the session, project, and activity without relying on color",
);
assert.match(
  rail,
  /<CodeReviewQueueControls[\s\S]*outsideCurrentFilter=\{queue\.outsideCurrentFilter\}/,
  "open rail scope controls surface the outside-filter notice in the shared queue chrome",
);
assert.match(
  rail,
  /onClick=\{\(\) => \{\s*onExpand\?\.\(\);\s*onSelect\(row\.id\);/,
  "collapsed session buttons expand before selection",
);
assert.match(
  rail,
  /const openRailClassName = onExpand \? "py-2" : "overflow-y-auto py-2";/,
  "SurfaceRail-hosted sessions defer scrolling to the shared rail while the narrow standalone list remains scrollable",
);
assert.match(
  rail,
  /open \? openRailClassName : "items-center gap-1"/,
  "the session navigation applies the layout-specific open-state scrolling contract",
);


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
  /fetch\("\/api\/projects\?launchable=1", \{ cache: "no-store" \}\)/,
  "new sessions request only projects whose folders are currently available",
);
assert.match(
  newSession,
  /setProjects\(\[\]\);[\s\S]*setProjectId\(""\);/,
  "opening the modal clears stale project choices until fresh folder validation completes",
);
assert.match(
  newSession,
  /No available project folders\. Update a project folder before starting a session\./,
  "new sessions explain when every registered project folder is unavailable",
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
  /<CodeInspector row=\{row\} onChanged=\{onRefresh\} \/>/,
  "the inspector is a header popover now, and its mutations still re-poll the enriched session list via onRefresh",
);
assert.match(
  codeView,
  /onRefresh=\{onTasksRefresh\}/,
  "code-view threads the workspace's tasks refresh into the workbench",
);

// ── Narrow drill-in (list-first, measured) ───────────────────────────

// When the Room is too narrow to hold the rail beside a usable workbench, the
// rail is the landing screen: no newest-session auto-pick, an explicit Back
// (null) suppresses re-selection, and the rail/workbench swap is driven by the
// Room's OWN measured width. It used to key off the viewport (`md:`), which
// this surface cannot ask about honestly — it renders inside the role-surface
// host beside the sidebar and can sit in a split (cave-k3a9u).
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
assert.doesNotMatch(
  codeView,
  /matchMedia|\bmd:(block|flex|hidden|w-64|border-r)/,
  "the Room decides from its measured box, never a viewport query or md: class",
);
assert.match(
  codeView,
  /const roomWidth = useMeasuredWidth\(roomRef\);/,
  "the Room measures its own width",
);
assert.match(
  codeView,
  /const fitsRail = codeRoomFitsRail\(roomWidth, isMobile\);/,
  "the rail breakpoint comes from the shared layout model, not a literal",
);
// The landing decision is captured once and lives in STATE, not just a ref: a
// ref set inside one effect cannot re-run the auto-pick effect that reads it,
// so the measurement would land and auto-pick would never fire.
assert.match(
  codeView,
  /const \[narrowLanding, setNarrowLanding\] = useState<boolean \| null>\(null\);/,
  "the narrow-landing decision is state so the auto-pick effect re-runs on it",
);
assert.match(
  codeView,
  /if \(narrowLanding !== false\) return;/,
  "auto-pick waits for a decision and is skipped entirely when narrow",
);
assert.match(
  codeView,
  /if \(roomWidth === null && typeof ResizeObserver !== "undefined"\) return;/,
  "the decision waits for a real measurement only when one is actually coming",
);
assert.match(
  codeView,
  /\{fitsRail \? \(\s*<SurfaceRail/,
  "a Room wide enough for both zones uses the collapsible shared sessions rail",
);
assert.match(
  codeView,
  /defaultWidth=\{CODE_ROOM_RAIL_WIDTH_PX\}/,
  "the persisted rail starts at the width used by the measured layout model",
);
assert.match(
  codeView,
  /\$\{selected \? "hidden" : "block w-full"\}/,
  "picking a session hides the rail only while the Room is too narrow for both",
);
assert.match(
  codeView,
  /\$\{selected \|\| fitsRail \? "flex" : "hidden"\}/,
  "the workbench column is hidden on a narrow Room until a session is picked",
);
assert.match(
  codeView,
  /aria-label="Back to sessions"[\s\S]{0,120}onClick=\{\(\) => setSelectedId\(null\)\}/,
  "the narrow Back affordance clears the selection explicitly",
);

// ── Room narrow layout: the split drill-in (cave-k3a9u) ─────────────────────

// THE BUG THIS GUARDS. The Room shipped with
//   @media (max-width: 900px) { .code-room__group { flex-direction: column } }
// which never once applied. `react-resizable-panels` renders its Group with an
// INLINE style whose own keys land after the caller's spread:
//   { height, width, overflow, ...userStyle, display:"flex",
//     flexDirection: orientation === "horizontal" ? "row" : "column", ... }
// Inline beats every class selector, and the library's key beats even a passed
// `style`. So the rule was inert, and at 390px the Room rendered two columns
// whose minimums alone sum to 620px. Orientation is a PROP, never CSS.
const roomCss = await readFile(
  new URL("../styles/globals/surface-code-room.css", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  roomCss,
  /\.code-room__group[^}]*flex-direction/,
  "a CSS flex-direction on the panel group is dead code — the library sets it inline",
);
assert.doesNotMatch(
  roomCss,
  /@media[^{]*max-width:\s*900px/,
  "the 900px stacking query is retired; the workbench decides in JS instead",
);
assert.match(
  workbench,
  /const fitsSplit = codeWorkbenchFitsSplit\(measuredWidth, isMobile\);/,
  "the split/drill-in decision is measured, from the shared layout model",
);
assert.match(
  workbench,
  /useState<CodeWorkbenchStep>\("source"\)/,
  "the narrow workbench lands on the source — this is a reading surface",
);
// The terminal must never unmount across the breakpoint OR across a step:
// remounting it would drop the live PTY attachment and the scrollback with it.
// It keeps ONE slot in the tree, outside the column body entirely, so no
// drill-in branch can take it away.
assert.doesNotMatch(
  workbench,
  /fitsSplit \? \([\s\S]{0,400}<CodeTerminalDrawer[\s\S]{0,600}\) : \([\s\S]{0,400}<CodeTerminalDrawer/,
  "the layouts must not fork into two separate terminal drawers",
);
// Announcing from inside a setState updater is a render-phase setState on the
// live region — React re-invokes updaters while rendering, and it warned
// exactly that ("Cannot update a component while rendering a different
// component") until this moved into an effect.
assert.doesNotMatch(
  workbench,
  /setStep\(\([\s\S]{0,200}announce\(/,
  "the step announcement must not run inside the setState updater",
);
assert.match(
  workbench,
  /announcedStepRef\.current = step;/,
  "the step change is announced from an effect, so routed steps announce too",
);

// A routed diff/file open on a narrow Room has to bring the right column
// forward too, or it silently points a hidden column at the target and looks
// like a no-op.
assert.match(
  workbench,
  /setStep\("review"\);/,
  "a routed diff open drills into Review so the target is actually visible",
);
assert.match(
  workbench,
  /setStep\("source"\);/,
  "a routed file open drills into Source so the target is actually visible",
);
assert.match(
  workbench,
  /const initialTabNeedsMeasuredLayout = initialTab === "files" && measuredWidth === null && typeof ResizeObserver !== "undefined" && !isMobile;/,
  "a file-tab deep link waits for a real narrow/wide layout decision before it is consumed",
);
assert.match(
  workbench,
  /if \(initialTabNeedsMeasuredLayout\) return;[\s\S]*if \(initialTab === "files" && !fitsSplit\) setStep\("files"\);/,
  "a narrow file-tab deep link survives until layout is known, then drills into Files rather than leaving them hidden behind Source",
);
assert.match(
  workbench,
  /if \(event\.defaultPrevented\) return;[\s\S]*const action = codeShortcutForCombo\(keymap, codeComboFromEvent\(event\)\);/,
  "the workbench shortcut handler honors fixed-key owners before consulting the rebindable keymap",
);

// A rail closed to its spine while the room was wide must not survive into the
// narrow Review step: that step would render a 28px sliver with no control to
// recover it. The stored state is left alone so returning to the split
// restores the width you chose. (Same class of bug as the collapsed dock found
// in review on #4418 — every check was green.)
assert.match(
  workbench,
  /open=\{fitsSplit \? panels\.reviewOpen : true\}/,
  "the narrow Review step always renders an open rail, so it can never be a blank sliver",
);
assert.match(
  workbench,
  /onOpenChange=\{fitsSplit \? onReviewOpenChange : \(\) => setStep\("source"\)\}/,
  "closing the rail on a narrow room steps back to the source rather than leaving nothing",
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
assert.match(chatSurface, /hideThreadRail = false/, "ChatSurface's docked thread rail is driven only by hideThreadRail");
assert.match(chatSurface, /\{\s*id:\s*"projects",\s*label:\s*"Projects"\s*\}/, "Chat keeps Projects as its second primary tab");
// The Code room and its rail swap are retired (cave-fh9so): one sidebar always,
// with the chat surface docking its own threads rail beside the conversation.
assert.match(
  workspace,
  /const contextualNav = sidebar;/,
  "the shell receives one sidebar, with no section-driven swap",
)
assert.match(workspace, /nav=\{contextualNav\}\s*list=\{undefined\}/, "workspace mounts the contextual Chat nav without an independent list pane");
assert.doesNotMatch(chatRouter, /surface\?:|surface=\{surface\}/, "ChatRouter must not forward a surface prop");
assert.doesNotMatch(chatView, /surface\?:|surface === "code"|Ask for follow-up changes/, "ChatView must not carry Code-specific composer copy this phase");

console.log("code-surface-mode.test.ts: ok");
