// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { openSearchIndex } from "./search-index-store.ts";
import { runSearch, MAX_PAGE } from "./search-coordinator.ts";
import { classifyMatch, withinEditDistance } from "./search-ranking.ts";
import { parseSearchQuery } from "./search-query.ts";
import { createFileSearchProvider } from "./search-file-provider.ts";
import { createTasksProvider, createSessionsProvider } from "./search-indexed-providers.ts";

// Fixtures: large corpora representing the spec large-workspace targets.
// These are PRODUCT measurements, so the tests MEASURE with
// performance.now() and assert only generous bounds — the point is to catch
// a structural regression (e.g. ranking the whole corpus, fuzzy over every
// row), not to fail on a slow CI runner.

const NOW = Date.parse("2026-08-10T00:00:00Z");
const context = { allowedProjectIds: ["p1"], allowedProjectRoots: null, familiarId: "cody", familiarIds: ["cody", "val"] };

function makeTasks(count) {
  const cards = [];
  for (let i = 0; i < count; i += 1) {
    cards.push({
      id: `t-${i}`,
      title: i % 500 === 0 ? `Composer rename ${i}` : `Task number ${i}`,
      notes: `notes for task ${i} with some body text`,
      status: ["blocked", "done", "in_progress"][i % 3],
      priority: "medium",
      familiarId: i % 2 === 0 ? "cody" : "val",
      sessionId: null,
      projectId: "p1",
      labels: [],
      createdAt: "2026-08-01T00:00:00Z",
      updatedAt: `2026-08-${String((i % 9) + 1).padStart(2, "0")}T00:00:00Z`,
    });
  }
  return cards;
}

function makeSessions(count) {
  const conversations = [];
  for (let i = 0; i < count; i += 1) {
    conversations.push({
      sessionId: `s-${i}`,
      familiarId: i % 2 === 0 ? "cody" : "val",
      title: i % 7 === 0 ? `Task session ${i}` : `Session ${i}`,
      status: "running",
      runtime: "codex",
      branch: "main",
      projectId: "p1",
      updatedAt: "2026-08-09T00:00:00Z",
    });
  }
  return conversations;
}

const tasksProvider = createTasksProvider({ loadCards: async () => makeTasks(4000) });
const sessionsProvider = createSessionsProvider({ listConversations: async () => makeSessions(1500) });

/* ---------------------------------------------------------------------- */
/* Warm indexed first page within 150 ms (local desktop target)            */
/* ---------------------------------------------------------------------- */

const root = mkdtempSync(path.join(tmpdir(), "search-perf-"));
const indexFile = path.join(root, "idx.sqlite");
const index = await openSearchIndex(indexFile);
const taskFp = await tasksProvider.fingerprint();
const taskDocs = await tasksProvider.collect(context);
index.refreshProvider("tasks", taskFp, () => taskDocs);
const sessionFp = await sessionsProvider.fingerprint();
const sessionDocs = await sessionsProvider.collect(context);
index.refreshProvider("sessions", sessionFp, () => sessionDocs);
assert.equal(index.documentCount(), 5500, "fixture corpus is large enough to matter");

const readIndexed = async (provider, query, limit) => {
  const fingerprint = await provider.fingerprint();
  const documents = provider.collect ? await provider.collect(context) : [];
  const refresh = index.refreshProvider(provider.id, fingerprint, () => documents);
  const rows = index.match({
    text: query.text,
    phrases: query.phrases,
    entityTypes: query.filters.filter((f) => f.key === "type").map((f) => String(f.value)),
    projectIds: query.scopes.filter((s) => s.dimension === "project").map((s) => s.id),
    providerIds: [provider.id],
    limit,
  }).map((row) => ({ document: row.document, relevance: row.relevance, providerId: provider.id }));
  return { rows, stale: refresh.stale };
};

const warmQuery = parseSearchQuery("composer", { scopes: [], naturalLanguage: false }).state;
// Warm the FTS caches once; measure the SECOND request.
await runSearch(
  { query: warmQuery, context, now: NOW },
  { providers: [tasksProvider, sessionsProvider], readIndexed },
);
const t0 = performance.now();
const warmOutcome = await runSearch(
  { query: warmQuery, context, now: NOW },
  { providers: [tasksProvider, sessionsProvider], readIndexed },
);
const warmMs = performance.now() - t0;
console.log(`diagnostic: warm indexed first page = ${warmMs.toFixed(1)} ms`);
assert.ok(warmOutcome.ok);
assert.ok(warmOutcome.results.length > 0, "warm search returns the exact-title hits");
assert.ok(warmMs < 150, `warm indexed first page under 150 ms (measured ${warmMs.toFixed(1)} ms)`);

/* ---------------------------------------------------------------------- */
/* First page capped at 50 results with per-type budgets                   */
/* ---------------------------------------------------------------------- */

assert.equal(MAX_PAGE, 50, "the coordinator caps the first page at 50");
const capped = parseSearchQuery("task", { scopes: [], naturalLanguage: false }).state;
const cappedOutcome = await runSearch(
  { query: capped, context, now: NOW, limit: MAX_PAGE },
  { providers: [tasksProvider, sessionsProvider], readIndexed },
);
assert.ok(cappedOutcome.ok);
assert.ok(cappedOutcome.results.length <= MAX_PAGE, "no first page exceeds 50 results");
assert.equal(cappedOutcome.results.length, MAX_PAGE, "a corpus with more matches still pages at 50");
// Top mode enforces a per-type diversity floor: no single type fills the page.
const types = new Set(cappedOutcome.results.map((r) => r.document.entityType));
assert.ok(types.size >= 2, "top mode keeps a per-type diversity floor");

/* ---------------------------------------------------------------------- */
/* Current-project file results within 500 ms                             */
/* ---------------------------------------------------------------------- */

// A bounded live file corpus: 2000 file matches through the provider.
const fileDocuments = Array.from({ length: 2000 }, (_, i) => ({
  type: "match",
  data: {
    path: { text: `./src/lib/module-${i}.ts` },
    lines: { text: `export const composer = fn${i}();` },
    line_number: i + 1,
    submatches: [{ start: 20 }],
  },
}));
const filesProvider = createFileSearchProvider({
  activeProjectRoot: () => "/work/psyche",
  activeProjectId: () => "p1",
  sessionRoots: () => ["/work/psyche"],
  runSearch: async () => ({ stdout: fileDocuments.map((d) => JSON.stringify(d)).join("\n"), code: 0 }),
});
const fileQuery = parseSearchQuery("composer", {
  scopes: [{ dimension: "project", id: "p1", label: "Psyche Build", implicit: true }],
  naturalLanguage: false,
}).state;
const t1 = performance.now();
const fileOutcome = await runSearch(
  { query: fileQuery, context, now: NOW },
  { providers: [filesProvider], readIndexed },
);
const fileMs = performance.now() - t1;
console.log(`diagnostic: current-project files = ${fileMs.toFixed(1)} ms`);
assert.ok(fileOutcome.ok);
assert.ok(fileOutcome.results.length > 0, "file provider returns the scoped match");
assert.ok(fileMs < 500, `current-project files under 500 ms (measured ${fileMs.toFixed(1)} ms)`);

/* ---------------------------------------------------------------------- */
/* Fuzzy matching only over a bounded candidate set                        */
/* ---------------------------------------------------------------------- */

// Behavior: fuzzy is title-only, query-length-gated, and edit-distance-1.
assert.equal(withinEditDistance("composer", "composer", 1), true);
assert.equal(withinEditDistance("composer", "composr", 1), true);
assert.equal(withinEditDistance("composer", "compose", 1), true, "one deletion is within the bound");
assert.equal(withinEditDistance("composer", "compos", 1), false, "two deletions are beyond the bound");
const fuzzy = classifyMatch(
  { title: "Composr", body: "", tags: [] },
  { text: "composer", phrases: [] },
);
assert.ok(fuzzy.reasons.includes("fuzzy-title"), "one-edit title match earns the fuzzy reason");
const noFuzzy = classifyMatch(
  { title: "Compos", body: "", tags: [] },
  { text: "composer", phrases: [] },
);
assert.ok(!noFuzzy.reasons.includes("fuzzy-title"), "beyond one edit is not fuzzy — bounded candidates only");
// Structural: the store and coordinator never run fuzzy over the whole corpus.
const indexStoreSource = readFileSync(new URL("./search-index-store.ts", import.meta.url), "utf8");
assert.doesNotMatch(indexStoreSource, /withinEditDistance|fuzzyMatch/, "the FTS store never fuzzes its corpus");
assert.match(indexStoreSource, /MATCH/, "the store retrieves candidates via FTS MATCH first");

index.close();
rmSync(root, { recursive: true, force: true });

console.log("search-performance.test.ts: ok");
