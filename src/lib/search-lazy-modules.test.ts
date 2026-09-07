// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Unit 7: heavy search UI and indexing modules stay lazy so the root shell
// remains inside the existing JS/CSS budgets (spec performance targets,
// measured by the bundle-budget gate plus these import-graph pins).

const workspace = readFileSync(new URL("../components/workspace.tsx", import.meta.url), "utf8");
const topBar = readFileSync(new URL("../components/top-bar.tsx", import.meta.url), "utf8");
const familiarMenuBar = readFileSync(new URL("../components/familiar-menu-bar.tsx", import.meta.url), "utf8");
const lazySurfaces = readFileSync(new URL("../components/lazy-surfaces.tsx", import.meta.url), "utf8");
const indexStore = readFileSync(new URL("./search-index-store.ts", import.meta.url), "utf8");
const rootLayout = (() => {
  try {
    return readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  } catch {
    return "";
  }
})();

// The root shell never statically imports the search engine modules. They
// enter the client only through the palette (itself dynamic) or the server
// API route.
const shellSources = [workspace, topBar, familiarMenuBar, rootLayout].join("\n");
for (const moduleName of [
  "search-index-store",
  "search-coordinator",
  "search-runtime",
  "search-file-provider",
  "search-indexed-providers",
]) {
  assert.doesNotMatch(
    shellSources,
    new RegExp(`from \"@/lib/${moduleName}\"|from \"@/lib/server/${moduleName}\"`),
    `the root shell does not statically import ${moduleName}`,
  );
}

// The palette is code-split: a dynamic import, not a static one, so the
// always-loaded shell does not pay for the search surface.
assert.match(
  lazySurfaces,
  /dynamic\([\s\S]{0,120}?import\("@\/components\/command-palette"\)/,
  "the palette loads through next/dynamic",
);
assert.doesNotMatch(workspace, /import \{ CommandPalette \}/, "workspace never statically imports the palette");

// node:sqlite (still experimental) is imported lazily inside the store, so
// importing the store module itself stays free of the experimental warning.
assert.match(
  indexStore,
  /await import\("node:sqlite"\)/,
  "node:sqlite is loaded lazily, not at module top level",
);

console.log("search-lazy-modules.test.ts: ok");
