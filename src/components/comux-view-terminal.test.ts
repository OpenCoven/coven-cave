// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./comux-view.tsx", import.meta.url),
  "utf8",
);
const workspace = readFileSync(
  new URL("./workspace.tsx", import.meta.url),
  "utf8",
);
const globals = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

// Keyboard hint footer (matches the inbox/calendar/library/home/browser pattern).
assert.match(
  source,
  /⌘N new · ⌘W close · drag tabs or pane bars onto pane edges to split &amp; reorganize · drag dividers to resize/,
  "renders the keyboard hint footer below the terminal area",
);

// `+` tab-add button is labeled for screen readers and has a tooltip.
assert.match(
  source,
  /aria-label="New terminal"/,
  "tab-strip add button has aria-label",
);
assert.match(
  source,
  /title="New terminal \(⌘N\)"/,
  "tab-strip add button has tooltip with shortcut",
);
assert.match(
  source,
  /comux-terminal-tab-strip/,
  "terminal tab strip exposes a stable mobile layout hook",
);
assert.match(
  source,
  /comux-terminal-toolbar-button[\s\S]*Split right[\s\S]*comux-terminal-toolbar-button[\s\S]*Split down[\s\S]*comux-terminal-add-button/,
  "terminal toolbar actions expose stable mobile hit-area hooks",
);

// Empty-state copy + ⌘N kbd hint.
assert.match(
  source,
  /No terminal sessions/,
  "empty state shows heading",
);
assert.match(
  source,
  /Start one to run commands inside the cave\./,
  "empty state shows helper sentence",
);
assert.match(
  source,
  /<kbd[\s\S]{0,200}⌘N[\s\S]{0,20}<\/kbd>/,
  "empty state shows the ⌘N kbd hint",
);
assert.match(
  source,
  /comux-terminal-empty-add/,
  "terminal empty-state add button exposes a stable mobile hit-area hook",
);
assert.match(
  source,
  /const wasActiveTerminalRef = useRef\(false\);[\s\S]*?const activeTerminal = view === "terminal" && active;[\s\S]*?wasActiveTerminalRef\.current = true;[\s\S]*?if \(sessions\.length > 0\) return;[\s\S]*?addSession\(\);/,
  "opening the active Terminal surface should auto-start one terminal session without respawning after in-surface closes",
);

assert.doesNotMatch(source, /cave:terminal-open/, "Comux does not expose a cross-surface terminal launcher");

// ⌘N / ⌘W keydown handler is wired and respects modifier + contentEditable gate.
assert.match(
  source,
  /metaKey\s*\|\|\s*e\.ctrlKey/,
  "keydown handler checks meta or ctrl modifier",
);
assert.match(
  source,
  /target\??\.isContentEditable/,
  "keydown handler skips contentEditable targets",
);
assert.match(
  source,
  /e\.key === "n"[\s\S]{0,80}addSession\(\)/,
  "⌘N triggers addSession",
);
assert.match(
  source,
  /e\.key === "w"[\s\S]{0,120}removeSession\(currentIdx\)/,
  "⌘W triggers removeSession of the current index",
);

assert.doesNotMatch(workspace, /const terminalDetail|view="terminal"|mode === "terminal"/, "Workspace should not create a standalone terminal subtree");
assert.doesNotMatch(
  workspace,
  /<div key=\{mode\} className="cave-mode-fade/,
  "Workspace detail must not force a full remount on every surface switch",
);
// ...but the mode-transition crossfade must STILL fire on every switch. The
// `.cave-mode-fade` CSS animation only plays on the wrapper's initial mount, so
// a mode change replays an opacity-only fade via WAAPI on the *persistent*
// wrapper (no remount, no transform → no containing-block trap; cave-cco).
// This has silently regressed twice (UX-004 added it via key={mode}; the
// terminal-keepalive PR removed the key and killed the switch fade) — pin it.
assert.match(
  workspace,
  /ref=\{detailFadeRef\}/,
  "detail wrapper wires the mode-fade ref so switches can re-fire the fade",
);
assert.match(
  workspace,
  /el\.animate\(\s*\[\{ opacity: 0 \}, \{ opacity: 1 \}\],\s*\{ duration: 120, easing: "ease-out" \}/,
  "a mode switch replays a 120ms opacity-only fade on the detail wrapper",
);
assert.match(
  workspace,
  /prefers-reduced-motion: reduce/,
  "the mode-fade retrigger honors prefers-reduced-motion",
);
assert.match(
  source,
  /active = true[\s\S]*?if \(view !== "terminal" \|\| !active\) return;/,
  "Hidden terminal views should not keep global terminal shortcuts active",
);
assert.match(
  source,
  /active=\{active && isActive\}/,
  "Hidden terminal views should keep PTYs mounted without stealing focus",
);

// Split panes: terminal tabs can be dragged into pane drop zones, and the
// visible terminal layout uses react-resizable-panels so xterm's ResizeObserver
// can propagate pty_resize after handle drags.
assert.match(
  source,
  /import \{ Group, Panel, Separator \} from "react-resizable-panels";/,
  "terminal view imports resizable panel primitives",
);
assert.match(
  source,
  /import \{ SeparatorHandle \} from "@\/components\/ui\/separator-handle";/,
  "terminal view uses the shared resize handle affordance",
);
assert.match(
  source,
  /const TERMINAL_SESSION_DRAG_TYPE = "application\/x-cave-terminal-session";/,
  "terminal tabs use a custom drag payload type",
);
assert.match(
  source,
  /draggable[\s\S]*?dataTransfer\.setData\(TERMINAL_SESSION_DRAG_TYPE,\s*s\.id\)/,
  "terminal tabs are draggable and store the session id",
);
assert.match(
  source,
  /type: "reorder"[\s\S]*?sourceSessionId[\s\S]*?targetSessionId/,
  "terminal layout reducer exposes a tab reorder action",
);
assert.match(
  source,
  /className=\{`comux-terminal-tab[\s\S]*?onDragOver=\{\(e\) => \{[\s\S]*?onDrop=\{\(e\) => \{[\s\S]*?type: "reorder"/,
  "terminal tabs accept drops from other tabs and reorder the tab strip",
);
assert.match(
  source,
  /function TerminalDropZone\([\s\S]*?onDrop=\{\(e\) => \{[\s\S]*?onSplit\(dragged,\s*side\);/,
  "terminal panes expose edge drop zones that split with the dragged session",
);
// Drag a pane by its title bar onto another pane's edge to relocate it — the
// same gesture as dragging a tab, reusing the move/drop-zone machinery.
assert.match(
  source,
  /comux-terminal-pane-bar"\s*\n\s*draggable\s*\n\s*data-terminal-pane-handle=\{s\.id\}/,
  "the pane title bar is a drag handle carrying its session id",
);
assert.match(
  source,
  /comux-terminal-pane-bar[\s\S]*?onDragStart=\{[\s\S]*?dataTransfer\.setData\(TERMINAL_SESSION_DRAG_TYPE,\s*s\.id\)/,
  "dragging a pane bar stores the session id so a drop relocates that pane",
);
assert.match(
  source,
  /renderTerminalNode[\s\S]*?<Group[\s\S]{0,220}orientation=\{node\.kind\}[\s\S]*?<Panel[\s\S]*?<Separator[\s\S]*?<SeparatorHandle/,
  "visible terminal panes render a recursive resizable panel tree",
);
assert.match(
  source,
  /data-terminal-resize-handle=\{`\$\{path\}-\$\{paneIdx\}`\}/,
  "terminal resize separators expose stable QA hooks",
);
assert.match(
  source,
  /onSplitTerminal\("horizontal"\)[\s\S]*?Split right/,
  "toolbar exposes a split-right command",
);
assert.match(
  source,
  /onSplitTerminal\("vertical"\)[\s\S]*?Split down/,
  "toolbar exposes a split-down command",
);
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.comux-terminal-tab-strip\s*\{[\s\S]*min-height:\s*calc\(var\(--touch-target\) \+ 8px\)/,
  "mobile terminal tab strip should leave room for touch-sized actions",
);
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.comux-terminal-toolbar-button,[\s\S]*\.comux-terminal-empty-add\s*\{[\s\S]*min-height:\s*var\(--touch-target\)/,
  "mobile terminal toolbar buttons should meet the shared touch target",
);
assert.match(
  globals,
  /@media \(max-width: 767px\) \{[\s\S]*\.comux-terminal-add-button,[\s\S]*\.comux-terminal-tab-close,[\s\S]*\.comux-terminal-pane-action\s*\{[\s\S]*width:\s*var\(--touch-target\)[\s\S]*height:\s*var\(--touch-target\)/,
  "mobile terminal icon and close buttons should meet the shared touch target",
);

// Projects view: the file/navigation side and preview side share the project
// detail area, and each side can collapse into a thin rail.
assert.match(
  source,
  /className="flex min-h-0 flex-1 flex-col xl:flex-row"/,
  "Projects detail should use a flexible split that can swap panes for rails",
);
assert.match(
  source,
  /className="flex min-h-0 min-w-0 flex-col border-b border-\[var\(--border-hairline\)\] xl:flex-1 xl:border-b-0 xl:border-r"[\s\S]*?selectedProject\.name[\s\S]*?ProjectTree/,
  "Projects left half should own the project header and file tree",
);
assert.match(
  source,
  // The file-tree column is wrapped in a `{!(isControlledRightView && rightView === "changes") && (…)}`
  // guard, hence the doubled `))}` closing the tree-column ternary; the optional
  // centerSlot (the Code workspace's conversation column) then sits between the
  // tree and the preview/Changes column, before `{filePreviewCollapsed`.
  /ProjectTree[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*\)\)\}[\s\S]*?\{filePreviewCollapsed \? \([\s\S]*?<div[\s\S]{0,180}className="min-w-0 min-h-0 flex flex-1 flex-col overflow-hidden"[\s\S]*?previewPath/,
  "Projects preview pane should be the right full-height half of the layout",
);
assert.match(
  source,
  /projectDetailCollapsed,\s*setProjectDetailCollapsed[\s\S]{0,80}useState\(false\)/,
  "Projects detail pane should own collapse state",
);
assert.match(
  source,
  /filePreviewCollapsed,\s*setFilePreviewCollapsed[\s\S]{0,80}useState\(false\)/,
  "File preview pane should own collapse state",
);
assert.match(
  source,
  /aria-label="Hide project details"[\s\S]*?setProjectDetailVisible\(false\)/,
  "Projects detail header exposes a collapse control",
);
assert.match(
  source,
  /projectDetailCollapsed \? \([\s\S]*?<button[\s\S]*?aria-label="Show project details"[\s\S]*?className="flex min-h-\[34px\][^"]*xl:self-stretch[^"]*xl:border-r[^"]*"[\s\S]*?Details/,
  "Collapsed project detail rail re-opens the details pane with a full-height click target",
);
assert.match(
  source,
  /aria-label="Hide file preview"[\s\S]*?setFilePreviewVisible\(false\)/,
  "File preview header exposes a collapse control",
);
assert.match(
  source,
  /filePreviewCollapsed \? \([\s\S]*?<button[\s\S]*?aria-label="Show file preview"[\s\S]*?className="flex min-h-\[34px\][^"]*xl:self-stretch[^"]*xl:border-l[^"]*"[\s\S]*?Preview/,
  "Collapsed file preview rail re-opens the preview pane with a full-height click target",
);
assert.match(
  source,
  /if \(!visible && filePreviewCollapsed\) setFilePreviewCollapsed\(false\)/,
  "Collapsing project details should keep the preview side visible",
);
assert.match(
  source,
  /if \(!visible && projectDetailCollapsed\) setProjectDetailCollapsed\(false\)/,
  "Collapsing file preview should keep the project details side visible",
);

// Projects file preview: visual formats should render as media, not an
// unsupported-extension code block.
assert.match(
  source,
  /type ProjectFilePreview =[\s\S]*?\| \{ kind: "image"; dataUrl: string; mimeType: string; size\?: number \}/,
  "Projects file preview state tracks image previews separately from text",
);
assert.match(
  source,
  /json\.kind === "image"[\s\S]*?setPreview\(\{ kind: "image", dataUrl: json\.dataUrl, mimeType: json\.mimeType, size: json\.size \}\)/,
  "Projects file preview should accept image responses from /api/project-file",
);
assert.match(
  source,
  /preview\?\.kind === "image" \? \([\s\S]*?<img[\s\S]*?src=\{preview\.dataUrl\}[\s\S]*?object-contain/,
  "Projects file preview should render images as contained visual media",
);
assert.match(
  source,
  /disabled=\{!preview \|\| preview\.kind !== "text"\}/,
  "Copy preview content should stay disabled for binary image previews",
);

console.log("comux-view-terminal.test.ts OK");

// ── Shell-owned chords + explicit close semantics ─────────────────────────────
// Ctrl+W is readline delete-word and Ctrl+N is next-history; hijacking them
// for tab management closed/spawned terminals mid-keystroke.
assert.match(
  source,
  /if \(e\.ctrlKey && !e\.metaKey && target\?\.closest\?\.\("\.xterm"\)\) return;/,
  "ctrl-chords typed inside the terminal go to the shell, not tab management",
);
assert.match(
  source,
  /removeSession[\s\S]{0,900}pty_stop/,
  "closing a tab is the one place the desktop PTY is killed",
);
assert.match(
  source,
  /killPtyBridge\(`cave\.comux\.\$\{removedId\}`\)/,
  "closing a tab also reaps the WS-transport shell (killPtyBridge, scoped to removedId) so it doesn't leak for the detach grace (cave-wujw)",
);

// Tab rename: Escape aborts (restores the label), and blank/whitespace names
// are rejected so a cleared tab keeps its label.
assert.match(
  source,
  /e\.key === "Escape"[\s\S]{0,260}?e\.currentTarget\.textContent = s\.label/,
  "Escape during a tab rename restores the original label (no save)",
);
assert.match(
  source,
  /const trimmed = label\.trim\(\);\s*if \(!trimmed\) return;/,
  "renameSession ignores blank/whitespace-only names",
);

console.log("comux terminal chord/close assertions: ok");
