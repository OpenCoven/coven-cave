import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { CaveProject } from "./cave-projects-types.ts";
import { fetchProjectsForTests, resetProjectsCacheForTests } from "./use-projects-cache.ts";

/**
 * cave-k0gf: dedupe + sort belong to the cache, not to each consumer.
 *
 * The cache already collapses the mount burst onto one request, but every one
 * of the 20+ useProjects() call sites used to re-run sortProjectsAlphabetically
 * over that single response. These tests pin what the cache now guarantees —
 * an already-normalized payload — plus a source pin that the hook no longer
 * repeats the work on the fetch path.
 */

function project(over: Partial<CaveProject> & { id: string; root: string }): CaveProject {
  return {
    name: over.name ?? over.id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  } as CaveProject;
}

/** Serve one canned payload, counting how many requests actually go out. */
function stubFetch(payload: unknown): { restore: () => void; calls: () => number } {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    calls: () => calls,
  };
}

// Referential stability is a property of the SWR cache storing one resolution,
// not of this change — pinned because moving normalization into the cache must
// not accidentally hand each consumer a fresh copy.
test("coalesced consumers share one payload instance", async () => {
  resetProjectsCacheForTests();
  const stub = stubFetch({
    ok: true,
    projects: [
      project({ id: "zeta", root: "/z" }),
      project({ id: "alpha", root: "/a" }),
      project({ id: "mid", root: "/m" }),
    ],
  });
  try {
    // Stand in for a surface mount: many consumers asking at once.
    const results = await Promise.all(
      Array.from({ length: 12 }, () => fetchProjectsForTests("cody")),
    );

    assert.equal(stub.calls(), 1, "the burst still collapses onto one request");

    const first = results[0].projects;
    assert.ok(first, "the payload carries projects");
    for (const [i, r] of results.entries()) {
      assert.equal(
        r.projects,
        first,
        `consumer ${i} got the very same array instance — nobody re-materialised it`,
      );
    }
  } finally {
    stub.restore();
  }
});

test("the payload arrives already sorted and deduped", async () => {
  resetProjectsCacheForTests();
  const stub = stubFetch({
    ok: true,
    projects: [
      project({ id: "zeta", name: "Zeta", root: "/z" }),
      project({ id: "alpha", name: "Alpha", root: "/a" }),
      // Same root as zeta but newer: dedupe keeps the newer record.
      project({ id: "zeta-new", name: "Zeta", root: "/z", updatedAt: "2026-06-01T00:00:00.000Z" }),
    ],
  });
  try {
    const { projects } = await fetchProjectsForTests("cody");
    assert.deepEqual(
      projects?.map((p) => p.name),
      ["Alpha", "Zeta"],
      "sorted alphabetically with the duplicate root collapsed",
    );
    assert.equal(projects?.[1].id, "zeta-new", "dedupe kept the newer record for /z");
  } finally {
    stub.restore();
  }
});

test("a non-array projects field normalizes to an empty list rather than throwing", async () => {
  resetProjectsCacheForTests();
  const stub = stubFetch({ ok: true });
  try {
    const { projects } = await fetchProjectsForTests("cody");
    assert.deepEqual(projects, [], "missing projects becomes []");
  } finally {
    stub.restore();
  }
});

// An error payload must pass through untouched: the hook reads `.error` from
// it, and inventing an empty projects array would look like "no projects".
test("an error payload is not rewritten", async () => {
  resetProjectsCacheForTests();
  const stub = stubFetch({ ok: false, error: "nope" });
  try {
    const payload = await fetchProjectsForTests("cody");
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "nope");
    assert.equal(payload.projects, undefined, "no fabricated empty list on the error path");
  } finally {
    stub.restore();
  }
});

test("a fresh scope normalizes its own payload", async () => {
  resetProjectsCacheForTests();
  const stub = stubFetch({ ok: true, projects: [project({ id: "b", name: "B", root: "/b" }), project({ id: "a", name: "A", root: "/a" })] });
  try {
    const cody = await fetchProjectsForTests("cody");
    const sage = await fetchProjectsForTests("sage");
    assert.equal(stub.calls(), 2, "different scopes are different cache keys");
    assert.deepEqual(cody.projects?.map((p) => p.name), ["A", "B"]);
    assert.deepEqual(sage.projects?.map((p) => p.name), ["A", "B"]);
    assert.notEqual(cody.projects, sage.projects, "each scope owns its own array");
  } finally {
    stub.restore();
  }
});

// The behavioural tests above prove the CACHE normalizes. This proves the
// consumer side no longer repeats it: the hook's fetch path must hand the
// cached array straight to state. Source-pinned because "how many times did a
// pure function run" is not observable from outside without instrumenting it.
const hook = readFileSync(new URL("./use-projects.ts", import.meta.url), "utf8");
const loadBody = hook.match(/const load = useCallback\([\s\S]*?\n  \}, \[/)?.[0] ?? "";
assert.ok(loadBody, "found the hook's load() body");
assert.match(
  loadBody,
  /setProjects\(Array\.isArray\(data\.projects\) \? data\.projects : \[\]\)/,
  "the fetch path stores the cached array as-is",
);
assert.doesNotMatch(
  loadBody,
  /sortProjectsAlphabetically/,
  "and does NOT re-sort it — that is the cache's job now (cave-k0gf)",
);
// The post-mutation re-sorts must survive: a locally inserted or edited
// project has not been through the cache and still needs ordering.
assert.ok(
  (hook.match(/sortProjectsAlphabetically\(/g) ?? []).length >= 5,
  "local create/update/delete paths still re-sort",
);

console.log("use-projects-normalize.test.ts: ok");
