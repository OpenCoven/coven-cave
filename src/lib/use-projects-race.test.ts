import assert from "node:assert/strict";
import { test } from "node:test";

import {
  emitProjectRegistryMutation,
  resetProjectRegistryListenersForTests,
  subscribeProjectRegistryMutation,
  subscribeProjectRegistryReload,
} from "./project-registry-events.ts";
import {
  fetchProjectsForTests,
  resetProjectsCacheForTests,
} from "./use-projects-cache.ts";
import { applyProjectRegistryMutation } from "./project-registry-mutation.ts";

type DeferredResponse = {
  url: string;
  resolve: (value: { ok: boolean; status?: number; json: () => Promise<unknown> }) => void;
};

test("same-scope project subscribers share one fresh post-mutation request and stale in-flight results cannot win", async () => {
  resetProjectRegistryListenersForTests();
  resetProjectsCacheForTests();
  const originalFetch = globalThis.fetch;
  const pending: DeferredResponse[] = [];
  let calls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls += 1;
    return await new Promise((resolve) => {
      pending.push({ url, resolve: resolve as DeferredResponse["resolve"] });
    });
  }) as typeof fetch;

  try {
    const staleLoad = fetchProjectsForTests("sage");
    const freshReloads: Promise<unknown>[] = [];
    const unsubscribeFirst = subscribeProjectRegistryReload(() => {
      const load = fetchProjectsForTests("sage");
      freshReloads.push(load);
      return load.then(() => undefined);
    });
    const unsubscribeSecond = subscribeProjectRegistryReload(() => {
      const load = fetchProjectsForTests("sage");
      freshReloads.push(load);
      return load.then(() => undefined);
    });

    emitProjectRegistryMutation();

    assert.equal(calls, 2, "two same-scope subscribers should share one fresh post-mutation request");
    assert.deepEqual(
      pending.map((request) => request.url),
      ["/api/projects?familiarId=sage", "/api/projects?familiarId=sage"],
      "both requests stay scoped to the same familiar",
    );
    assert.equal(freshReloads.length, 2, "both subscribers reload on the shared mutation event");

    pending[1]!.resolve({
      ok: true,
      json: async () => ({
        ok: true,
        projects: [{ id: "p-fresh", name: "Fresh project", root: "/repo/fresh" }],
      }),
    });
    const fresh = await freshReloads[0];

    pending[0]!.resolve({
      ok: true,
      json: async () => ({ ok: true, projects: [] }),
    });
    const stale = await staleLoad;

    assert.deepEqual(stale, { ok: true, projects: [] }, "the original caller still receives its own stale response");
    assert.deepEqual(
      fresh,
      { ok: true, projects: [{ id: "p-fresh", name: "Fresh project", root: "/repo/fresh" }] },
      "the shared reload resolves with the fresh post-mutation payload",
    );
    assert.deepEqual(
      await Promise.all(freshReloads),
      [fresh, fresh],
      "both same-scope subscribers observe the same fresh payload",
    );

    const cached = await fetchProjectsForTests("sage");
    assert.equal(calls, 2, "the late stale completion must not poison the current cache");
    assert.deepEqual(cached, fresh, "subsequent readers see the fresh cached payload");
    unsubscribeFirst();
    unsubscribeSecond();
  } finally {
    globalThis.fetch = originalFetch;
    resetProjectRegistryListenersForTests();
    resetProjectsCacheForTests();
  }
});

test("different project scopes may each issue one fresh post-mutation request", async () => {
  resetProjectRegistryListenersForTests();
  resetProjectsCacheForTests();
  const originalFetch = globalThis.fetch;
  const pending: DeferredResponse[] = [];
  let calls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls += 1;
    return await new Promise((resolve) => {
      pending.push({ url, resolve: resolve as DeferredResponse["resolve"] });
    });
  }) as typeof fetch;

  try {
    const initialAll = fetchProjectsForTests(null);
    const initialSage = fetchProjectsForTests("sage");
    assert.equal(calls, 2, "pre-mutation readers issue one request per scope");
    pending[0]!.resolve({ ok: true, json: async () => ({ ok: true, projects: [{ id: "all-old", name: "All old", root: "/repo/all-old" }] }) });
    pending[1]!.resolve({ ok: true, json: async () => ({ ok: true, projects: [{ id: "sage-old", name: "Sage old", root: "/repo/sage-old" }] }) });
    await Promise.all([initialAll, initialSage]);

    const reloads: Promise<unknown>[] = [];
    const unsubscribeAll = subscribeProjectRegistryReload(() => {
      const load = fetchProjectsForTests(null);
      reloads.push(load);
      return load.then(() => undefined);
    });
    const unsubscribeSage = subscribeProjectRegistryReload(() => {
      const load = fetchProjectsForTests("sage");
      reloads.push(load);
      return load.then(() => undefined);
    });

    emitProjectRegistryMutation();

    assert.equal(calls, 4, "different scopes each issue one fresh request after the shared mutation");
    assert.deepEqual(
      pending.slice(2).map((request) => request.url),
      ["/api/projects", "/api/projects?familiarId=sage"],
      "each fresh request stays within its own scope",
    );

    pending[2]!.resolve({ ok: true, json: async () => ({ ok: true, projects: [{ id: "all-fresh", name: "All fresh", root: "/repo/all-fresh" }] }) });
    pending[3]!.resolve({ ok: true, json: async () => ({ ok: true, projects: [{ id: "sage-fresh", name: "Sage fresh", root: "/repo/sage-fresh" }] }) });

    assert.deepEqual(
      await Promise.all(reloads),
      [
        { ok: true, projects: [{ id: "all-fresh", name: "All fresh", root: "/repo/all-fresh" }] },
        { ok: true, projects: [{ id: "sage-fresh", name: "Sage fresh", root: "/repo/sage-fresh" }] },
      ],
      "each scope observes its own fresh payload",
    );

    unsubscribeAll();
    unsubscribeSage();
  } finally {
    globalThis.fetch = originalFetch;
    resetProjectRegistryListenersForTests();
    resetProjectsCacheForTests();
  }
});

test("delete mutations drop stale final projects in every scope before failed reloads settle", async () => {
  resetProjectRegistryListenersForTests();
  resetProjectsCacheForTests();
  const originalFetch = globalThis.fetch;
  const pending: DeferredResponse[] = [];
  let calls = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls += 1;
    return await new Promise((resolve) => {
      pending.push({ url, resolve: resolve as DeferredResponse["resolve"] });
    });
  }) as typeof fetch;

  try {
    const initialAllLoad = fetchProjectsForTests(null);
    const initialScopedLoad = fetchProjectsForTests("sage");
    assert.equal(calls, 2, "initial readers issue one request per scope");
    pending[0]!.resolve({
      ok: true,
      json: async () => ({ ok: true, projects: [{ id: "solo", name: "Solo", root: "/repo/solo" }] }),
    });
    pending[1]!.resolve({
      ok: true,
      json: async () => ({ ok: true, projects: [{ id: "solo", name: "Solo", root: "/repo/solo" }] }),
    });

    const allState = {
      projects: (await initialAllLoad).projects ?? [],
      error: null as string | null,
    };
    const scopedState = {
      projects: (await initialScopedLoad).projects ?? [],
      error: null as string | null,
    };

    const reloads: Promise<unknown>[] = [];
    const unsubscribeAll = subscribeProjectRegistryMutation(({ mutation }) => {
      allState.projects = applyProjectRegistryMutation(allState.projects, mutation);
      const reload = fetchProjectsForTests(null)
        .then((data) => {
          allState.projects = data.projects ?? [];
          allState.error = data.ok === false ? data.error ?? "Failed to load projects" : null;
        })
        .catch((error) => {
          allState.error = error instanceof Error ? error.message : "Failed to load projects";
        });
      reloads.push(reload);
    });
    const unsubscribeScoped = subscribeProjectRegistryMutation(({ mutation }) => {
      scopedState.projects = applyProjectRegistryMutation(scopedState.projects, mutation);
      const reload = fetchProjectsForTests("sage")
        .then((data) => {
          scopedState.projects = data.projects ?? [];
          scopedState.error = data.ok === false ? data.error ?? "Failed to load projects" : null;
        })
        .catch((error) => {
          scopedState.error = error instanceof Error ? error.message : "Failed to load projects";
        });
      reloads.push(reload);
    });

    emitProjectRegistryMutation({ kind: "delete", projectId: "solo" });

    assert.deepEqual(allState.projects, [], "the unscoped subscriber drops the deleted project immediately");
    assert.deepEqual(scopedState.projects, [], "the scoped subscriber drops the deleted project immediately too");
    assert.equal(calls, 4, "each scope issues one fresh post-delete request through the new generation");
    assert.deepEqual(
      pending.slice(2).map((request) => request.url),
      ["/api/projects", "/api/projects?familiarId=sage"],
      "the reload requests stay within their respective scopes",
    );

    pending[2]!.resolve({ ok: false, status: 500, json: async () => ({ ok: false, error: "server down" }) });
    pending[3]!.resolve({ ok: false, status: 500, json: async () => ({ ok: false, error: "server down" }) });
    await Promise.allSettled(reloads);

    assert.equal(allState.error, "HTTP 500", "a failed reload still surfaces an error for the unscoped subscriber");
    assert.equal(scopedState.error, "HTTP 500", "a failed reload still surfaces an error for the scoped subscriber");
    assert.deepEqual(allState.projects, [], "a failed reload must not restore the stale deleted project in the unscoped subscriber");
    assert.deepEqual(scopedState.projects, [], "a failed reload must not restore the stale deleted project in the scoped subscriber");

    unsubscribeAll();
    unsubscribeScoped();
  } finally {
    globalThis.fetch = originalFetch;
    resetProjectRegistryListenersForTests();
    resetProjectsCacheForTests();
  }
});
