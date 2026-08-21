// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("./code-terminal-workspace.tsx", import.meta.url), "utf8");
const css = readFileSync(
  new URL("../styles/globals/surface-code-room.css", import.meta.url),
  "utf8",
);

assert.match(
  workspace,
  /const \[focusMode, setFocusMode\] = useState\(false\)/,
  "the terminal workspace owns an explicit focus mode",
);
assert.match(
  workspace,
  /const \[previewPaneId, setPreviewPaneId\]/,
  "hover preview is separate from the pinned pane",
);
assert.match(
  workspace,
  /aria-label=\{focusMode \? "Exit focused terminal" : "Focus current terminal"\}/,
  "the toolbar exposes an accessible focus-mode toggle",
);
assert.match(
  workspace,
  /className="code-terminal-carousel"[\s\S]*?role="listbox"/,
  "focused mode renders a right-side vertical pane carousel",
);
assert.match(
  workspace,
  /onPointerEnter=\{\(\) => setPreviewPaneId\(pane\.id\)\}[\s\S]*?onClick=\{\(\) => pinPane\(pane\.id\)\}/,
  "hover previews a pane while click pins it",
);
assert.match(
  workspace,
  /onPointerLeave=\{\(\) => setPreviewPaneId\(null\)\}/,
  "leaving the carousel restores the pinned pane",
);
assert.match(
  workspace,
  /data-focus-visible=\{focusMode && paneId === visiblePaneId \? "true" : undefined\}/,
  "the existing mounted pane tree marks only the focused pane as visible",
);

assert.match(
  css,
  /\.code-terminal-pane \{[\s\S]*?border: 0;/,
  "terminal panes are borderless by default",
);
assert.match(
  css,
  /\.code-terminal-workspace\[data-focus-mode="true"\] \.code-terminal-pane:not\(\[data-focus-visible="true"\]\) \{[\s\S]*?visibility: hidden;/,
  "focus mode hides inactive mounted panes without unmounting them",
);
assert.match(
  css,
  /\.code-terminal-carousel \{[\s\S]*?position: absolute;[\s\S]*?right: var\(--space-2\);[\s\S]*?flex-direction: column;/,
  "the pane picker is a vertical carousel docked to the right edge",
);

console.log("code-terminal-focus-mode.test.ts: ok");
