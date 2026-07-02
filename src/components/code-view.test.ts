// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Unified Code workspace (mode "code"): a familiar chat beside the comux coding
// surface (tree + editable preview + terminal + search) in one resizable split.

const codeView = await readFile(new URL("./code-view.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const codeSidebar = await readFile(new URL("./code-sidebar.tsx", import.meta.url), "utf8");
const comux = await readFile(new URL("./comux-view.tsx", import.meta.url), "utf8");
const modeType = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const preset = await readFile(new URL("../lib/code-layout-preset.ts", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
// The Code/Changes segmented toggle now rides on the chat surface's
// Sessions/Memory tab row, in a self-contained toolbar.
const toolbar = await readFile(new URL("./code-inline-toolbar.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./shell.tsx", import.meta.url), "utf8");

// ── CodeView is the Codex 3-column shell — Files · Chat · Changes ────────────
// Three columns side by side: the file-tree explorer (left), the familiar
// conversation (center), and the working tree (right — file preview + a Files/
// Changes toggle to the git diff). ComuxView owns the three-column layout so the
// tree and the diff sit on opposite sides of the chat from ONE comux instance (no
// duplicated state); CodeView feeds the conversation in as comux's centerSlot.
// Every pane stays mounted so chat/terminals/preview/diff keep their state.
assert.match(
  codeView,
  /cloneElement\([\s\S]*?\{ centerSlot: chat \}/,
  "CodeView injects the conversation as comux's centerSlot (comux owns the columns)",
);
assert.match(codeView, /data-code-layout="codex"/, "Code mode advertises the Codex-like layout for scoped styling");
assert.match(codeView, /className="cave-code-page cave-code-page--codex/, "Code mode owns a full-page Codex layout shell");
assert.match(globals, /\.cave-code-page\s*\{[\s\S]*?background:[\s\S]*?\.cave-code-page__env/, "Code page shell defines the Codex-like chrome");
assert.match(globals, /@media \(max-width: 1023px\)[\s\S]*?\.cave-code-page/, "Code page chrome has a mobile/narrow override");
// No resizable split, no tabbed pane: a plain side-by-side column layout.
assert.doesNotMatch(codeView, /orientation="horizontal"/, "no resizable Group drives the layout");
assert.doesNotMatch(codeView, /usePanelRef|panelRef=\{chatPanelRef\}|CODE_PRESET_CHAT_SIZE/, "no chat-panel resize logic remains");

// ── comux lays out the three columns: tree · chat (centerSlot) · preview/Changes ─
assert.match(comux, /centerSlot\?: ReactNode/, "ComuxView accepts a centerSlot (the conversation)");
assert.match(
  comux,
  /\{centerSlot \? \([\s\S]*?comux-center-column[\s\S]*?\{centerSlot\}/,
  "the conversation renders as the center column between the tree and the preview/Changes column",
);

// ── Code / Changes segmented toggle drives comux's right column ──────────────
// The two toggle buttons live on the chat surface's header row
// (CodeInlineToolbar) and broadcast CODE_PRESET_EVENT; comux switches its
// preview/Changes column and column weighting to match.
assert.match(toolbar, /writeCodePreset\(next\)/, "selecting a preset persists the chip");
assert.match(toolbar, /CODE_PRESETS\.map\(/, "the toolbar renders a chip per preset");
// The toolbar is mounted on the Code surface's header row + carries the panel
// toggle. The standalone chat has no header row at all now (the old Chat/Code
// toggle was removed), so the whole header is gated behind `isCodeSurface`.
assert.match(chatSurface, /isCodeSurface \? \([\s\S]*?<CodeInlineToolbar \/>/, "the Code header row hosts the inline toolbar");

// ── Code mode owns project/thread nav in the primary sidebar ─────────────────
// The app shell swaps the far-left application menu for CodeSidebar when
// mode === "code"; comux keeps file/search/diff concerns and hides its internal
// project/session navigator in that mode.
assert.match(workspace, /import \{ CodeSidebar \}/, "Workspace imports the CodeSidebar");
assert.match(
  workspace,
  /const codeSidebar = \([\s\S]*?<CodeSidebar[\s\S]*?onBack=\{exitCodeMode\}/,
  "Workspace builds a CodeSidebar with a back action",
);
assert.match(
  workspace,
  /nav=\{mode === "code" \? codeSidebar : mode === "chat" \? chatSidebar : sidebar\}/,
  "Code mode replaces the primary nav slot instead of supplementing it (chat mode swaps in its own ChatSidebar)",
);
assert.match(
  workspace,
  /const \[lastNonCodeMode, setLastNonCodeMode\] = useState<WorkspaceMode>\("home"\)/,
  "Workspace tracks the previous non-Code surface for Back",
);
assert.match(
  workspace,
  /const exitCodeMode = useCallback\(\(\) => \{[\s\S]*?setMode\(lastNonCodeMode === "code" \? "home" : lastNonCodeMode\)/,
  "Back exits Code to the previous non-Code surface with Home fallback",
);
assert.match(
  codeSidebar,
  /export function CodeSidebar/,
  "CodeSidebar is a dedicated component",
);
assert.match(codeSidebar, /aria-label="Back to previous surface"/, "CodeSidebar exposes the Back control");
assert.match(codeSidebar, /aria-label="Code projects and threads"/, "CodeSidebar names its project/thread navigator");
assert.match(codeSidebar, /cave:code-select-project/, "CodeSidebar announces project selection to the Code surface");
assert.match(codeSidebar, /onOpenSession\(session\)/, "CodeSidebar opens thread rows through the workspace/session bridge");
assert.match(
  codeSidebar,
  /aria-label=\{`Delete thread \$\{title\}`\}[\s\S]{0,520}?<Icon name="ph:x-bold"/,
  "CodeSidebar exposes an inline close-button delete affordance on thread rows",
);
// Codex sidebar: PR/branch threads get a distinct leading glyph.
assert.match(codeSidebar, /ph:git-pull-request|ph:git-branch/, "thread rows show a PR/branch glyph for PR-like titles");
assert.match(codeSidebar, /useSessionPins|toggleSessionPin/, "sidebar reads/writes session pins");
assert.match(codeSidebar, /Pinned/, "sidebar renders a Pinned section header");
assert.match(codeSidebar, /Show more|showAll|THREADS_PREVIEW/, "long thread lists collapse behind Show more");
assert.match(codeSidebar, /New chat/, "sidebar nav has New chat");
assert.match(codeSidebar, /cave:navigate-mode/, "sidebar deep-links to other surfaces via the nav bus");
assert.match(codeSidebar, /mode:\s*"inbox"/, "Scheduled deep-links to Automations (inbox mode)");
assert.match(codeSidebar, /mode:\s*"marketplace"/, "Plugins deep-links to the Marketplace surface (its own mode after #2154)");
assert.match(codeSidebar, /code-sidebar__footer|code-sidebar__user/, "sidebar has a user footer");
assert.match(
  workspace,
  /onDeleteSession=\{async \(session\) => \{[\s\S]*?fetch\(`\/api\/chat\/conversation\/\$\{encodeURIComponent\(session\.id\)\}`,[\s\S]*?method: "DELETE"[\s\S]*?loadSessions\(\)/,
  "Workspace wires CodeSidebar thread delete through the authoritative conversation DELETE route and refreshes sessions",
);
assert.match(
  workspace,
  /<ComuxView[\s\S]*?view="projects"[\s\S]*?hideProjectNavigator/,
  "Code-mode ComuxView hides duplicate project/thread navigation",
);
assert.match(
  workspace,
  /const \[codeRightView, setCodeRightView\] = useState<"files" \| "changes">\("files"\)/,
  "Workspace owns the Code surface's right-pane selection",
);
assert.match(
  workspace,
  /<ComuxView[\s\S]*?view="projects"[\s\S]*?rightView=\{codeRightView\}[\s\S]*?onRightViewChange=\{setCodeRightView\}/,
  "Code-mode ComuxView is controlled so its duplicate Files/Changes toggle stays hidden",
);
assert.match(comux, /hideProjectNavigator\?: boolean/, "ComuxView accepts hideProjectNavigator");
assert.match(comux, /if \(hideProjectNavigator\) return;/, "Comux project-list shortcuts are disabled when hidden");
assert.match(comux, /cave:code-select-project/, "Comux listens for CodeSidebar project selection");
assert.match(
  comux,
  /\{!hideProjectNavigator && \([\s\S]*?Projects — merged into this column/,
  "Comux wraps the project switcher in the hideProjectNavigator guard",
);
assert.match(
  comux,
  /\{!hideProjectNavigator && \([\s\S]*?Recent sessions/,
  "Comux wraps duplicate recent sessions in the hideProjectNavigator guard",
);
// Code surface drops the whole left file-tree explorer column (#removed): the
// surface is chat + preview/Changes only. The Library projects browser keeps it.
assert.match(
  workspace,
  /<ComuxView[\s\S]*?view="projects"[\s\S]*?hideFileTree/,
  "Code-mode ComuxView removes the left file-tree explorer column",
);
assert.match(comux, /hideFileTree\?: boolean/, "ComuxView accepts hideFileTree");
assert.match(
  comux,
  /\{!hideFileTree && !\(isControlledRightView && rightView === "changes"\) && \(projectDetailCollapsed \? \(/,
  "Comux gates the entire file-tree column behind hideFileTree",
);
assert.doesNotMatch(codeView, /toggleProjects|aria-label=\{?"?(Hide|Show) projects/i, "the collapse toggle is not in the Code toolbar anymore");
// Right-click a project row → a context menu with cwd-scoped actions. The row
// is an extracted SortableProjectRow; the wiring lives in the onRowContextMenu
// callback passed to it.
assert.match(comux, /onRowContextMenu=\{\(p, e\) => \{[\s\S]*?setProjectMenuTarget\(p\);[\s\S]*?openContextMenuAt\(setProjectMenu\)\(e\);/, "project rows open a context menu at the cursor, recording which project");
assert.match(comux, /onContextMenu=\{\(e\) => onRowContextMenu\(project, e\)\}/, "the sortable row forwards right-clicks to the menu");
assert.match(comux, /ariaLabel=\{projectMenuTarget \? `Actions for \$\{projectMenuTarget\.name\}`/, "the project context menu is labelled per project");
assert.match(comux, /onNewChat\(projectMenuTarget\.root\)/, "menu can start a chat in the project cwd");
assert.match(comux, /addSession\(projectMenuTarget\.root\)/, "menu can open a terminal in the project cwd");
assert.match(comux, /copyText\(projectMenuTarget\.root\)/, "menu can copy the project path");
// Pin to top + drag-to-reorder.
assert.match(comux, /toggleProjectPinned\(root\)/, "menu can pin/unpin a project");
assert.match(comux, /isProjectPinned\(pinnedProjects, projectMenuTarget\.root\) \? "Unpin" : "Pin to top"/, "the pin item toggles its label");
assert.match(comux, /onDragEnd=\{handleProjectDragEnd\}/, "the project list is a drag-to-reorder sortable context");
assert.match(comux, /const next = arrayMove\(ids, from, to\)[\s\S]*?writeProjectOrder\(next\)/, "a drop persists the new project order");
assert.match(comux, /<SortableProjectRow/, "rows render via the sortable row component");
assert.match(comux, /Projects — merged into this column/, "the projects list is merged into the file-explorer column");
assert.match(comux, /\{!projectListCollapsed && \(/, "comux hides the projects list when collapsed");
assert.match(
  comux,
  /const setProjectListVisible = useCallback\([\s\S]*?writeProjectListCollapsed\(!visible\)/,
  "toggling visibility persists so a reload remembers it",
);
assert.doesNotMatch(
  codeView,
  /\.collapse\(\)|collapsedSize|collapsible/,
  "the code/comux Panel is never collapsed — only the projects list is",
);

// Presets are task setups, not just labels: each broadcasts a context preset
// and Comux applies the matching right pane.
assert.match(
  toolbar,
  /new CustomEvent\(CODE_PRESET_EVENT, \{ detail: \{ preset: next \} \}\)/,
  "selecting a preset broadcasts the context preset",
);

// ── comux reacts: switches the right pane per preset ─────────────────────────
assert.match(comux, /addEventListener\(CODE_PRESET_EVENT/, "comux listens for the layout preset");
assert.match(
  comux,
  /CODE_PRESET_RIGHT_VIEW\[preset\][\s\S]*?setRightView\(nextRight\)/,
  "a preset switches comux's right pane (Code → Files, Changes → Changes)",
);

// ── ComuxView accepts a storage namespace so Code-mode terminals are isolated ─
assert.match(comux, /storageNamespace\?: string/, "ComuxView accepts a storageNamespace prop");
assert.match(
  comux,
  /const layoutKey = STORAGE_LAYOUT \+ storageNamespace;[\s\S]*?const sessionsKey = STORAGE_SESSIONS \+ storageNamespace;/,
  "ComuxView namespaces its persisted layout/session keys",
);
// The cave:terminal-open listener is active-gated so two mounted instances
// don't both spawn a session.
assert.match(comux, /if \(view !== "terminal" \|\| !active\) return;/, "terminal-open handler is gated on active");

// ── workspace wires the "code" mode ──────────────────────────────────────────
assert.match(modeType, /\|\s*"code"/, "WorkspaceMode includes 'code'");
assert.match(workspace, /code: "Code",/, "mode title registered");
assert.match(
  workspace,
  /mode === "code" \? \([\s\S]*?<CodeView[\s\S]*?storageNamespace=":code"/,
  "mode 'code' renders CodeView with a namespaced ComuxView",
);
assert.match(
  workspace,
  /mode === "code" \? \([\s\S]*?<ChatSurface[\s\S]*surface="code"/,
  "Code mode should continue to embed ChatSurface instead of forking chat controls",
);
assert.doesNotMatch(
  codeView,
  /streamFamiliarText|\/api\/chat\/send/,
  "CodeView should not own a separate chat send path",
);
// The Code workspace must mount the comux PROJECTS view (file tree + editable
// preview + project search + Files/Changes), not the terminal-only view — that
// is where the coding surfaces live.
assert.match(
  workspace,
  /mode === "code" \? \([\s\S]*?<ComuxView\s+view="projects"[\s\S]*?storageNamespace=":code"/,
  "the Code workspace comux uses the projects view (coding surfaces), not terminal-only",
);
// Code is the 7th sidebar surface (⌘7), reached via the SURFACE_ORDER lookup.
assert.match(
  workspace,
  /const SURFACE_ORDER: WorkspaceMode\[\] = \[[\s\S]*?"terminal", "code",/,
  "Cmd/Ctrl+7 switches to the Code workspace (last entry in SURFACE_ORDER)",
);

// ── sidebar exposes a Code entry (⌘7) ────────────────────────────────────────
assert.match(
  sidebar,
  /id: "code", label: "Code"[\s\S]*?kbd: "⌘7"/,
  "sidebar has a Code nav entry bound to ⌘7",
);

// ── Collapsed nav rail shows a "Sessions" label, not a bare clipped icon ─────
// When the Code surface's nav panel collapses to the 56px rail, the CodeSidebar
// renders a vertical "Sessions" label (mirrors the comux Details/Preview rails)
// that reopens the panel on click via the symmetric cave:toggle-left-panel hook.
assert.match(codeSidebar, /className="code-sidebar__rail focus-ring"/, "CodeSidebar renders a collapsed rail control");
assert.match(codeSidebar, /aria-label="Expand sessions"/, "the collapsed rail is an accessible expand affordance");
assert.match(
  codeSidebar,
  /new CustomEvent\("cave:toggle-left-panel"\)/,
  "the collapsed rail reopens the nav panel via the cave:toggle-left-panel event",
);
assert.match(
  codeSidebar,
  /<span className="code-sidebar__rail-label">Sessions<\/span>/,
  "the collapsed rail shows a 'Sessions' label instead of a bare icon",
);
assert.match(codeSidebar, /className="code-sidebar__full/, "the full sidebar is wrapped so CSS can hide it when collapsed");
// Shell honours the symmetric left-panel toggle event (mirror of the right one).
assert.match(
  shell,
  /window\.addEventListener\("cave:toggle-left-panel", onToggleLeft\)/,
  "the shell listens for cave:toggle-left-panel to reopen the nav panel",
);
assert.match(
  shell,
  /const onToggleLeft = \(\) => \{[\s\S]*?togglePanel\(navRef\.current\)/,
  "cave:toggle-left-panel toggles the nav panel (desktop)",
);
// CSS hides the full sidebar and shows the rotated label only in the collapsed rail.
assert.match(globals, /\.shell-nav--rail \.code-sidebar__full \{\s*display: none;/, "collapsed rail hides the full sidebar");
assert.match(globals, /\.shell-nav--rail \.code-sidebar__rail \{[\s\S]*?display: flex;/, "collapsed rail shows the Sessions control");
assert.match(globals, /\.code-sidebar__rail-label \{[\s\S]*?writing-mode: vertical-rl;/, "the Sessions rail label reads vertically");

console.log("code-view.test.ts: ok");
