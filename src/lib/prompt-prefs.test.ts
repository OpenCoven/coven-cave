// @ts-nocheck
import assert from "node:assert/strict";
import {
  PROMPT_FAVORITES_KEY,
  PROMPT_RECENTS_KEY,
  PROMPT_RECENTS_MAX,
  orderPrompts,
  promptTags,
  readPromptFavorites,
  readPromptRecents,
  recordPromptRecent,
  togglePromptFavorite,
} from "./prompt-prefs.ts";

// Minimal window.localStorage shim (chat-session-prefs test pattern).
const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
};

const P = (id, tags = []) => ({ id, name: id, body: id, source: "builtin", tags });

// ── ordering: favorites > recents (MRU) > scan order ─────────────────────────
const prompts = [P("a"), P("b"), P("c"), P("d")];
assert.equal(
  orderPrompts(prompts, [], []),
  prompts,
  "no prefs → the same array reference (memo-friendly bail)",
);
assert.deepEqual(
  orderPrompts(prompts, ["c"], ["d", "b"]).map((p) => p.id),
  ["c", "d", "b", "a"],
  "favorites lead, then recents in MRU order, then scan order",
);
assert.deepEqual(
  orderPrompts(prompts, ["c", "b"], ["b", "c"]).map((p) => p.id),
  ["b", "c", "a", "d"],
  "a template that is both favorite and recent ranks as favorite (scan order within favorites)",
);

// ── favorites: toggle + persistence ──────────────────────────────────────────
assert.deepEqual(readPromptFavorites(), [], "empty store reads as no favorites");
let favs = togglePromptFavorite([], "a");
assert.deepEqual(favs, ["a"], "toggle on");
assert.deepEqual(readPromptFavorites(), ["a"], "toggle persists");
favs = togglePromptFavorite(favs, "a");
assert.deepEqual(favs, [], "toggle off");

// ── recents: MRU, dedup, cap ─────────────────────────────────────────────────
recordPromptRecent("x");
recordPromptRecent("y");
assert.deepEqual(readPromptRecents(), ["y", "x"], "most recent first");
recordPromptRecent("x");
assert.deepEqual(readPromptRecents(), ["x", "y"], "re-inserting moves to front without duplicating");
for (let i = 0; i < PROMPT_RECENTS_MAX + 3; i += 1) recordPromptRecent(`r${i}`);
assert.equal(readPromptRecents().length, PROMPT_RECENTS_MAX, "MRU list is capped");

// ── corrupt storage degrades to empty, never throws ──────────────────────────
store.set(PROMPT_FAVORITES_KEY, "{not json");
assert.deepEqual(readPromptFavorites(), [], "corrupt JSON reads as empty");
store.set(PROMPT_RECENTS_KEY, JSON.stringify({ nope: true }));
assert.deepEqual(readPromptRecents(), [], "non-array JSON reads as empty");
store.set(PROMPT_RECENTS_KEY, JSON.stringify(["ok", 42, null, "fine"]));
assert.deepEqual(readPromptRecents(), ["ok", "fine"], "non-string entries are filtered");

// ── SSR guard ────────────────────────────────────────────────────────────────
const savedWindow = globalThis.window;
delete globalThis.window;
assert.deepEqual(readPromptFavorites(), [], "no window → empty, no throw");
assert.deepEqual(togglePromptFavorite([], "a"), ["a"], "toggle still returns the new array without window");
globalThis.window = savedWindow;

// ── tags ─────────────────────────────────────────────────────────────────────
assert.deepEqual(
  promptTags([P("a", ["writing", "git"]), P("b", ["git", "release"]), P("c")]),
  ["git", "release", "writing"],
  "distinct tags, alphabetical",
);
assert.deepEqual(promptTags([P("a")]), [], "no tags → empty list");

console.log("prompt-prefs.test.ts: ok");
