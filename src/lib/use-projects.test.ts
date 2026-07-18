// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./use-projects.ts", import.meta.url), "utf8");

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

assert.match(
  source,
  /createProjectOrThrow: \(name: string, root: string\) => Promise<CaveProject>;/,
  "ProjectsState exposes a throwing createProject variant for callers that need actionable API errors",
);

assert.match(
  source,
  /const applyCreatedProject = useCallback\(\(project: CaveProject\): CaveProject => \{[\s\S]*invalidateProjectsCache\(\);[\s\S]*setProjects\(\(prev\) => sortProjectsAlphabetically\(\[\.\.\.prev, project\]\)\);[\s\S]*return project;/,
  "successful project creation shares one cache-invalidating local-state update path",
);

assert.match(
  source,
  /const requestCreateProject = useCallback\(async \(name: string, root: string\): Promise<CreateProjectResult> => \{/,
  "createProject and createProjectOrThrow share one request path",
);

assert.match(
  source,
  /error: typeof data\?\.error === "string" \? data\.error : `Could not create project \(HTTP \$\{res\.status\}\)`/,
  "the throwing create path preserves the safe API error string or falls back to a clear HTTP message",
);

assert.match(
  source,
  /const createProject = useCallback\(async \(name: string, root: string\): Promise<CaveProject \| null> => \{[\s\S]*const result = await requestCreateProject\(name, root\);[\s\S]*return result\.ok \? result\.project : null;/,
  "the existing createProject API stays nullable/back-compatible for current callers",
);

assert.match(
  source,
  /const createProjectOrThrow = useCallback\(async \(name: string, root: string\): Promise<CaveProject> => \{[\s\S]*const result = await requestCreateProject\(name, root\);[\s\S]*if \(result\.ok\) return result\.project;[\s\S]*throw new Error\(result\.error\);/,
  "createProjectOrThrow reuses the shared mutation path and throws the actionable error text",
);

assert.match(
  source,
  /return \{[\s\S]*createProject,[\s\S]*createProjectOrThrow,[\s\S]*renameProject,/,
  "the hook returns both the nullable and throwing create helpers",
);

console.log("use-projects.test.ts: ok");
