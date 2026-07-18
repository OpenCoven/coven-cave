// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./use-projects.ts", import.meta.url), "utf8");
const cacheSource = readFileSync(new URL("./use-projects-cache.ts", import.meta.url), "utf8");

assert.match(
  source,
  /import \{ emitProjectRegistryMutation, subscribeProjectRegistryReload \} from "\.\/project-registry-events\.ts";/,
  "useProjects imports the shared project-registry notification helpers",
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
  5,
  "all five successful mutations notify every mounted projects hook scope",
);
assert.match(
  source,
  /useEffect\(\(\) => \{\s*if \(!enabled\) return;\s*return subscribeProjectRegistryReload\(\(\) => load\(\)\);\s*\}, \[enabled, load\]\);/,
  "each enabled hook instance subscribes to shared project-registry notifications and re-reads through the new shared generation",
);

assert.match(
  source,
  /createProjectOrThrow: \(name: string, root: string, options\?: CreateProjectOptions\) => Promise<CaveProject>;/,
  "ProjectsState exposes a throwing createProject variant for callers that need actionable API errors",
);

assert.match(
  source,
  /const applyCreatedProject = useCallback\(\(project: CaveProject, emitMutation = true\): CaveProject => \{[\s\S]*setProjects\(\(prev\) => sortProjectsAlphabetically\(\[\.\.\.prev, project\]\)\);[\s\S]*if \(emitMutation\) emitProjectRegistryMutation\(\);[\s\S]*return project;/,
  "successful project creation shares one local-state path with optional bundled-mutation notification suppression",
);

assert.match(
  source,
  /const requestCreateProject = useCallback\(async \([\s\S]*options\?: CreateProjectOptions,[\s\S]*\): Promise<CreateProjectResult> => \{/,
  "createProject and createProjectOrThrow share one request path",
);

assert.match(
  source,
  /error: typeof data\?\.error === "string" \? data\.error : `Could not create project \(HTTP \$\{res\.status\}\)`/,
  "the throwing create path preserves the safe API error string or falls back to a clear HTTP message",
);

assert.match(
  source,
  /const createProject = useCallback\(async \([\s\S]*options\?: CreateProjectOptions,[\s\S]*\): Promise<CaveProject \| null> => \{[\s\S]*const result = await requestCreateProject\(name, root, options\);[\s\S]*return result\.ok \? result\.project : null;/,
  "the existing createProject API stays nullable/back-compatible for current callers",
);

assert.match(
  source,
  /const createProjectOrThrow = useCallback\(async \([\s\S]*options\?: CreateProjectOptions,[\s\S]*\): Promise<CaveProject> => \{[\s\S]*const result = await requestCreateProject\(name, root, options\);[\s\S]*if \(result\.ok\) return result\.project;[\s\S]*throw new Error\(result\.error\);/,
  "createProjectOrThrow reuses the shared mutation path and throws the actionable error text",
);

assert.match(
  source,
  /return \{[\s\S]*createProject,[\s\S]*createProjectOrThrow,[\s\S]*renameProject,/,
  "the hook returns both the nullable and throwing create helpers",
);

console.log("use-projects.test.ts: ok");
