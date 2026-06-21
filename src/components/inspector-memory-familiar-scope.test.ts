// @ts-nocheck
// Regression guard for the chat-session memory leak: the in-chat inspector's
// "Files" mode must scope memory files to the active familiar, and the
// `/api/memory` route must scope at the source. These lock the wiring so a
// future refactor can't silently re-introduce cross-familiar file exposure.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel) => readFileSync(path.join(process.cwd(), rel), "utf8");

// ── /api/memory route scopes by familiarId at the source ────────────────────
{
  const route = read("src/app/api/memory/route.ts");
  assert.match(route, /scopeMemoryFilesToFamiliar/, "route must use the shared scoping helper");
  assert.match(
    route,
    /searchParams\.get\(\s*["']familiarId["']\s*\)/,
    "route must read the familiarId query param",
  );
  assert.match(
    route,
    /scopeMemoryFilesToFamiliar\(\s*entries\s*,\s*familiarId\s*\)/,
    "route must scope the inventory to the requested familiar",
  );
}

// ── Inspector "Files" mode scopes to the active familiar ────────────────────
{
  const src = read("src/components/inspector-pane.tsx");

  assert.match(
    src,
    /from\s+["']@\/lib\/memory-file-scope["']/,
    "inspector must import the scoping helper",
  );

  // The file inventory is fetched scoped to the active familiar...
  assert.match(
    src,
    /\/api\/memory\?familiarId=\$\{encodeURIComponent\(familiar\.id\)\}/,
    "inspector must request the familiar-scoped memory list",
  );

  // ...and the fetch re-runs when the active familiar changes (a `[]` dep here
  // was the original leak: the list was fetched once, unscoped, and reused).
  const fetchEffect = src.slice(src.indexOf('const url = familiar'));
  assert.match(
    fetchEffect.slice(0, 800),
    /\}, \[familiar\?\.id\]\);/,
    "the memory-list effect must depend on familiar?.id",
  );

  // Defense in depth: rows are also scoped client-side for ownership + ordering.
  assert.match(
    src,
    /scopeMemoryFilesToFamiliar\(entries,\s*familiar\?\.id\)/,
    "inspector must scope rows client-side too",
  );

  // The unscoped fetch (the bug) must be gone.
  assert.doesNotMatch(
    src,
    /fetch\(\s*["']\/api\/memory["']\s*,/,
    "inspector must not fetch the unscoped /api/memory list",
  );
}

console.log("inspector-memory-familiar-scope.test.ts passed");
