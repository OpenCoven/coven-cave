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

// Keyboard hint footer (matches the inbox/calendar/library/home/browser pattern).
assert.match(
  source,
  /⌘N new · ⌘W close · drag tabs onto pane edges to split · drag dividers to resize/,
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

// Terminal persistence: switching workspace surfaces must hide, not unmount,
// the Comux terminal. Otherwise the PTY bridge disconnects and desktop Tauri
// cleanup stops the process.
assert.match(
  workspace,
  /const terminalDetail = \([\s\S]*?<ComuxView[\s\S]{0,120}view="terminal"[\s\S]{0,120}active=\{mode === "terminal"\}/,
  "Workspace should create one persistent terminal detail subtree",
);
assert.match(
  workspace,
  /\{terminalDetail\}[\s\S]{0,80}\{mode === "terminal" \? null :/,
  "Workspace should always render the terminal subtree and hide other detail surfaces while Terminal is active",
);
assert.doesNotMatch(
  workspace,
  /<div key=\{mode\} className="cave-mode-fade/,
  "Workspace detail must not force a full remount on every surface switch",
);
assert.match(
  source,
  /active = true[\s\S]*?if \(view !== "terminal" \|\| !active\) return;/,
  "Hidden terminal views should not keep global terminal shortcuts active",
);
assert.match(
  source,
  /active=\{active && sessionIdx === currentIdx\}/,
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
  /function TerminalDropZone\([\s\S]*?onDrop=\{\(e\) => \{[\s\S]*?onSplit\(dragged,\s*side\);/,
  "terminal panes expose edge drop zones that split with the dragged session",
);
assert.match(
  source,
  /<Group[\s\S]{0,220}orientation=\{splitDirection\}[\s\S]*?<Panel[\s\S]*?<Separator[\s\S]*?<SeparatorHandle/,
  "visible terminal panes render inside a resizable panel group",
);
assert.match(
  source,
  /data-terminal-resize-handle=\{paneIdx\}/,
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

// Projects view: the file/navigation side and preview side should share the
// project detail area evenly, and the preview should start at the top rather
// than sitting below a full-width project header.
assert.match(
  source,
  /className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-2"/,
  "Projects detail should split file controls and preview 50/50 on desktop",
);
assert.match(
  source,
  /className="flex min-h-0 min-w-0 flex-col border-b border-\[var\(--border-hairline\)\] xl:border-b-0 xl:border-r"[\s\S]*?selectedProject\.name[\s\S]*?ProjectTree/,
  "Projects left half should own the project header and file tree",
);
assert.match(
  source,
  /ProjectTree[\s\S]*?<\/div>\s*<\/div>\s*<div className="min-w-0 min-h-0 flex flex-1 flex-col overflow-hidden">[\s\S]*?previewPath/,
  "Projects preview pane should be the right full-height half of the split",
);

// Projects file preview: visual formats should render as media, not an
// unsupported-extension code block.
assert.match(
  source,
  /type ProjectFilePreview =[\s\S]*?\| \{ kind: "image"; dataUrl: string; mimeType: string; size\?: number \};/,
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
