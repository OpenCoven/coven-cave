// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Unified Code workspace (mode "code"): a familiar chat beside the comux coding
// surface (tree + editable preview + terminal + search) in one resizable split.

const codeView = await readFile(new URL("./code-view.tsx", import.meta.url), "utf8");
const workspace = await readFile(new URL("./workspace.tsx", import.meta.url), "utf8");
const sidebar = await readFile(new URL("./sidebar-minimal.tsx", import.meta.url), "utf8");
const comux = await readFile(new URL("./comux-view.tsx", import.meta.url), "utf8");
const modeType = await readFile(new URL("../lib/workspace-mode.ts", import.meta.url), "utf8");
const preset = await readFile(new URL("../lib/code-layout-preset.ts", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
// The Chat/Split/Review presets + companion-panel toggle now ride on the chat
// surface's Sessions/Memory tab row, in a self-contained toolbar.
const toolbar = await readFile(new URL("./code-inline-toolbar.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");

// ── CodeView is a single tabbed surface — Chat · Files · Changes ─────────────
// One tab fills the surface at a time (Codex-style, no side-by-side split). All
// three panes stay mounted (hidden, not unmounted) so chat/terminals/preview/
// diff keep their state across tab taps.
assert.match(codeView, /type CodeTab = "chat" \| "files" \| "changes"/, "CodeView models the three tabs");
assert.match(codeView, /<Tabs[\s\S]*?ariaLabel="Code view"[\s\S]*?value=\{tab\}/, "a shared Tabs control switches Chat/Files/Changes");
assert.match(codeView, /id: "chat"[\s\S]*?id: "files"[\s\S]*?id: "changes"/, "the tab bar lists chat, files and changes");
assert.match(codeView, /cave-code-page__pane--chat[\s\S]*?tab === "chat" \? "flex" : "hidden"/, "the chat pane shows only on the Chat tab (hidden, not unmounted)");
assert.match(codeView, /cave-code-page__pane--workspace[\s\S]*?tab !== "chat" \? "flex" : "hidden"/, "the comux pane backs both the Files and Changes tabs");
assert.match(codeView, /\{chat\}/, "the chat pane renders the chat slot");
// Files and Changes are two faces of ONE comux instance: it's cloned with a
// controlled rightView tied to the active tab, so toggling Files↔Changes never
// remounts the terminals or preview. comux routes its own diff-first / file-open
// switches back through onRightViewChange to select the matching tab.
assert.match(
  codeView,
  /cloneElement\([\s\S]*?rightView: tab === "changes" \? "changes" : "files",[\s\S]*?onRightViewChange,/,
  "comux is cloned with a controlled rightView bound to the active tab",
);
assert.match(
  codeView,
  /const onRightViewChange = useCallback\(\(next: "files" \| "changes"\) => setTab\(next\)/,
  "comux's own view switches (file-open, diff-first) select the matching tab",
);
assert.match(codeView, /data-code-layout="codex"/, "Code mode advertises the Codex-like layout for scoped styling");
assert.match(codeView, /className="cave-code-page/, "Code mode owns a full-page layout shell");
assert.match(codeView, /cave-code-page__pane cave-code-page__pane--chat/, "chat pane keeps the conversation-column wrapper");
assert.match(codeView, /cave-code-page__pane cave-code-page__pane--workspace/, "comux pane keeps the main workspace wrapper");
assert.match(globals, /\.cave-code-page\s*\{[\s\S]*?background:[\s\S]*?\.cave-code-page__pane--workspace/, "Code page shell defines the Codex-like chrome");
assert.match(globals, /@media \(max-width: 1023px\)[\s\S]*?\.cave-code-page/, "Code page chrome has a mobile/narrow override");
// The side-by-side split is gone: no resizable Group/Panel, no panel-resize presets.
assert.doesNotMatch(codeView, /orientation="horizontal"/, "the resizable split is replaced by tabs");
assert.doesNotMatch(codeView, /usePanelRef|panelRef=\{chatPanelRef\}|CODE_PRESET_CHAT_SIZE/, "no chat-panel resize logic remains");

// ── Layout presets (Chat / Split / Review) map onto the tabs ─────────────────
// The preset chips live on the chat surface's tab row (CodeInlineToolbar) and
// broadcast CODE_PRESET_EVENT; CodeView maps Chat→Chat, Split→Files, Review→Changes.
assert.match(codeView, /addEventListener\(CODE_PRESET_EVENT/, "CodeView listens for the preset broadcast");
assert.match(
  codeView,
  /preset === "chat" \? "chat" : preset === "review" \? "changes" : "files"/,
  "each preset selects its matching tab",
);
assert.match(toolbar, /writeCodePreset\(next\)/, "selecting a preset persists the chip");
assert.match(toolbar, /CODE_PRESETS\.map\(/, "the toolbar renders a chip per preset");
// The toolbar is mounted on the Code surface's tab row + carries the panel toggle.
// (Standalone chat shows the Power-mode toggle on that row instead of null.)
assert.match(chatSurface, /isCodeSurface \? \(\s*<CodeInlineToolbar \/>\s*\) : \(/, "the Code tab row hosts the inline toolbar");
assert.match(toolbar, /code-panel-toggle/, "the toolbar includes the companion-panel toggle");
assert.match(toolbar, /cave:toggle-right-panel/, "the panel toggle asks the shell to toggle the companion panel");

// ── The projects list is merged into the file-explorer column (in comux) ──────
// It's a collapsible "Projects" section above the file tree, sharing one column
// with it (no separate 200px column / rail). The Code toolbar no longer carries
// the toggle; it drives the section's collapse via projectListCollapsed.
assert.doesNotMatch(codeView, /toggleProjects|aria-label=\{?"?(Hide|Show) projects/i, "the collapse toggle is not in the Code toolbar anymore");
assert.match(comux, /onClick=\{\(\) => setProjectListVisible\(projectListCollapsed\)\}/, "the merged Projects section header toggles its own collapse");
assert.match(comux, /comux-project-row/, "the projects list renders project rows in the explorer column");
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

// Presets are task setups, not just widths: each broadcasts a context preset
// and shows/hides the projects list (Chat focuses the conversation).
assert.match(
  toolbar,
  /new CustomEvent\(CODE_PRESET_EVENT, \{ detail: \{ preset: next \} \}\)/,
  "selecting a preset broadcasts the context preset",
);
assert.match(
  toolbar,
  /new CustomEvent\(CODE_PROJECT_LIST_EVENT, \{ detail: \{ collapsed \} \}\)/,
  "a preset shows/hides the projects list over CODE_PROJECT_LIST_EVENT",
);
assert.match(
  toolbar,
  /CODE_PRESET_HIDES_PROJECT_LIST\[next\]/,
  "the preset's list visibility comes from its definition",
);

// ── comux reacts: hides the projects list + switches the right pane per preset ─
assert.match(comux, /addEventListener\(CODE_PROJECT_LIST_EVENT/, "comux listens for the projects-list toggle");
assert.match(comux, /addEventListener\(CODE_PRESET_EVENT/, "comux listens for the layout preset");
assert.match(
  comux,
  /CODE_PRESET_RIGHT_VIEW\[preset\][\s\S]*?setRightView\(nextRight\)/,
  "a preset switches comux's right pane (Review → Changes, Split → Files)",
);

// The Review preset must target the git diff, and Split the files view —
// otherwise the chips are just width tweaks.
assert.match(preset, /review: "changes"/, "Review opens the git changes/diff");
assert.match(preset, /split: "files"/, "Split shows the file tree & preview");

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
// The Code workspace must mount the comux PROJECTS view (file tree + editable
// preview + project search + Files/Changes), not the terminal-only view — that
// is where the coding surfaces live.
assert.match(
  workspace,
  /mode === "code" \? \([\s\S]*?<ComuxView\s+view="projects"[\s\S]*?storageNamespace=":code"/,
  "the Code workspace comux uses the projects view (coding surfaces), not terminal-only",
);
// Code is the 8th sidebar surface (⌘8), reached via the SURFACE_ORDER lookup.
assert.match(
  workspace,
  /const SURFACE_ORDER: WorkspaceMode\[\] = \[[\s\S]*?"terminal", "code",/,
  "Cmd/Ctrl+8 switches to the Code workspace (last entry in SURFACE_ORDER)",
);

// ── sidebar exposes a Code entry (⌘8) ────────────────────────────────────────
assert.match(
  sidebar,
  /id: "code", label: "Code"[\s\S]*?kbd: "⌘8"/,
  "sidebar has a Code nav entry bound to ⌘8",
);

console.log("code-view.test.ts: ok");
