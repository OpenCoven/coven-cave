// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const chatSurface = await readFile(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

assert.match(
  chatSurface,
  /Panel[\s\S]*id="right-sidebar"[\s\S]*defaultSize="33%"[\s\S]*minSize="33%"[\s\S]*maxSize="46%"/,
  "ChatSurface right sidebar should open at the requested 33% width",
);

assert.match(
  chatSurface,
  /Separator\s+className="[^"]*shell-separator[^"]*"/,
  "ChatSurface right sidebar should render a resize separator before the panel",
);

assert.doesNotMatch(
  chatSurface,
  /w-\[320px\]\s+shrink-0/,
  "ChatSurface right sidebar should not be a fixed 320px non-resizable aside",
);

assert.match(
  globals,
  /\.right-panel-tabs[\s\S]*min-width:\s*0/,
  "Right panel tab bar should be allowed to shrink inside narrow sidebar widths",
);

assert.match(
  globals,
  /\.right-panel-tab[\s\S]*min-width:\s*0[\s\S]*overflow:\s*hidden[\s\S]*text-overflow:\s*ellipsis/,
  "Right panel tabs should truncate instead of overflowing the sidebar",
);

assert.match(
  chatSurface,
  /right-panel-close[\s\S]*?className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"/,
  "Right panel top content wrapper must scroll vertically so pane content without an internal scroller is reachable",
);

assert.match(
  chatSurface,
  /<Group[\s\S]*className="right-panel-split"[\s\S]*orientation="vertical"/,
  "ChatSurface right sidebar should use a vertical split inside the right panel",
);

assert.match(
  chatSurface,
  /<Panel[\s\S]*id="right-panel-primary"[\s\S]*defaultSize="50%"[\s\S]*<Separator[\s\S]*className="shell-separator-h right-panel-splitter"[\s\S]*<Panel[\s\S]*id="right-panel-changes"[\s\S]*defaultSize="50%"/,
  "ChatSurface right sidebar should default to a 50/50 vertical split",
);

console.log("right-sidebar-fit.test.ts OK");
