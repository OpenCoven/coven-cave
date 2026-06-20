// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./library-timeline.tsx", import.meta.url), "utf8");
const rowSource = await readFile(new URL("./library-timeline-row.tsx", import.meta.url), "utf8");
const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const libraryCss = await readFile(new URL("../styles/library.css", import.meta.url), "utf8");

assert.match(source, /from "@\/components\/ui\/view-header"/, "uses ViewHeader primitive");
assert.match(source, /from "@\/components\/ui\/search-input"/, "uses SearchInput primitive");
assert.match(source, /from "@\/components\/ui\/empty-state"/, "uses EmptyState primitive");
assert.match(source, /from "@\/components\/ui\/skeleton"/, "uses Skeleton primitive");
assert.match(source, /from "@\/components\/library-timeline-row"/, "renders LibraryTimelineRow");
assert.match(source, /fetch\(`?\/api\/library\/all/, "calls /api/library/all");
assert.match(source, /groupBy.*"date".*"source"/s, "supports group-by date|source");
assert.match(source, /familiarFilter/, "supports familiar filter state");
assert.match(
  globals,
  /\.ui-view-header[\s\S]*container:\s*view-header\s*\/\s*inline-size/,
  "ViewHeader should expose an inline-size container for right-rail fit rules",
);
assert.match(
  globals,
  /@container\s+view-header\s+\(max-width:\s*420px\)[\s\S]*\.ui-view-header-filter[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  "ViewHeader filters should stack into a one-column grid in narrow right rails",
);

assert.match(
  source,
  /library-timeline-group-toggle[\s\S]*aria-pressed=\{groupBy === g\}/,
  "grouping is a segmented switch toggle, not a cycling button",
);
assert.doesNotMatch(source, /Group: \{groupBy\}/, "cycling Group button should be gone");
assert.match(
  libraryCss,
  /@container\s+view-header\s+\(min-width:[^)]*\)[\s\S]*\.library-timeline-filters[\s\S]*grid-template-columns:\s*repeat\(3,/,
  "filter options share one row when the header is wide enough",
);
assert.doesNotMatch(
  rowSource,
  /google\.com\/s2\/favicons|<img|onError/,
  "Timeline rows should use local list-type icons instead of remote favicon requests that emit console 404s",
);
assert.match(
  rowSource,
  /name=\{listIcon\(entry\.list\)\}/,
  "Timeline rows should render deterministic local icons by list type",
);

console.log("library-timeline wiring: 15 assertions passed");
