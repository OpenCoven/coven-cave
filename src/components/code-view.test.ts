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
// The Chat/Split/Review presets + companion-panel toggle now ride on the chat
// surface's Sessions/Memory tab row, in a self-contained toolbar.
const toolbar = await readFile(new URL("./code-inline-toolbar.tsx", import.meta.url), "utf8");
const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");

// ── CodeView is a two-pane resizable shell, chat | comux ─────────────────────
assert.match(codeView, /orientation="horizontal"/, "CodeView lays the panes out horizontally");
assert.match(codeView, /id="code-chat"[\s\S]*?\{chat\}/, "the left pane renders the chat slot");
assert.match(codeView, /id="code-comux"[\s\S]*?\{comux\}/, "the right pane renders the comux slot");
// Its own persisted layout key, independent of chat/shell.
assert.match(codeView, /CODE_GROUP_ID = "cave\.code\.widths\.v1"/, "CodeView persists under its own storage key");
// Mobile: a Chat / Code segmented switcher swaps which pane is full-screen
// (a horizontal split is unusable on a phone); both panes stay mounted so
// their state survives tab taps.
assert.match(codeView, /if \(isMobile\) \{/, "mobile gets a dedicated layout branch");
assert.match(codeView, /onChange=\{setMobileTab\}/, "mobile has a Chat/Code tab switcher via shared Tabs");
assert.match(
  codeView,
  /mobileTab === "chat" \? "flex" : "hidden"[\s\S]*?mobileTab === "code" \? "flex" : "hidden"/,
  "the inactive mobile pane is hidden (not unmounted) so state persists",
);
// Desktop keeps the two-pane resizable split under its own key.
assert.match(codeView, /panelIds: \["code-chat", "code-comux"\]/, "desktop mounts both panels in the split");

// ── Layout presets (Chat / Split / Review) re-weight the desktop split ───────
// The preset chips live on the chat surface's tab row (CodeInlineToolbar) and
// broadcast CODE_PRESET_EVENT; code-view owns the chat-panel resize via a
// listener — no remount, so the comux terminals/preview keep their state. The
// chip selection persists under its own key; pane sizes persist under CODE_GROUP_ID.
assert.match(codeView, /usePanelRef/, "desktop uses a panel ref to drive presets");
assert.match(codeView, /panelRef=\{chatPanelRef\}/, "the chat panel takes the preset handle via panelRef");
assert.match(codeView, /addEventListener\(CODE_PRESET_EVENT/, "code-view listens for the preset broadcast");
assert.match(codeView, /chatPanelRef\.current\?\.resize\(CODE_PRESET_CHAT_SIZE\[/, "presets resize the chat panel (comux fills the rest)");
assert.match(toolbar, /writeCodePreset\(next\)/, "selecting a preset persists the chip");
assert.match(
  codeView,
  /codeStorage\.getItem\(CODE_GROUP_ID\) == null/,
  "the stored preset is applied only when no dragged layout exists (no clobbering manual drags)",
);
assert.match(toolbar, /CODE_PRESETS\.map\(/, "the toolbar renders a chip per preset");
// The toolbar is mounted on the Code surface's tab row + carries the panel toggle.
assert.match(chatSurface, /isCodeSurface \? <CodeInlineToolbar \/> : null/, "the Code tab row hosts the inline toolbar");
assert.match(toolbar, /code-panel-toggle/, "the toolbar includes the companion-panel toggle");
assert.match(toolbar, /cave:toggle-right-panel/, "the panel toggle asks the shell to toggle the companion panel");

// ── The projects list is merged into the file-explorer column (in comux) ──────
// It's a collapsible "Projects" section above the file tree, sharing one column
// with it (no separate 200px column / rail). The Code toolbar no longer carries
// the toggle; it drives the section's collapse via projectListCollapsed.
assert.doesNotMatch(codeView, /toggleProjects|aria-label=\{?"?(Hide|Show) projects/i, "the collapse toggle is not in the Code toolbar anymore");
assert.match(comux, /onClick=\{\(\) => setProjectListVisible\(projectListCollapsed\)\}/, "the merged Projects section header toggles its own collapse");
assert.match(comux, /comux-project-row/, "the projects list renders project rows in the explorer column");
// Right-click a project row → a context menu with cwd-scoped actions.
assert.match(comux, /onContextMenu=\{\(e\) => \{[\s\S]*?setProjectMenuTarget\(project\);[\s\S]*?openContextMenuAt\(setProjectMenu\)\(e\);/, "project rows open a context menu at the cursor, recording which project");
assert.match(comux, /ariaLabel=\{projectMenuTarget \? `Actions for \$\{projectMenuTarget\.name\}`/, "the project context menu is labelled per project");
assert.match(comux, /onNewChat\(projectMenuTarget\.root\)/, "menu can start a chat in the project cwd");
assert.match(comux, /addSession\(projectMenuTarget\.root\)/, "menu can open a terminal in the project cwd");
assert.match(comux, /copyText\(projectMenuTarget\.root\)/, "menu can copy the project path");
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
