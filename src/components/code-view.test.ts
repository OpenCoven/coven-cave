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
assert.match(codeView, /setMobileTab\("chat"\)|onClick=\{\(\) => setMobileTab\(tab\)\}/, "mobile has a Chat/Code tab switcher");
assert.match(
  codeView,
  /mobileTab === "chat" \? "flex" : "hidden"[\s\S]*?mobileTab === "code" \? "flex" : "hidden"/,
  "the inactive mobile pane is hidden (not unmounted) so state persists",
);
// Desktop keeps the two-pane resizable split under its own key.
assert.match(codeView, /panelIds: \["code-chat", "code-comux"\]/, "desktop mounts both panels in the split");

// ── Layout presets (Chat / Split / Review) re-weight the desktop split ───────
// A preset toolbar resizes the chat panel imperatively (usePanelRef) — no
// remount, so the comux terminals/preview keep their state. The chip selection
// persists under its own key; pane sizes persist under CODE_GROUP_ID.
assert.match(codeView, /usePanelRef/, "desktop uses a panel ref to drive presets");
assert.match(codeView, /panelRef=\{chatPanelRef\}/, "the chat panel takes the preset handle via panelRef");
assert.match(codeView, /chatPanelRef\.current\?\.resize\(CODE_PRESET_CHAT_SIZE\[/, "presets resize the chat panel (comux fills the rest)");
assert.match(codeView, /writeCodePreset\(next\)/, "selecting a preset persists the chip");
assert.match(
  codeView,
  /codeStorage\.getItem\(CODE_GROUP_ID\) == null/,
  "the stored preset is applied only when no dragged layout exists (no clobbering manual drags)",
);
assert.match(codeView, /CODE_PRESETS\.map\(/, "the toolbar renders a chip per preset");

// ── Projects toggle collapses ONLY the projects list (not the whole code pane) ─
// The toolbar's Projects button drives the comux projects-list column over a
// window event; it must NOT collapse the code/comux Panel itself.
assert.match(codeView, /onClick=\{toggleProjects\}/, "the toolbar has a Projects toggle");
assert.match(
  codeView,
  /const toggleProjects = \(\) => setProjectList\(!projectsCollapsed\)/,
  "the toggle flips the projects-list collapse, nothing else",
);
assert.match(
  codeView,
  /new CustomEvent\(CODE_PROJECT_LIST_EVENT, \{ detail: \{ collapsed \} \}\)/,
  "collapse is broadcast to comux over CODE_PROJECT_LIST_EVENT",
);
assert.doesNotMatch(
  codeView,
  /\.collapse\(\)|collapsedSize|collapsible/,
  "the code/comux Panel is never collapsed — only the projects list is",
);

// Presets are task setups, not just widths: each broadcasts a context preset
// and toggles the projects list (Chat focuses the conversation).
assert.match(
  codeView,
  /new CustomEvent\(CODE_PRESET_EVENT, \{ detail: \{ preset: next \} \}\)/,
  "selecting a preset broadcasts the context preset",
);
assert.match(
  codeView,
  /setProjectList\(CODE_PRESET_HIDES_PROJECT_LIST\[next\]\)/,
  "a preset shows/hides the projects list per its definition",
);

// ── comux reacts: hides the projects list + switches the right pane per preset ─
assert.match(comux, /projectListCollapsed \? null : \(/, "comux hides the projects list column when collapsed");
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
assert.match(
  workspace,
  /e\.key === "0"\) \{[\s\S]*?setMode\("code"\)/,
  "Cmd/Ctrl+0 switches to the Code workspace",
);

// ── sidebar exposes a Code entry (⌘0) ────────────────────────────────────────
assert.match(
  sidebar,
  /id: "code", label: "Code"[\s\S]*?kbd: "⌘0"/,
  "sidebar has a Code nav entry bound to ⌘0",
);

console.log("code-view.test.ts: ok");
