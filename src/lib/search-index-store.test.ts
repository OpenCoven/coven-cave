// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  openSearchIndex,
  searchIndexPath,
  SEARCH_INDEX_SCHEMA_VERSION,
} from "./search-index-store.ts";
import { normalizeSearchDocument, searchDocumentKey } from "./search-document.ts";

const root = mkdtempSync(path.join(tmpdir(), "cave-search-index-"));
const dbPath = (name) => path.join(root, `${name}.sqlite`);

function doc(overrides = {}) {
  return {
    id: "task-1",
    providerId: "tasks",
    entityType: "task",
    title: "Composer rename",
    body: "Rename the composer button",
    excerpt: "Rename the composer button",
    projectId: "coven-cave",
    projectRoot: "/repo",
    familiarId: "cody",
    roomId: null,
    sessionId: null,
    runtime: null,
    status: "blocked",
    tags: ["ux"],
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
    sourceType: "tasks",
    permissions: [{ kind: "project", id: "coven-cave" }],
    sourceVersion: "v1",
    action: { id: "open-task", label: "Open task", href: "/tasks/task-1" },
    secondaryActions: [],
    ...overrides,
  };
}

/* ---------------------------------------------------------------------- */
/* Document normalization                                                  */
/* ---------------------------------------------------------------------- */

// A malformed row loses its own fidelity rather than throwing — one bad
// document must not abort a refresh and leave every other row stale.
assert.equal(normalizeSearchDocument(null), null);
assert.equal(normalizeSearchDocument({ id: "x" }), null);
assert.equal(normalizeSearchDocument({ id: "x", providerId: "p" }), null);
{
  const normalized = normalizeSearchDocument({ id: "x", providerId: "p", entityType: "task" });
  assert.equal(normalized.title, "", "missing text becomes empty, never undefined, so FTS sees no null");
  assert.deepEqual(normalized.tags, []);
  assert.deepEqual(normalized.permissions, []);
  assert.equal(normalized.action.id, "x:open");
}
assert.equal(searchDocumentKey({ providerId: "tasks", id: "task-1" }), "tasks\u0000task-1");
assert.notEqual(
  searchDocumentKey({ providerId: "a b", id: "c" }),
  searchDocumentKey({ providerId: "a", id: "b c" }),
  "the separator must not let two different identities collide",
);

/* ---------------------------------------------------------------------- */
/* Schema, permissions, and symlink refusal                                */
/* ---------------------------------------------------------------------- */

{
  const file = dbPath("basic");
  const index = await openSearchIndex(file);
  assert.equal(index.documentCount(), 0);
  assert.equal((statSync(file).mode & 0o777), 0o600, "index file is private (0600)");
  index.close();

  // Reopening an existing database migrates idempotently rather than failing.
  const again = await openSearchIndex(file);
  assert.equal(again.documentCount(), 0);
  again.close();
  assert.equal(SEARCH_INDEX_SCHEMA_VERSION, 1);
}

// A symlinked path is a redirection of where we write. Refuse, do not follow.
{
  const target = dbPath("symlink-target");
  writeFileSync(target, "");
  const link = dbPath("symlink-link");
  symlinkSync(target, link);
  await assert.rejects(() => openSearchIndex(link), /must not be a symlink/);
}

// The path is overridable, which is what lets a backup builder exclude it.
{
  const previous = process.env.COVEN_CAVE_SEARCH_INDEX;
  process.env.COVEN_CAVE_SEARCH_INDEX = "/tmp/example-search-index.sqlite";
  assert.equal(searchIndexPath(), "/tmp/example-search-index.sqlite");
  if (previous === undefined) delete process.env.COVEN_CAVE_SEARCH_INDEX;
  else process.env.COVEN_CAVE_SEARCH_INDEX = previous;
}

/* ---------------------------------------------------------------------- */
/* Refresh: upsert, fingerprint skip, deletion                             */
/* ---------------------------------------------------------------------- */

{
  const index = await openSearchIndex(dbPath("refresh"));

  const first = index.refreshProvider("tasks", "fp-1", () => [doc()]);
  assert.equal(first.skipped, false);
  assert.equal(first.upserted, 1);
  assert.equal(index.documentCount(), 1);

  // An unchanged fingerprint skips the scan entirely. This is the whole reason
  // providers carry one.
  let collected = 0;
  const second = index.refreshProvider("tasks", "fp-1", () => {
    collected += 1;
    return [doc()];
  });
  assert.equal(second.skipped, true);
  assert.equal(collected, 0, "an unchanged fingerprint must not even collect");

  // A moved fingerprint rescans, and an unchanged row inside it is left alone
  // because the provider's own sourceVersion did not move.
  const third = index.refreshProvider("tasks", "fp-2", () => [doc()]);
  assert.equal(third.skipped, false);
  assert.equal(third.upserted, 0, "sourceVersion unchanged means no rewrite");

  // A changed sourceVersion rewrites the row.
  const fourth = index.refreshProvider("tasks", "fp-3", () => [
    doc({ title: "Composer rename v2", sourceVersion: "v2" }),
  ]);
  assert.equal(fourth.upserted, 1);
  assert.equal(index.match({ text: "v2" }).length, 1);

  // A document the source stops producing must leave the index, or a deleted
  // task answers searches forever.
  const fifth = index.refreshProvider("tasks", "fp-4", () => []);
  assert.equal(fifth.removed, 1);
  assert.equal(index.documentCount(), 0);
  assert.equal(index.match({ text: "composer" }).length, 0, "FTS rows are removed too");

  index.close();
}

// A row that fails to normalize must lose ONLY its own fidelity. It still
// counts as "the source produced this id", or the deletion pass reads it as
// withdrawn and drops the last good copy — and a provider whose rows all fail
// would clear itself entirely.
{
  const index = await openSearchIndex(dbPath("malformed"));
  index.refreshProvider("tasks", "fp-1", () => [doc(), doc({ id: "task-2", title: "Sidebar polish", body: "Adjust the rail", excerpt: "Adjust the rail", sourceVersion: "z" })]);
  assert.equal(index.documentCount(), 2);

  // entityType missing => normalizeSearchDocument returns null, but the row
  // still identifies itself.
  const outcome = index.refreshProvider("tasks", "fp-2", () => [
    { id: "task-1", providerId: "tasks" },
    doc({ id: "task-2", title: "Sidebar polish", body: "Adjust the rail", excerpt: "Adjust the rail", sourceVersion: "z" }),
  ]);
  assert.equal(outcome.removed, 0, "a malformed row must not be read as a deletion");
  assert.equal(index.documentCount(), 2, "the previously indexed copy survives");
  assert.equal(index.match({ text: "composer" }).length, 1, "and stays searchable");

  // Every row malformed must not empty the provider.
  const allBad = index.refreshProvider("tasks", "fp-3", () => [
    { id: "task-1", providerId: "tasks" },
    { id: "task-2", providerId: "tasks" },
  ]);
  assert.equal(allBad.removed, 0);
  assert.equal(index.documentCount(), 2, "a wholly malformed scan must not clear the provider");

  // A row that identifies nothing cannot be protected, and a genuine
  // withdrawal still deletes.
  const withdrawn = index.refreshProvider("tasks", "fp-4", () => [doc()]);
  assert.equal(withdrawn.removed, 1, "a genuinely withdrawn document is still removed");
  index.close();
}

/* ---------------------------------------------------------------------- */
/* Failed refresh keeps the last verified snapshot and marks it stale      */
/* ---------------------------------------------------------------------- */

{
  const index = await openSearchIndex(dbPath("stale"));
  index.refreshProvider("tasks", "fp-1", () => [doc()]);
  assert.equal(index.providerState("tasks").stale, false);

  const failed = index.refreshProvider("tasks", "fp-2", () => {
    throw new Error("source unavailable");
  });
  assert.equal(failed.stale, true);
  assert.match(failed.error, /source unavailable/);

  // The point: the previous snapshot is intact and searchable, just flagged.
  assert.equal(index.documentCount(), 1, "a failed refresh must not empty the index");
  const state = index.providerState("tasks");
  assert.equal(state.stale, true);
  assert.equal(
    state.fingerprint,
    "fp-1",
    "the recorded fingerprint stays at the last COMPLETED refresh — it describes which snapshot the surviving rows came from, and must not advance to the one that failed",
  );
  assert.equal(index.match({ text: "composer" })[0].stale, true, "rows report their staleness");

  // A stale provider is never skipped, even if the fingerprint matches.
  const recovered = index.refreshProvider("tasks", "fp-1", () => [doc()]);
  assert.equal(recovered.skipped, false, "a stale provider must re-scan");
  assert.equal(index.providerState("tasks").stale, false);

  index.close();
}

// A partial failure mid-collection rolls back rather than half-updating.
{
  const index = await openSearchIndex(dbPath("rollback"));
  index.refreshProvider("tasks", "fp-1", () => [doc()]);
  index.refreshProvider("tasks", "fp-2", () => ({
    *[Symbol.iterator]() {
      yield doc({ id: "task-2", title: "Second", sourceVersion: "v9" });
      throw new Error("collection blew up halfway");
    },
  }));
  assert.equal(index.documentCount(), 1, "the half-written second document is rolled back");
  assert.equal(index.match({ text: "Second" }).length, 0);
  index.close();
}

/* ---------------------------------------------------------------------- */
/* Corruption is quarantined and rebuilt, never repaired                   */
/* ---------------------------------------------------------------------- */

{
  const file = dbPath("corrupt");
  const index = await openSearchIndex(file);
  index.refreshProvider("tasks", "fp-1", () => [doc()]);
  index.close();

  writeFileSync(file, "this is not a sqlite database at all");

  const reopened = await openSearchIndex(file);
  assert.equal(reopened.documentCount(), 0, "a corrupt index rebuilds empty rather than failing");
  assert.equal(existsSync(`${file}.corrupt`), true, "the damaged file is kept as evidence");
  // And it is immediately usable again.
  reopened.refreshProvider("tasks", "fp-1", () => [doc()]);
  assert.equal(reopened.documentCount(), 1);
  reopened.close();
}

/* ---------------------------------------------------------------------- */
/* Matching: FTS plus metadata filters                                     */
/* ---------------------------------------------------------------------- */

{
  const index = await openSearchIndex(dbPath("match"));
  index.refreshProvider("tasks", "fp-1", () => [
    doc({ id: "t1", title: "Composer rename", status: "blocked", sourceVersion: "a" }),
    doc({
      id: "t2",
      title: "Sidebar polish",
      body: "Adjust the rail",
      status: "open",
      familiarId: "nova",
      sourceVersion: "b",
    }),
  ]);
  index.refreshProvider("projects", "fp-1", () => [
    doc({
      id: "p1",
      providerId: "projects",
      entityType: "project",
      title: "Coven Cave",
      body: "The desktop app",
      status: null,
      sourceType: "projects",
      sourceVersion: "c",
    }),
  ]);

  assert.equal(index.documentCount(), 3);
  assert.equal(index.match({ text: "composer" }).length, 1);
  assert.equal(index.match({ text: "rail" }).length, 1);
  // Prefix matching, so results appear while typing.
  assert.equal(index.match({ text: "compo" }).length, 1);
  // Tags are indexed.
  assert.equal(index.match({ text: "ux" }).length >= 1, true);

  // Metadata filters narrow without touching FTS.
  assert.equal(index.match({ entityTypes: ["project"] }).length, 1);
  assert.equal(index.match({ statuses: ["blocked"] }).length, 1);
  assert.equal(index.match({ familiarIds: ["nova"] }).length, 1);
  assert.equal(index.match({ providerIds: ["projects"] }).length, 1);
  // Combined.
  assert.equal(index.match({ text: "composer", statuses: ["open"] }).length, 0);

  // A quoted phrase requires the whole phrase.
  assert.equal(index.match({ phrases: ["Composer rename"] }).length, 1);
  assert.equal(index.match({ phrases: ["rename Composer"] }).length, 0);

  // A term with FTS syntax in it is escaped rather than executed.
  assert.doesNotThrow(() => index.match({ text: 'weird" OR title:x' }));
  assert.doesNotThrow(() => index.match({ text: "NEAR(" }));

  // Documents round trip intact through storage.
  const [row] = index.match({ text: "composer" });
  assert.equal(row.document.action.href, "/tasks/task-1");
  assert.deepEqual(row.document.tags, ["ux"]);
  assert.deepEqual(row.document.permissions, [{ kind: "project", id: "coven-cave" }]);
  assert.equal(row.stale, false);

  // The limit is bounded regardless of what a caller asks for.
  assert.equal(index.match({ limit: 100000 }).length <= 500, true);

  index.rebuild();
  assert.equal(index.documentCount(), 0, "rebuild drops everything — the index is derivative");
  assert.equal(index.providerState("tasks"), null);
  index.close();
}

rmSync(root, { recursive: true, force: true });
console.log("search-index-store.test.ts: ok");
