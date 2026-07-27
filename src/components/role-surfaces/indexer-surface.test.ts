import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surface = readFileSync(new URL("./indexer-surface.tsx", import.meta.url), "utf8");

const section = (start: string, end: string) => {
  const from = surface.indexOf(start);
  const to = surface.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `${start} section missing`);
  return surface.slice(from, to);
};

test("memory inventory keeps retryable failure separate from loading and empty data", () => {
  const collections = section(
    '<RailSection title="Knowledge collections"',
    '<RailSection title="Embeddings & indexes"',
  );
  assert.match(surface, /import[\s\S]*?\bSurfaceLoading\b[\s\S]*?from "\.\/surface-room"/);
  assert.match(surface, /import[\s\S]*?\bSurfaceError\b[\s\S]*?from "\.\/surface-room"/);
  assert.match(
    surface,
    /useLatestAsyncData<SurfaceMemoryEntry\[\]>\(\{[\s\S]*?scopeKey: familiarId[\s\S]*?load: context\.memory\.listEntries[\s\S]*?errorMessage: "Couldn't load memory inventory\."/,
  );
  assert.match(
    collections,
    /entriesError\s*\?\s*\([\s\S]*?<SurfaceError[\s\S]*?onRetry=\{loadEntries\}[\s\S]*?\)\s*:\s*entries == null\s*\?\s*\([\s\S]*?<SurfaceLoading/,
  );
  assert.match(collections, /collections\.length === 0\s*\?\s*\([\s\S]*?<SurfaceEmpty/);
});

test("memory reads keep retryable failure separate from loading and successful content", () => {
  assert.match(surface, /const fetchContent = useCallback\(async \(\) =>/);
  assert.match(
    surface,
    /useLatestAsyncData<string>\(\{[\s\S]*?scopeKey: `\$\{familiarId\}:\$\{selected\?\.fullPath \?\? ""\}`[\s\S]*?load: fetchContent[\s\S]*?enabled: selected != null/,
  );
  assert.match(
    surface,
    /contentError\s*\?\s*\([\s\S]*?<SurfaceError[\s\S]*?onRetry=\{loadContent\}[\s\S]*?\)\s*:\s*content == null\s*\?\s*\([\s\S]*?<SurfaceLoading/,
  );
  assert.match(surface, /<pre className="role-surface-content">\{content\.slice\(0, 4000\)\}<\/pre>/);
});

test("archive filtering uses the shared clearable search field", () => {
  assert.match(surface, /import \{ SearchInput \} from "@\/components\/ui\/search-input"/);
  assert.match(
    surface,
    /<SearchInput[\s\S]*?value=\{state\.filter\}[\s\S]*?onValueChange=\{\(next\) => patch\(\{ filter: next \}\)\}[\s\S]*?placeholder="Filter memories…"[\s\S]*?onClear=\{\(\) => patch\(\{ filter: "" \}\)\}[\s\S]*?\/>/,
  );
  assert.doesNotMatch(
    surface,
    /<input[\s\S]*?placeholder="Filter memories…"/,
    "the memory filter must not regress to a raw input",
  );
});

test("recent changes do not turn inventory loading or failure into an empty history", () => {
  const start = surface.indexOf('<RailSection title="Recent changes"');
  const end = surface.indexOf("</div>", start);
  assert.ok(start >= 0 && end > start, "Recent changes section missing");
  const recentChanges = surface.slice(start, end);
  assert.match(
    recentChanges,
    /entriesError\s*\?\s*\([\s\S]*?<SurfaceError[\s\S]*?onRetry=\{loadEntries\}[\s\S]*?\)\s*:\s*entries == null\s*\?\s*\([\s\S]*?<SurfaceLoading/,
  );
  assert.match(recentChanges, /recentChanges\.length === 0\s*\?\s*\([\s\S]*?<SurfaceEmpty/);
  assert.match(recentChanges, /<SurfaceError[\s\S]*?live=\{false\}/, "the recent-changes duplicate is non-live");
});

test("memory details wait for the inventory source before exposing selection controls", () => {
  const details = section('<SurfaceRail side="right" label="Memory details"', "</SurfaceRail>");
  assert.match(
    details,
    /entriesError\s*\?\s*\([\s\S]*?<SurfaceError[\s\S]*?live=\{false\}[\s\S]*?\)\s*:\s*entries == null\s*\?\s*\([\s\S]*?<SurfaceLoading[\s\S]*?\)\s*:\s*!selected/,
  );
});
