// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./use-projects.ts", import.meta.url), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function extractCreateProject(sourceText) {
  const match = sourceText.match(
    /const createProject = useCallback\(async \(name: string, root: string\): Promise<CaveProject \| null> => \{([\s\S]*?)\n\s*\}, \[\]\);/,
  );
  assert.ok(match, "createProject callback should remain in use-projects.ts");
  const body = match[1].replace(/\s+as ProjectsPayload \| null/g, "");
  return new AsyncFunction("fetch", "invalidateProjectsCache", "setProjects", "sortProjectsAlphabetically", "name", "root", body);
}

async function runCreateProject({
  response,
  previousProjects = [],
  name = "Beta",
  root = "/beta",
}) {
  const requests = [];
  const invalidations = [];
  const updates = [];
  const createProject = extractCreateProject(source);
  const result = await createProject(
    async (url, init) => {
      requests.push([url, init]);
      return response;
    },
    () => invalidations.push("invalidate"),
    (updater) => {
      updates.push(updater(previousProjects));
    },
    (projects) => [...projects].sort((a, b) => a.name.localeCompare(b.name)),
    name,
    root,
  );
  return { result, requests, invalidations, updates };
}

// When the scope (familiarId) changes or the hook re-enables, the previous
// scope's list must be dropped before the refetch resolves. Otherwise a
// familiar-scoped consumer (new-card modal, command palette) keeps showing —
// and lets the user pick — another familiar's projects during the in-flight
// request, which then 403s at the board chat-launch (assertProjectAccess).
assert.match(
  source,
  /setProjects\(\[\]\);\s*\n\s*load\(\);/,
  "useProjects clears the retained list before refetching on a scope/enable change",
);

// The clear must live in the [enabled, load] effect (load is memoized on
// familiarId), NOT inside load() itself — a manual reload() after a mutation
// calls load() directly and must not blank the list mid-refresh.
assert.doesNotMatch(
  source,
  /setLoading\(true\);\s*\n\s*setError\(null\);\s*\n\s*setProjects\(\[\]\)/,
  "the reset lives in the effect, not in load(), so in-place reload() never blanks the list",
);

// cave-v8hh: GET /api/projects is deduped through a module-level microcache —
// the hook's 8+ consumers used to fire one identical request each on a surface
// mount. Mutations must drop the cache (every scope) so no consumer can be
// served a pre-mutation list, and reload() must bypass it.
assert.match(
  source,
  /projectsCache\.get\(key, \(\) => requestProjects\(familiarId\)\)/,
  "loads go through the shared projects microcache",
);
assert.match(
  source,
  /if \(opts\?\.force\) projectsCache\.invalidate\(key\);/,
  "force drops the cached scope before refetching",
);
assert.match(
  source,
  /void load\(\{ force: true \}\);/,
  "reload() bypasses the microcache",
);
assert.equal(
  (source.match(/invalidateProjectsCache\(\);/g) ?? []).length,
  5,
  "all five mutations (create/rename/updateRoot/updateColor/delete) invalidate the cache",
);

// createProject: server failures/malformed payloads throw, preserving a string
// server error when present.
await assert.rejects(
  runCreateProject({
    response: {
      ok: false,
      status: 403,
      json: async () => ({ ok: false, error: "Choose a folder inside a configured Cave workspace." }),
    },
  }),
  /Choose a folder inside a configured Cave workspace\./,
);
await assert.rejects(
  runCreateProject({
    response: {
      ok: true,
      status: 422,
      json: async () => ({ ok: false, error: "Name is required." }),
    },
  }),
  /Name is required\./,
);
await assert.rejects(
  runCreateProject({
    response: {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    },
  }),
  /Failed to create project \(200\)/,
);
await assert.rejects(
  runCreateProject({
    response: {
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("bad json");
      },
    },
  }),
  /Failed to create project \(500\)/,
);

// Success returns the created project, invalidates the list cache, and appends
// the new row via the shared alphabetical sort.
{
  const previousProjects = [
    { id: "g", name: "Gamma", root: "/gamma" },
    { id: "a", name: "Alpha", root: "/alpha" },
  ];
  const responseProject = { id: "b", name: "Beta", root: "/beta" };
  const { result, requests, invalidations, updates } = await runCreateProject({
    previousProjects,
    response: {
      ok: true,
      status: 201,
      json: async () => ({ ok: true, project: responseProject }),
    },
  });
  assert.deepEqual(result, responseProject);
  assert.equal(requests[0][0], "/api/projects");
  assert.equal(invalidations.length, 1);
  assert.deepEqual(updates, [[previousProjects[1], responseProject, previousProjects[0]]]);
}

console.log("use-projects.test.ts: ok");
