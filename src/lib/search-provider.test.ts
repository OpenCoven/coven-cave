// @ts-nocheck
import assert from "node:assert/strict";
import {
  createProviderRegistry,
  permitsByProject,
  providerHonorsQuery,
  selectProviders,
} from "./search-provider.ts";
import {
  buildFileSearchArgs,
  createFileSearchProvider,
  FILE_PROVIDER_ID,
} from "./search-file-provider.ts";

const provider = (overrides = {}) => ({
  id: "tasks",
  kind: "indexed",
  entityTypes: ["task"],
  supportedFilters: ["type", "status", "project", "familiar", "tag"],
  fingerprint: async () => "fp",
  permits: () => true,
  ...overrides,
});

const unrestricted = { allowedProjectIds: null, allowedProjectRoots: null, familiarId: null };

/* ---------------------------------------------------------------------- */
/* Provider selection — the filtered-empty contract                        */
/* ---------------------------------------------------------------------- */

// A provider that cannot honor a filter must be EXCLUDED, not allowed to
// ignore it. Ignoring is how `status:blocked` starts returning projects, which
// have no status — the spec calls that silently widening.
{
  const tasks = provider();
  const projects = provider({
    id: "projects",
    entityTypes: ["project"],
    supportedFilters: ["type", "project", "tag"],
  });

  const statusQuery = {
    entityTypes: [],
    filters: [{ key: "status", operator: "is", value: "blocked", origin: "syntax" }],
  };
  assert.equal(providerHonorsQuery(tasks, statusQuery), true);
  assert.equal(
    providerHonorsQuery(projects, statusQuery),
    false,
    "a provider without status must be excluded rather than ignore the filter",
  );
  assert.deepEqual(
    selectProviders([tasks, projects], statusQuery).map((entry) => entry.id),
    ["tasks"],
  );
}

// Declaring a filter is not enough — it must also APPLY to an entity type the
// provider emits, or honoring it is vacuous.
{
  const projectsClaimingStatus = provider({
    id: "projects",
    entityTypes: ["project"],
    supportedFilters: ["type", "status"],
  });
  assert.equal(
    providerHonorsQuery(projectsClaimingStatus, {
      entityTypes: [],
      filters: [{ key: "status", operator: "is", value: "blocked", origin: "syntax" }],
    }),
    false,
    "status does not apply to projects, so claiming it must not win selection",
  );
}

// An entity-type scope narrows to providers that can emit it.
{
  const tasks = provider();
  const files = provider({ id: "files", entityTypes: ["file"], supportedFilters: ["type"] });
  assert.deepEqual(
    selectProviders([tasks, files], { entityTypes: ["file"], filters: [] }).map((e) => e.id),
    ["files"],
  );
}

/* ---------------------------------------------------------------------- */
/* Registry                                                                */
/* ---------------------------------------------------------------------- */

// Duplicate ids would collide on providerId+docId in the index, so one
// provider would silently overwrite the other's documents.
assert.throws(
  () => createProviderRegistry([provider(), provider()]),
  /duplicate search provider id: tasks/,
);

{
  const registry = createProviderRegistry([
    provider(),
    provider({ id: "files", kind: "live", entityTypes: ["file"], supportedFilters: ["type"] }),
  ]);
  assert.equal(registry.byId("files").kind, "live");
  assert.equal(registry.byId("missing"), null);
  assert.deepEqual(registry.indexed().map((e) => e.id), ["tasks"]);
  assert.deepEqual(registry.live().map((e) => e.id), ["files"]);
}

/* ---------------------------------------------------------------------- */
/* Permissions fail closed                                                 */
/* ---------------------------------------------------------------------- */

{
  const doc = {
    id: "t1", providerId: "tasks", entityType: "task", title: "", body: "", excerpt: "",
    projectId: "secret", projectRoot: null, familiarId: null, roomId: null, sessionId: null,
    runtime: null, status: null, tags: [], createdAt: null, updatedAt: null,
    sourceType: "tasks", permissions: [{ kind: "project", id: "secret" }],
    sourceVersion: "v", action: { id: "a", label: "" }, secondaryActions: [],
  };

  assert.equal(permitsByProject(doc, unrestricted), true, "unrestricted context sees everything");
  assert.equal(
    permitsByProject(doc, { ...unrestricted, allowedProjectIds: ["other"] }),
    false,
    "a project the requester has no entry for is hidden, not shown",
  );
  assert.equal(
    permitsByProject(doc, { ...unrestricted, allowedProjectIds: ["secret"] }),
    true,
  );

  const familiarDoc = { ...doc, permissions: [{ kind: "familiar", id: "cody" }], projectId: null };
  assert.equal(permitsByProject(familiarDoc, { ...unrestricted, familiarId: "nova" }), false);
  assert.equal(permitsByProject(familiarDoc, { ...unrestricted, familiarId: "cody" }), true);
}

/* ---------------------------------------------------------------------- */
/* File provider — the security-sensitive one                              */
/* ---------------------------------------------------------------------- */

// The argument array IS the injection defence: the query is data because it
// sits after `--`, never because it was escaped.
{
  const args = buildFileSearchArgs("--type=js -e evil");
  const separator = args.indexOf("--");
  assert.ok(separator > 0, "a bare -- separator must be present");
  assert.equal(
    args[separator + 1],
    "--type=js -e evil",
    "the query is the single argument after --, flags and all",
  );
  assert.equal(args[separator + 2], ".", "the search path follows the query");
  assert.ok(args.includes("--fixed-strings"), "queries are literal by default");
}

// `.env` exclusion survives at both depths.
{
  const args = buildFileSearchArgs("token");
  assert.ok(args.includes("!.env*"));
  assert.ok(args.includes("!**/.env*"));
}

// A root outside the allow-list and outside the daemon's session roots is
// refused, and the refusal names no path.
{
  let ran = false;
  const p = createFileSearchProvider({
    activeProjectRoot: () => "/definitely/not/allowed",
    activeProjectId: () => "proj",
    sessionRoots: () => [],
    runSearch: async () => { ran = true; return { stdout: "", code: 0 }; },
  });
  const { documents, diagnostics } = await p.query(
    { text: "needle", phrases: [], filters: [], projectIds: [], familiarIds: [], entityTypes: [], limit: 10 },
    unrestricted,
  );
  assert.equal(ran, false, "a refused root must not reach ripgrep at all");
  assert.deepEqual(documents, []);
  assert.equal(diagnostics[0].code, "permission-denied");
  // Check for PATH leakage specifically — an earlier version of this assertion
  // also banned the word "not", which the ordinary phrase "is not searchable"
  // trips. The contract is about paths, not vocabulary.
  assert.doesNotMatch(diagnostics[0].message, /\//, "a denial must not contain a path separator");
  assert.doesNotMatch(diagnostics[0].message, /definitely/, "nor any segment of the denied path");
}

// No active project is an empty result, NOT an error — a file result simply
// cannot exist yet, and a diagnostic here would read as a broken provider.
{
  const p = createFileSearchProvider({
    activeProjectRoot: () => null,
    activeProjectId: () => null,
    runSearch: async () => ({ stdout: "", code: 0 }),
  });
  const result = await p.query(
    { text: "needle", phrases: [], filters: [], projectIds: [], familiarIds: [], entityTypes: [], limit: 10 },
    unrestricted,
  );
  assert.deepEqual(result.documents, []);
  assert.deepEqual(result.diagnostics, []);
}

// An empty query does no work rather than matching everything.
{
  let ran = false;
  const p = createFileSearchProvider({
    activeProjectRoot: () => "/tmp",
    activeProjectId: () => "proj",
    sessionRoots: () => ["/tmp"],
    runSearch: async () => { ran = true; return { stdout: "", code: 0 }; },
  });
  const result = await p.query(
    { text: "  ", phrases: [], filters: [], projectIds: [], familiarIds: [], entityTypes: [], limit: 10 },
    unrestricted,
  );
  assert.equal(ran, false);
  assert.deepEqual(result.documents, []);
}

// A session root the daemon already booted is searchable — the route's second
// allowance, preserved.
{
  const events = [
    JSON.stringify({ type: "begin", data: { path: { text: "src/app.ts" } } }),
    JSON.stringify({
      type: "match",
      data: {
        path: { text: "src/app.ts" },
        lines: { text: "const needle = 1\n" },
        line_number: 12,
        submatches: [{ start: 6, end: 12 }],
      },
    }),
    JSON.stringify({ type: "end", data: { path: { text: "src/app.ts" } } }),
  ].join("\n");

  const p = createFileSearchProvider({
    activeProjectRoot: () => "/tmp",
    activeProjectId: () => "proj",
    sessionRoots: () => ["/tmp"],
    runSearch: async () => ({ stdout: events, code: 0 }),
  });
  const { documents } = await p.query(
    { text: "needle", phrases: [], filters: [], projectIds: [], familiarIds: [], entityTypes: [], limit: 10 },
    unrestricted,
  );
  assert.equal(documents.length, 1);
  const [doc] = documents;
  assert.equal(doc.providerId, FILE_PROVIDER_ID);
  assert.equal(doc.entityType, "file");
  assert.equal(doc.id, "src/app.ts", "the id is a RELATIVE path");
  assert.equal(doc.title, "app.ts");
  assert.equal(
    doc.projectRoot,
    null,
    "the absolute root is never emitted into a result payload",
  );
  assert.doesNotMatch(JSON.stringify(doc), /\/tmp/, "no absolute path anywhere in the document");
  assert.deepEqual(doc.permissions, [{ kind: "project", id: "proj" }]);
}

// A requester who cannot read the project gets nothing, and ripgrep is never
// spawned on their behalf.
{
  let ran = false;
  const p = createFileSearchProvider({
    activeProjectRoot: () => "/tmp",
    activeProjectId: () => "proj",
    sessionRoots: () => ["/tmp"],
    runSearch: async () => { ran = true; return { stdout: "", code: 0 }; },
  });
  const { documents, diagnostics } = await p.query(
    { text: "needle", phrases: [], filters: [], projectIds: [], familiarIds: [], entityTypes: [], limit: 10 },
    { ...unrestricted, allowedProjectIds: ["someone-else"] },
  );
  assert.equal(ran, false, "permission is checked BEFORE spawning a search");
  assert.deepEqual(documents, []);
  assert.equal(diagnostics[0].code, "permission-denied");
}

// A ripgrep failure is a safe category, never the raw error.
{
  const p = createFileSearchProvider({
    activeProjectRoot: () => "/tmp",
    activeProjectId: () => "proj",
    sessionRoots: () => ["/tmp"],
    runSearch: async () => { throw new Error("spawn rg ENOENT /secret/path"); },
  });
  const { documents, diagnostics } = await p.query(
    { text: "needle", phrases: [], filters: [], projectIds: [], familiarIds: [], entityTypes: [], limit: 10 },
    unrestricted,
  );
  assert.deepEqual(documents, []);
  assert.equal(diagnostics[0].code, "unavailable");
  assert.equal(diagnostics[0].message, "ripgrep is not installed");
  assert.doesNotMatch(diagnostics[0].message, /secret/, "the raw error must not leak");
}

// The file provider declares only filters it can honor, so it is not selected
// for a status query it would have to ignore.
{
  const p = createFileSearchProvider({
    activeProjectRoot: () => null,
    activeProjectId: () => null,
  });
  assert.equal(p.kind, "live", "file bodies are never indexed");
  assert.equal(
    providerHonorsQuery(p, {
      entityTypes: [],
      filters: [{ key: "status", operator: "is", value: "blocked", origin: "syntax" }],
    }),
    false,
  );
}

console.log("search-provider.test.ts: ok");
