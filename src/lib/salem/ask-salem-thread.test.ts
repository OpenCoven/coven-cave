// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ASK_SALEM_HISTORY_CAP,
  ASK_SALEM_HISTORY_CHAR_CAP,
  ASK_SALEM_THREAD_CAP,
  ASK_SALEM_THREAD_KEY,
  buildAskSalemContext,
  clearThread,
  historyForApi,
  loadThread,
  pickAskFamiliar,
  saveThread,
} from "./ask-salem-thread.ts";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

// ── Thread persistence ────────────────────────────────────────────────────────

test("thread round-trips through storage", () => {
  const storage = memoryStorage();
  const messages = [
    { role: "user", text: "what is a familiar?", at: 1 },
    { role: "salem", text: "A familiar is…", at: 2 },
  ];
  saveThread(storage, messages);
  assert.deepEqual(loadThread(storage), messages);
});

test("loadThread survives corrupt, foreign, and empty payloads", () => {
  assert.deepEqual(loadThread(memoryStorage({ [ASK_SALEM_THREAD_KEY]: "not json {" })), []);
  assert.deepEqual(loadThread(memoryStorage({ [ASK_SALEM_THREAD_KEY]: '{"nope":1}' })), []);
  assert.deepEqual(loadThread(memoryStorage()), []);
  const throwing = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {},
    removeItem: () => {},
  };
  assert.deepEqual(loadThread(throwing), [], "storage access errors degrade to an empty thread");
});

test("malformed entries are dropped, valid ones kept", () => {
  const storage = memoryStorage({
    [ASK_SALEM_THREAD_KEY]: JSON.stringify([
      { role: "user", text: "keep me" },
      { role: "wizard", text: "wrong role" },
      { role: "salem" },
      "just a string",
      null,
      { role: "salem", text: "also kept" },
    ]),
  });
  assert.deepEqual(loadThread(storage), [
    { role: "user", text: "keep me" },
    { role: "salem", text: "also kept" },
  ]);
});

test("saveThread caps at the newest ASK_SALEM_THREAD_CAP turns", () => {
  const storage = memoryStorage();
  const many = Array.from({ length: ASK_SALEM_THREAD_CAP + 10 }, (_, i) => ({
    role: i % 2 ? "salem" : "user",
    text: `turn ${i}`,
  }));
  const capped = saveThread(storage, many);
  assert.equal(capped.length, ASK_SALEM_THREAD_CAP);
  assert.equal(capped[0].text, "turn 10", "oldest turns drop first");
  assert.equal(loadThread(storage).length, ASK_SALEM_THREAD_CAP);
});

test("saveThread swallows quota errors and still returns the capped list", () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {},
  };
  const out = saveThread(storage, [{ role: "user", text: "hi" }]);
  assert.deepEqual(out, [{ role: "user", text: "hi" }]);
});

test("clearThread removes the key", () => {
  const storage = memoryStorage();
  saveThread(storage, [{ role: "user", text: "hi" }]);
  clearThread(storage);
  assert.deepEqual(loadThread(storage), []);
});

// ── Familiar fallback ─────────────────────────────────────────────────────────

test("pickAskFamiliar: active → salem → first → null", () => {
  const salem = { id: "salem" };
  const ada = { id: "ada" };
  const bo = { id: "bo" };
  assert.equal(pickAskFamiliar([ada, salem, bo], "bo"), bo, "active familiar wins");
  assert.equal(pickAskFamiliar([ada, salem, bo], "ghost"), salem, "unknown active falls to salem");
  assert.equal(pickAskFamiliar([ada, bo], null), ada, "no salem → first familiar");
  assert.equal(pickAskFamiliar([], "anything"), null, "empty coven → null, never invented ids");
});

// ── History for the API ───────────────────────────────────────────────────────

test("historyForApi caps count and per-turn length", () => {
  const long = "x".repeat(ASK_SALEM_HISTORY_CHAR_CAP + 500);
  const messages = Array.from({ length: ASK_SALEM_HISTORY_CAP + 5 }, (_, i) => ({
    role: i % 2 ? "salem" : "user",
    text: i === ASK_SALEM_HISTORY_CAP + 4 ? long : `turn ${i}`,
    at: i,
  }));
  const history = historyForApi(messages);
  assert.equal(history.length, ASK_SALEM_HISTORY_CAP, "newest turns only");
  assert.equal(history[0].text, "turn 5");
  const last = history[history.length - 1];
  assert.equal(last.text.length, ASK_SALEM_HISTORY_CHAR_CAP, "long turns truncate");
  assert.ok(!("at" in last), "wire shape carries role+text only");
});

// ── Local index context ───────────────────────────────────────────────────────

test("buildAskSalemContext scores corpora against the question", () => {
  const context = buildAskSalemContext("release checklist", {
    cards: [
      { title: "Prepare release checklist", status: "doing", priority: "high", labels: ["release"] },
      { title: "Water the plants", status: "todo", priority: "low", labels: [] },
    ],
    covenMemory: [
      { title: "Release ritual notes", familiar_id: "ada", path: "notes/release.md" },
      { title: "Unrelated lore", familiar_id: "bo", path: "lore.md" },
    ],
    fsMemory: [
      { relPath: "docs/release-checklist.md", rootLabel: "workspace" },
      { relPath: "recipes/soup.md", rootLabel: "workspace" },
    ],
  });
  assert.ok(context, "relevant corpora produce a context");
  assert.equal(context.source, "top-search");
  assert.equal(context.query, "release checklist");
  const titles = context.matches.map((m) => m.title);
  assert.ok(titles.includes("Prepare release checklist"));
  assert.ok(titles.includes("Release ritual notes"));
  assert.ok(titles.includes("docs/release-checklist.md"));
  assert.ok(!titles.includes("Water the plants"), "zero-overlap rows are excluded");
  assert.ok(!titles.includes("recipes/soup.md"));
});

test("conversation hits are always included and rank by matchCount", () => {
  const context = buildAskSalemContext("anything at all", {
    conversationHits: [
      { title: "Big thread", snippet: "…many matches…", matchCount: 9 },
      { snippet: "untitled convo", matchCount: 1 },
    ],
  });
  assert.ok(context);
  assert.equal(context.matches[0].title, "Big thread", "higher matchCount sorts first");
  assert.equal(context.matches[1].title, "(untitled chat)");
  assert.equal(context.matches[1].detail, "untitled convo");
});

test("context is null when nothing local matches", () => {
  assert.equal(buildAskSalemContext("quantum broomsticks", {}), null);
  assert.equal(
    buildAskSalemContext("quantum broomsticks", {
      cards: [{ title: "Water the plants" }],
    }),
    null,
  );
});

test("context caps at 8 matches, best scores first", () => {
  const cards = Array.from({ length: 20 }, (_, i) => ({
    title: `alpha task ${i}`,
    labels: i < 3 ? ["alpha", "beta"] : [],
  }));
  const context = buildAskSalemContext("alpha beta", { cards });
  assert.ok(context);
  assert.equal(context.matches.length, 8);
  assert.ok(
    context.matches.slice(0, 3).every((m) => /alpha task [012]$/.test(m.title)),
    "double-overlap rows outrank single-overlap rows",
  );
});
