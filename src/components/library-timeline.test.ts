// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./library-timeline.tsx", import.meta.url), "utf8");

assert.match(source, /from "@\/components\/ui\/view-header"/, "uses ViewHeader primitive");
assert.match(source, /from "@\/components\/ui\/search-input"/, "uses SearchInput primitive");
assert.match(source, /from "@\/components\/ui\/empty-state"/, "uses EmptyState primitive");
assert.match(source, /from "@\/components\/ui\/skeleton"/, "uses Skeleton primitive");
assert.match(source, /from "@\/components\/library-timeline-row"/, "renders LibraryTimelineRow");
assert.match(source, /fetch\(`?\/api\/library\/all/, "calls /api/library/all");
assert.match(source, /groupBy.*"date".*"source"/s, "supports group-by date|source");
assert.match(source, /familiarFilter/, "supports familiar filter state");

console.log("library-timeline wiring: 8 assertions passed");
