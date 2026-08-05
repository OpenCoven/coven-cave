// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The Pinned rail at the top of the chat-mode workspace sidebar used to be
// read-only: unpinning required hunting down the *other* copy of the row in
// the Recent/folder list (which may be truncated behind "Show all" or a
// collapsed folder). Every pinned row must carry its own one-click unpin.

const source = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");

// Isolate the pinned-rail: the render site wires onTogglePin/onOpen callbacks
// through the shared PinnedThreadRow component, but the row's actual markup
// (unpin button, its aria attributes, is-on styling) lives in that
// component's own function body — pin against both scopes, not just the JSX
// call site. See cave-zs85n Task 6 gap-fix notes.
const start = source.indexOf('aria-label="Pinned threads"');
// Anchor the section end on the recent view *after* the pinned rail (an earlier
// `view === "recent"` guard exists higher in the file, so scan forward from start).
const end = source.indexOf('view === "recent"', start);
assert.ok(start !== -1 && end > start, "pinned rail section exists before the recent view");
const pinnedRenderSite = source.slice(start, end);

const pinnedRowFnStart = source.indexOf("function PinnedThreadRow(");
assert.ok(pinnedRowFnStart > 0, "the PinnedThreadRow component exists");
const pinnedRail = source.slice(pinnedRowFnStart, source.indexOf("\n}\n", pinnedRowFnStart));

assert.match(
  pinnedRenderSite,
  /<PinnedThreadRow\b/,
  "the Pinned section renders rows through the shared PinnedThreadRow component",
);
assert.match(
  pinnedRenderSite,
  /onTogglePin=\{\(\) => togglePin\(session\.id\)\}/,
  "the pinned-rail unpin button toggles through the shared pin state",
);
assert.match(
  pinnedRail,
  /aria-label=\{`Unpin \$\{title\}`\}/,
  "each pinned-rail row has an unpin button labelled for the thread",
);
assert.match(
  pinnedRail,
  /className="cnav__icon-btn is-on focus-ring"/,
  "the unpin control uses is-on so it is always visible (no hover-reveal gate)",
);
assert.match(pinnedRail, /aria-pressed/, "unpin control is a pressed toggle for AT");
assert.doesNotMatch(
  pinnedRail,
  /cnav__row-actions/,
  "pinned rows must not hide the unpin inside the hover-only row-actions overlay",
);

console.log("workspace-sidebar-pinned: ok");
