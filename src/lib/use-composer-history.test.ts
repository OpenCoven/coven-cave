// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./use-composer-history.ts", import.meta.url), "utf8");

// ── Signature ────────────────────────────────────────────────────────────────
assert.match(
  src,
  /export function useComposerHistory\(storageKey: string\): \{\s*push: \(entry: string\) => void;\s*handleArrowKey: \(/,
  "useComposerHistory(storageKey) exposes push() and an event-consuming handleArrowKey()",
);

// ── Persistence (via composer-history.ts helpers) ────────────────────────────
assert.match(
  src,
  /useState<string\[\]>\(\(\) => readComposerHistory\(storageKey\)\)/,
  "history initialises lazily from the persisted recall stack",
);
assert.match(
  src,
  /useEffect\(\(\) => \{\s*writeComposerHistory\(storageKey, history\);\s*\}, \[storageKey, history\]\);/,
  "history persists whenever it changes",
);

// ── Recall semantics (extracted verbatim from the two composers) ─────────────
assert.match(
  src,
  /e\.key === "ArrowUp" && text === "" && history\.length > 0/,
  "↑ recalls only from an empty input — it never clobbers a draft in progress",
);
assert.match(
  src,
  /const idx = historyIdx < history\.length - 1 \? historyIdx \+ 1 : historyIdx;/,
  "↑ walks back through history and clamps at the oldest entry",
);
assert.match(
  src,
  /e\.key === "ArrowDown" && historyIdx === 0/,
  "↓ from the newest entry returns to the empty composer",
);
assert.match(
  src,
  /setHistoryIdx\(-1\);\s*setText\(""\);\s*return true;/,
  "walking forward past the newest entry clears the input and resets the cursor",
);
assert.match(
  src,
  /return false;\s*\},\s*\[history, historyIdx\],/,
  "unhandled keys report false so the composer's own branches (Enter-send, menus) run",
);

// ── push() resets the cursor ─────────────────────────────────────────────────
assert.match(
  src,
  /const push = useCallback\(\(entry: string\) => \{\s*setHistory\(\(prev\) => \[\.\.\.prev, entry\]\);\s*setHistoryIdx\(-1\);\s*\}, \[\]\);/,
  "push() appends and resets the recall cursor; call sites stay per-composer (home records slash commands, chat doesn't)",
);

console.log("use-composer-history.test.ts: ok");
