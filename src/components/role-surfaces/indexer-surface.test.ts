import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const surface = readFileSync(new URL("./indexer-surface.tsx", import.meta.url), "utf8");

test("memory inventory keeps retryable failure separate from loading and empty data", () => {
  assert.match(surface, /import[\s\S]*?\bSurfaceLoading\b[\s\S]*?from "\.\/surface-room"/);
  assert.match(surface, /import[\s\S]*?\bSurfaceError\b[\s\S]*?from "\.\/surface-room"/);
  assert.match(surface, /const \[entries, setEntries\] = useState<SurfaceMemoryEntry\[\] \| null>\(null\)/);
  assert.match(surface, /const \[entriesError, setEntriesError\] = useState<string \| null>\(null\)/);
  assert.match(surface, /const loadEntries = useCallback\(async \(\) =>/);
  assert.match(
    surface,
    /entriesError\s*\?\s*\([\s\S]*?<SurfaceError[\s\S]*?onRetry=\{loadEntries\}[\s\S]*?\)\s*:\s*entries == null\s*\?\s*\([\s\S]*?<SurfaceLoading/,
  );
  assert.match(surface, /collections\.length === 0\s*\?\s*\([\s\S]*?<SurfaceEmpty/);
});

test("memory reads keep retryable failure separate from loading and successful content", () => {
  assert.match(surface, /const \[content, setContent\] = useState<string \| null>\(null\)/);
  assert.match(surface, /const \[contentError, setContentError\] = useState<string \| null>\(null\)/);
  assert.match(surface, /const loadContent = useCallback\(async \(\) =>/);
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
