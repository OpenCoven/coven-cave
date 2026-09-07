// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createServerSearchSetup,
  resetServerSearchIndexForTests,
} from "./search-runtime.ts";
import { runSearch } from "@/lib/search-coordinator";
import { broadenToGlobal, parseSearchQuery, searchQueryFromUrlParams, searchQueryToUrlParams } from "@/lib/search-query";
import { SEARCH_QUERY_VERSION } from "@/lib/search-filters";

// Fixture corpora: two projects, tasks and chats in both, two familiars.
const PROJECTS = [
  { id: "p1", name: "Psyche Build", root: "/work/psyche", repoUrl: "https://github.com/opencoven/psyche" },
  { id: "p2", name: "Coven", root: "/work/coven" },
];

const CARDS = [
  { id: "c1", title: "Fix composer button", notes: "rename the composer button", status: "blocked",
    priority: "high", familiarId: "cody", sessionId: null, projectId: "p1", labels: ["ux"],
    createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-09T00:00:00Z" },
  { id: "c2", title: "Ship search MVP", notes: "search units six and seven", status: "done",
    priority: "medium", familiarId: "val", sessionId: null, projectId: "p2", labels: [],
    createdAt: "2026-08-02T00:00:00Z", updatedAt: "2026-08-08T00:00:00Z" },
];

const CONVERSATIONS = [
  { sessionId: "s1", familiarId: "cody", title: "Composer work", status: "running", runtime: "codex",
    branch: "feat/composer", projectId: "p1", updatedAt: "2026-08-09T00:00:00Z" },
  { sessionId: "s2", familiarId: "val", title: "Coven planning", status: "closed", runtime: "claude",
    branch: "main", projectId: "p2", updatedAt: "2026-08-07T00:00:00Z" },
];

const FAMILIARS = [
  { id: "cody", display_name: "Cody" },
  { id: "val", display_name: "Valentina" },
];

const NOW = Date.parse("2026-08-10T00:00:00Z");

// Fake ripgrep output for a file match inside the scoped project.
const FILE_MATCH = [
  JSON.stringify({ type: "match", data: { path: { text: "./src/lib/composer.ts" }, lines: { text: "export const composer = renameComposer();" }, line_number: 12, submatches: [{ start: 22 }] } }),
].join("\n");

const loaders = {
  loadProjects: async () => PROJECTS,
  loadCards: async () => CARDS,
  listConversations: async () => CONVERSATIONS,
  listFamiliars: async () => FAMILIARS,
  sessionRoots: async () => ["/work/psyche"],
  runFileSearch: async () => ({ stdout: FILE_MATCH, code: 0 }),
};

let dir;
async function withTempIndex(fn) {
  dir = mkdtempSync(path.join(tmpdir(), "search-runtime-"));
  process.env.COVEN_CAVE_SEARCH_INDEX = path.join(dir, "search-index.sqlite");
  await resetServerSearchIndexForTests();
  try {
    await fn();
  } finally {
    await resetServerSearchIndexForTests();
    delete process.env.COVEN_CAVE_SEARCH_INDEX;
    rmSync(dir, { recursive: true, force: true });
  }
}

async function search(queryState, familiarId) {
  const setup = await createServerSearchSetup(
    queryState,
    { familiarId: familiarId ?? "cody", familiarIds: ["cody", "val"] },
    loaders,
  );
  return runSearch(
    { query: queryState, context: setup.requesterContext, now: NOW },
    { providers: setup.providers, readIndexed: setup.readIndexed },
  );
}

const ids = (outcome) => outcome.results.map((r) => `${r.providerId}:${r.document.id}`);

/* ---------------------------------------------------------------------- */
/* Default context: implicit scopes hard-constrain results                */
/* ---------------------------------------------------------------------- */

await withTempIndex(async () => {
  // Chat default context: type:chat inside the active project + familiar.
  const scoped = parseSearchQuery("type:chat", {
    scopes: [
      { dimension: "project", id: "p1", label: "Psyche Build", implicit: true },
      { dimension: "familiar", id: "cody", label: "Cody", implicit: true },
    ],
  });
  const outcome = await search(scoped.state, "cody");
  assert.equal(outcome.ok, true);
  assert.deepEqual(ids(outcome), ["sessions:s1"], "chat context returns only the scoped session");

  // Project default context: type:project inside the active project.
  const projects = parseSearchQuery("type:project", {
    scopes: [{ dimension: "project", id: "p1", label: "Psyche Build", implicit: true }],
  });
  const projectOutcome = await search(projects.state, "cody");
  assert.deepEqual(ids(projectOutcome), ["projects:p1"], "project scope keeps only the scoped project");

  // Familiar default context: type:familiar scoped to the active familiar.
  const familiars = parseSearchQuery("type:familiar", {
    scopes: [{ dimension: "familiar", id: "cody", label: "Cody", implicit: true }],
  });
  const familiarOutcome = await search(familiars.state, "cody");
  assert.deepEqual(ids(familiarOutcome), ["familiars:cody"], "familiar scope keeps only the active familiar");
});

/* ---------------------------------------------------------------------- */
/* Explicit global broadening: Cmd/Ctrl+Enter drops implicit scopes,       */
/* keeps explicit filters, and boosts former-context matches              */
/* ---------------------------------------------------------------------- */

await withTempIndex(async () => {
  const scoped = parseSearchQuery("type:chat", {
    scopes: [
      { dimension: "project", id: "p1", label: "Psyche Build", implicit: true },
      { dimension: "familiar", id: "cody", label: "Cody", implicit: true },
    ],
  });
  const broadened = broadenToGlobal(scoped.state);
  // The broadening contract: only implicit scopes go; the type filter stays.
  assert.deepEqual(broadened.scopes, [], "broadening removes every implicit scope");
  assert.deepEqual(broadened.filters.map((f) => f.key), ["type"], "explicit filters survive broadening");

  const outcome = await search(broadened, "cody");
  assert.equal(outcome.ok, true);
  const resultIds = ids(outcome);
  assert.ok(resultIds.includes("sessions:s1"), "former-context chat still present after broadening");
  assert.ok(resultIds.includes("sessions:s2"), "broader chat appears after broadening");

  // Former-context boost: the s1 chat (still in the former project/familiar)
  // outranks the s2 chat within the same evidence tier.
  const s1 = outcome.results.find((r) => r.document.id === "s1");
  const s2 = outcome.results.find((r) => r.document.id === "s2");
  assert.ok(s1.score > s2.score, "former-context match gets the rank boost");
});

/* ---------------------------------------------------------------------- */
/* Shared-link restoration: canonical params round-trip to the same state */
/* ---------------------------------------------------------------------- */

await withTempIndex(async () => {
  const original = parseSearchQuery("type:chat blocked", { scopes: [] });
  const params = searchQueryToUrlParams(original.state);
  const restored = searchQueryFromUrlParams(params);
  assert.equal(restored.version, SEARCH_QUERY_VERSION);
  assert.equal(restored.text, "blocked");
  assert.deepEqual(restored.filters.map((f) => `${f.key}=${f.value}`).sort(), ["type=chat"]);
  // The restored state searches the same corpus with the same result.
  const direct = await search(original.state, "cody");
  const viaLink = await search(restored, "cody");
  assert.deepEqual(ids(viaLink), ids(direct), "shared link restores the same results");
});

/* ---------------------------------------------------------------------- */
/* Truthful filtered-empty: no provider can honor the filter              */
/* ---------------------------------------------------------------------- */

await withTempIndex(async () => {
  // status applies to tasks/sessions/chats — never projects. Asking for
  // blocked projects must not silently widen into "all projects".
  const state = parseSearchQuery("type:project status:blocked", { scopes: [] });
  const outcome = await search(state.state, "cody");
  assert.equal(outcome.ok, true);
  assert.equal(outcome.emptyReason, "filtered-empty");
  assert.deepEqual(outcome.results, []);
});

/* ---------------------------------------------------------------------- */
/* Files: live provider answers within the scoped project only            */
/* ---------------------------------------------------------------------- */

await withTempIndex(async () => {
  const state = parseSearchQuery("composer", {
    scopes: [{ dimension: "project", id: "p1", label: "Psyche Build", implicit: true }],
  });
  const outcome = await search(state.state, "cody");
  const fileResult = outcome.results.find((r) => r.providerId === "files");
  assert.ok(fileResult, "file provider returns the scoped project match");
  assert.equal(fileResult.document.title, "composer.ts");
  assert.equal(fileResult.document.projectId, "p1");

  // No project scope -> no file corpus, and that is NOT an error.
  const global = parseSearchQuery("composer", { scopes: [] });
  const globalOutcome = await search(global.state, "cody");
  assert.ok(!ids(globalOutcome).some((id) => id.startsWith("files:")), "no project scope, no file results");
});

/* ---------------------------------------------------------------------- */
/* Permissions: familiar context fails closed for familiar-scoped rows    */
/* ---------------------------------------------------------------------- */

await withTempIndex(async () => {
  const state = parseSearchQuery("type:chat", { scopes: [] });
  // No familiar context: every chat belongs to a familiar, so nothing passes.
  const setup = await createServerSearchSetup(state.state, { familiarId: null }, loaders);
  const outcome = await runSearch(
    { query: state.state, context: setup.requesterContext, now: NOW },
    { providers: setup.providers, readIndexed: setup.readIndexed },
  );
  assert.ok(outcome.ok);
  assert.equal(outcome.emptyReason, "permission-denied", "no familiar context denies familiar-scoped chats");
});


/* ---------------------------------------------------------------------- */
/* Roster-wide familiar access: the local user owns their roster          */
/* ---------------------------------------------------------------------- */

await withTempIndex(async () => {
  const state = parseSearchQuery("type:chat", { scopes: [] });
  const setup = await createServerSearchSetup(
    state.state,
    { familiarId: null, familiarIds: ["cody", "val"] },
    loaders,
  );
  const outcome = await runSearch(
    { query: state.state, context: setup.requesterContext, now: NOW },
    { providers: setup.providers, readIndexed: setup.readIndexed },
  );
  assert.ok(outcome.ok);
  assert.deepEqual(
    ids(outcome).sort(),
    ["sessions:s1", "sessions:s2"].sort(),
    "roster-wide access keeps every familiar's chats reachable globally",
  );
});

console.log("search-runtime.test.ts: ok");
