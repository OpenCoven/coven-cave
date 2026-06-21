// @ts-nocheck
// Locks the PR1 terminal chrome polish wiring.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const comux = readFileSync(new URL("./comux-view.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(comux, /const splitFromPane = useCallback\(/, "per-pane split handler");
assert.match(comux, /splitFromPane\(s\.id, "right"\)/, "split-right button wired");
assert.match(comux, /splitFromPane\(s\.id, "bottom"\)/, "split-down button wired");
assert.match(comux, /comux-terminal-pane-cwd/, "per-pane cwd chip");
assert.match(comux, /\{projectName\(s\.projectRoot\)\}/, "cwd chip shows project basename");
assert.match(comux, /comux-terminal-broadcast-banner/, "broadcast banner");
assert.match(comux, /Broadcasting to \{visiblePaneSessionIds\.length\} panes/, "banner shows pane count");
assert.match(comux, /comux-terminal-empty-hints/, "empty-state shortcut cheatsheet");

for (const cls of ["comux-terminal-pane-cwd", "comux-terminal-pane-action--split", "comux-terminal-broadcast-banner", "comux-terminal-empty-hints"]) {
  assert.match(css, new RegExp("\\." + cls.replace(/[-]/g, "\\-")), `CSS for ${cls}`);
}
console.log("comux-chrome-wiring.test.ts passed");
