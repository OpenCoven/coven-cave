import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = [
  await readFile(new URL("./familiars-memory-view.tsx", import.meta.url), "utf8"),
  await readFile(new URL("./familiars-memory-files.tsx", import.meta.url), "utf8"),
].join("\n");

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

// The masthead is the collapsible region. It must not cap overview content,
// and collapsed descendants must leave both the focus and accessibility trees.
assert.match(
  source,
  /data-testid="memory-masthead"[^]*headerCollapsed \? "grid-rows-\[0fr\] opacity-0" : "grid-rows-\[1fr\] opacity-100"/,
  "masthead must use an uncapped grid-track collapse",
);
assert.doesNotMatch(source, /max-h-48/, "masthead must not clip a tall overview");
assert.match(
  source,
  /inert=\{headerCollapsed \? true : undefined\}/,
  "collapsed controls must be removed from sequential focus",
);
assert.match(
  source,
  /mastheadRef\.current\?\.contains\(document\.activeElement\)[^]*searchInputRef\.current\?\.focus/,
  "collapsing while focus is inside moves focus to the persistent search control",
);

// The stats row lives inside the collapsible masthead (so it hides too).
const mastheadStart = source.indexOf('data-testid="memory-masthead"');
const statsIdx = source.indexOf('data-testid="memory-stats-inline"');
assert.ok(mastheadStart !== -1 && statsIdx > mastheadStart, "stats row must sit inside the masthead block");

console.log("ok - familiars-memory-view: masthead collapses on list scroll-down, restores on scroll-up");
