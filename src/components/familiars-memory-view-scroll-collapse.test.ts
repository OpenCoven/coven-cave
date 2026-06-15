// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./familiars-memory-view.tsx", import.meta.url), "utf8");

// The memory list scroll collapses the masthead (title + description + stats) so
// the list gets more vertical room while the search + group/sort controls stay
// visible. Scrolling down hides it; scrolling up or returning to the top shows it.

// State + direction-aware scroll handler exist.
assert.match(source, /headerCollapsed/, "must track masthead collapsed state");
assert.match(source, /setHeaderCollapsed\(true\)/, "scrolling down must collapse the masthead");
assert.match(source, /setHeaderCollapsed\(false\)/, "scrolling up / at top must restore the masthead");
assert.match(
  source,
  /const onListScroll = useCallback/,
  "must define an onListScroll handler",
);
assert.match(
  source,
  /lastListScrollTop/,
  "must remember the previous scrollTop to detect direction",
);

// Handler is wired to the memories list scroll container.
assert.match(
  source,
  /onScroll=\{onListScroll\}[^]*overflow-y-auto/,
  "onListScroll must be attached to the scrollable memories list container",
);

// The masthead is the collapsible region and animates via max-height/opacity.
assert.match(
  source,
  /data-testid="memory-masthead"[^]*headerCollapsed \? "max-h-0 opacity-0" : "max-h-48 opacity-100"/,
  "masthead must collapse to zero height / faded when headerCollapsed",
);

// The stats row lives inside the collapsible masthead (so it hides too).
const mastheadStart = source.indexOf('data-testid="memory-masthead"');
const statsIdx = source.indexOf('data-testid="memory-stats-inline"');
assert.ok(mastheadStart !== -1 && statsIdx > mastheadStart, "stats row must sit inside the masthead block");

console.log("ok - familiars-memory-view: masthead collapses on list scroll-down, restores on scroll-up");
