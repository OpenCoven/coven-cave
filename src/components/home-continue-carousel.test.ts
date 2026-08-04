// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./home/home-continue.tsx", import.meta.url), "utf8");
const css = await readFile(
  new URL("../styles/home-composer/hearth-continuations.css", import.meta.url),
  "utf8",
);

assert.match(source, /const HOME_CONTINUE_PAGE_SIZE = 3;/, "the carousel pages in sets of three");
assert.match(
  source,
  /const rows = useMemo\(\(\) => resumableSessions\(sessions, Number\.POSITIVE_INFINITY\), \[sessions\]\);/,
  "the carousel keeps every resumable session",
);
assert.match(
  source,
  /const visibleRows = rows\.slice\(page \* HOME_CONTINUE_PAGE_SIZE, \(page \+ 1\) \* HOME_CONTINUE_PAGE_SIZE\);/,
  "the active page contains the next set of three sessions",
);
assert.match(
  source,
  /aria-label="Previous set of sessions"[\s\S]*?aria-label="Next set of sessions"/,
  "the carousel exposes labelled previous and next controls",
);
assert.match(
  source,
  /aria-live="polite"[\s\S]*?Page \{page \+ 1\} of \{pageCount\}/,
  "page changes are announced without moving focus",
);
assert.match(
  source,
  /pageCount > 1 \? \([\s\S]*?home-continue__nav/,
  "navigation only renders for multiple pages",
);
assert.match(
  css,
  /\.home-continue__nav \{[\s\S]*?justify-content: center/,
  "carousel navigation stays centered under the cards",
);
assert.match(
  css,
  /\.home-continue__nav-button \{[\s\S]*?width: var\(--touch-target\);[\s\S]*?height: var\(--touch-target\);/,
  "carousel controls preserve touch-safe targets",
);

console.log("home-continue-carousel.test.ts: ok");
