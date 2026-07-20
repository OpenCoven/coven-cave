// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./use-projects.ts", import.meta.url), "utf8");
const cacheSource = readFileSync(new URL("./use-projects-cache.ts", import.meta.url), "utf8");
const mutationSource = readFileSync(new URL("./project-registry-mutation.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ emitProjectRegistryMutation, subscribeProjectRegistryMutation \} from "\.\/project-registry-events\.ts";/,
  "useProjects imports the shared project-registry notification helpers",
);
assert.match(
  source,
  /import \{ applyProjectRegistryMutation \} from "\.\/project-registry-mutation\.ts";/,
  "useProjects imports the shared optimistic mutation reducer",
);
assert.match(
  source,
  /import \{ clearProjectsCache, fetchProjectsFromCache, type ProjectsPayload \} from "\.\/use-projects-cache\.ts";/,
  "useProjects imports the shared project cache helper",
);

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
// mount. Mutations advance the shared cache generation exactly once so every
// subscriber re-reads through the same deduped generation, and reload() still
// bypasses the current generation entry.
assert.match(
  cacheSource,
  /projectsCache\.get\(key, \(\) => requestProjects\(familiarId\)\)/,
  "loads go through the shared projects microcache",
);
assert.match(
  cacheSource,
  /let projectsGeneration = 0;/,
  "the cache tracks a shared generation across scopes",
);
assert.match(
  cacheSource,
  /function generationKey\(familiarId: string \| null\): string \{\s*return `\$\{projectsGeneration\}:\$\{familiarId \?\? ""\}`;\s*\}/,
  "cache keys are partitioned by the shared mutation generation and the familiar scope",
);
assert.match(
  cacheSource,
  /export function advanceProjectsCacheGeneration\(\): number \{\s*projectsGeneration \+= 1;\s*projectsCache\.clear\(\);\s*return projectsGeneration;\s*\}/,
  "one shared generation advance clears old entries once per emitted mutation",
);
assert.match(
  cacheSource,
  /if \(opts\?\.force\) projectsCache\.invalidate\(key\);/,
  "force drops the cached scope before refetching",
);
assert.match(
  source,
  /return fetchProjectsFromCache\(familiarId, opts\);/,
  "the hook delegates loads to the shared project-cache helper",
);
assert.match(
  source,
  /void load\(\{ force: true \}\);/,
  "reload() bypasses the microcache",
);
assert.equal(
  (source.match(/emitProjectRegistryMutation\(\);/g) ?? []).length,
  4,
  "four successful non-delete mutations still notify every mounted projects hook scope with a generic refresh",
);
assert.match(
  source,
  /emitProjectRegistryMutation\(\{ kind: "delete", projectId: id \}\);/,
  "successful deletes emit a typed delete mutation",
);
assert.match(
  mutationSource,
  /export function applyProjectRegistryMutation\(projects: CaveProject\[], mutation: ProjectRegistryMutation\): CaveProject\[] \{\s*return mutation\.kind === "delete"\s*\? projects\.filter\(\(project\) => project\.id !== mutation\.projectId\)\s*:\s*projects;\s*\}/,
  "typed delete mutations have a shared optimistic local-state reducer",
);
assert.match(
  source,
  /useEffect\(\(\) => \{\s*if \(!enabled\) return;\s*return subscribeProjectRegistryMutation\(\(\{ mutation \}\) => \{[\s\S]*setProjects\(\(prev\) => applyProjectRegistryMutation\(prev, mutation\)\);[\s\S]*void load\(\);[\s\S]*\}\);\s*\}, \[enabled, load\]\);/,
  "each enabled hook instance applies the optimistic mutation locally before reloading through the shared cache generation",
);

assert.match(
  source,
  /createProjectOrThrow: \(name: string, root: string, options\?: CreateProjectOptions\) => Promise<CaveProject>;/,
  "ProjectsState exposes a throwing createProject variant for callers that need actionable API errors",
);

assert.match(
  source,
  /const applyCreatedProject = useCallback\(\(project: CaveProject, options\?: CreateProjectOptions\): CaveProject => \{[\s\S]*setProjects\(\(prev\) => sortProjectsAlphabetically\(\[\.\.\.prev, project\]\)\);[\s\S]*if \(options\?\.emitMutation !== false\) emitProjectRegistryMutation\(\);[\s\S]*return project;/,
  "successful project creation shares one local-state path that fans out through the shared mutation event",
);

assert.match(
  source,
  /const requestCreateProject = useCallback\(async \(name: string, root: string, options\?: CreateProjectOptions\): Promise<CreateProjectResult> => \{/,
  "createProject and createProjectOrThrow share one request path",
);

assert.match(
  source,
  /const \[loadedSuccessfully, setLoadedSuccessfully\] = useState\(false\);/,
  "useProjects tracks whether the current scope has ever completed a successful load",
);
assert.match(
  source,
  /if \(data\.ok === false\) \{[\s\S]*setError\(data\.error \?\? "Failed to load projects"\);[\s\S]*\} else \{[\s\S]*setProjects\(sortProjectsAlphabetically\(Array\.isArray\(data\.projects\) \? data\.projects : \[\]\)\);[\s\S]*setLoadedSuccessfully\(true\);[\s\S]*\}/,
  "loadedSuccessfully only flips true after a successful payload, not on error payloads",
);
assert.match(
  source,
  /catch \(err\) \{\s*if \(generationRef\.current === gen\) \{\s*setError\(err instanceof Error \? err\.message : "Failed to load projects"\);\s*\}\s*\}/,
  "later refresh failures only surface the error and do not clear the sticky successful-load flag",
);
assert.match(
  source,
  /return \{[\s\S]*loading,[\s\S]*error,[\s\S]*loadedSuccessfully,[\s\S]*reload,/,
  "the hook returns loadedSuccessfully so callers can distinguish first-settle from verified-success",
);

assert.match(
  source,
  /error: typeof data\?\.error === "string" \? data\.error : `Could not create project \(HTTP \$\{res\.status\}\)`/,
  "the throwing create path preserves the safe API error string or falls back to a clear HTTP message",
);

assert.match(
  source,
  /const createProject = useCallback\(async \(name: string, root: string, options\?: CreateProjectOptions\): Promise<CaveProject \| null> => \{[\s\S]*const result = await requestCreateProject\(name, root, options\);[\s\S]*return result\.ok \? result\.project : null;/,
  "the existing createProject API stays nullable/back-compatible for current callers",
);

assert.match(
  source,
  /const createProjectOrThrow = useCallback\(async \(name: string, root: string, options\?: CreateProjectOptions\): Promise<CaveProject> => \{[\s\S]*const result = await requestCreateProject\(name, root, options\);[\s\S]*if \(result\.ok\) return result\.project;[\s\S]*throw new Error\(result\.error\);/,
  "createProjectOrThrow reuses the shared mutation path and throws the actionable error text",
);

assert.match(
  source,
  /return \{[\s\S]*createProject,[\s\S]*createProjectOrThrow,[\s\S]*renameProject,/,
  "the hook returns both the nullable and throwing create helpers",
);

// createProject: server failures/malformed payloads surface an actionable
// error. createProjectOrThrow reuses requestCreateProject and rethrows that
// error string; the nullable createProject returns null on the same failures.
// (Source-text assertions: useProjects is a React hook and cannot be invoked
// headlessly here, matching the rest of this file's verification style.)
assert.match(
  source,
  /error: typeof data\?\.error === "string" \? data\.error : `Could not create project \(HTTP \$\{res\.status\}\)`/,
  "a server error string is preserved, otherwise an HTTP-status fallback message is used",
);
assert.match(
  source,
  /error: error instanceof Error \? error\.message : "Could not create that project\."/,
  "network/exception failures surface an actionable fallback error",
);
assert.match(
  source,
  /const createProjectOrThrow = useCallback[\s\S]*?const result = await requestCreateProject\(name, root, options\);[\s\S]*?if \(result\.ok\) return result\.project;[\s\S]*?throw new Error\(result\.error\);/,
  "createProjectOrThrow reuses the shared mutation path and throws the actionable error text",
);
assert.match(
  source,
  /const createProject = useCallback[\s\S]*?const result = await requestCreateProject\(name, root, options\);[\s\S]*?return result\.ok \? result\.project : null;/,
  "the nullable createProject returns null on failure and the created project on success",
);
assert.match(
  source,
  /return \{ ok: true, project: applyCreatedProject\(data\.project as CaveProject, options\) \};/,
  "a successful create applies the new project through the shared optimistic reducer",
);

console.log("use-projects.test.ts: ok");
