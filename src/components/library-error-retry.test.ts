// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const list = readFileSync(new URL("./library-doc-list.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./library-view.tsx", import.meta.url), "utf8");

// LibraryDocList — error state lives next to loading/empty and is reachable
assert.match(
  list,
  /error\?:\s*string \| null/,
  "LibraryDocList should accept an optional error message prop",
);
assert.match(
  list,
  /onRetry\?:\s*\(\)\s*=>\s*void/,
  "LibraryDocList should accept an optional onRetry callback",
);
assert.match(
  list,
  /Couldn(?:&rsquo;|[’'])t load documents\./,
  "LibraryDocList should show a clear error message instead of the empty-state copy",
);
assert.match(
  list,
  /onClick=\{onRetry\}/,
  "LibraryDocList retry affordance should call onRetry",
);
assert.match(
  list,
  /role="alert"/,
  "LibraryDocList error state should announce as alert for screen readers",
);

// LibraryView — error is captured and threaded into LibraryDocList
assert.match(
  view,
  /const \[docsError, setDocsError\] = useState<string \| null>\(null\)/,
  "LibraryView should track docs error state",
);
assert.match(
  view,
  /setDocsError\(json\.error \?\? "Library API returned an error\."\)/,
  "LibraryView should surface the API error message",
);
assert.match(
  view,
  /error=\{docsError\}/,
  "LibraryView should pass the error to LibraryDocList",
);
assert.match(
  view,
  /onRetry=\{\(\)\s*=>\s*void loadDocs\(activeCollection\)\}/,
  "LibraryView should pass a retry handler that re-fires loadDocs",
);

// Saving a bookmark to the board must throw on a failed response so NewCardModal
// surfaces the error and keeps the dialog open — never silently close on a lost save.
assert.match(
  view,
  /const res = await fetch\("\/api\/board"[\s\S]{0,700}if \(!res\.ok \|\| !json\?\.ok\) \{[\s\S]{0,120}throw new Error/,
  "Save-to-board should throw on a failed/!ok response instead of closing silently",
);

console.log("library-error-retry.test.ts: ok");
