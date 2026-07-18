import assert from "node:assert/strict";
import { test } from "node:test";

import {
  emitProjectRegistryMutation,
  resetProjectRegistryListenersForTests,
  subscribeProjectRegistryReload,
} from "./project-registry-events.ts";
import {
  fetchProjectsForTests,
  resetProjectsCacheForTests,
} from "./use-projects-cache.ts";

type DeferredResponse = {
  url: string;
  resolve: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
};

test("forced project reload bypasses a stale scoped in-flight request and leaves fresh cache data behind", async () => {
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
    let forcedReload: Promise<unknown> | null = null;
    const unsubscribe = subscribeProjectRegistryReload(() => {
      forcedReload = fetchProjectsForTests("sage", { force: true });
      return forcedReload.then(() => undefined);
    });

    emitProjectRegistryMutation();

    assert.equal(calls, 2, "the mutation-triggered force reload must issue a second fetch");
    assert.deepEqual(
      pending.map((request) => request.url),
      ["/api/projects?familiarId=sage", "/api/projects?familiarId=sage"],
      "both requests stay scoped to the same familiar",
    );

    pending[1]!.resolve({
      ok: true,
      json: async () => ({
        ok: true,
        projects: [{ id: "p-fresh", name: "Fresh project", root: "/repo/fresh" }],
      }),
    });
    const fresh = await forcedReload;

    pending[0]!.resolve({
      ok: true,
      json: async () => ({ ok: true, projects: [] }),
    });
    const stale = await staleLoad;

    assert.deepEqual(stale, { ok: true, projects: [] }, "the original caller still receives its own stale response");
    assert.deepEqual(
      fresh,
      { ok: true, projects: [{ id: "p-fresh", name: "Fresh project", root: "/repo/fresh" }] },
      "the forced reload resolves with the fresh post-mutation payload",
    );

    const cached = await fetchProjectsForTests("sage");
    assert.equal(calls, 2, "the late stale completion must not poison the current cache");
    assert.deepEqual(cached, fresh, "subsequent readers see the fresh cached payload");
    unsubscribe();
  } finally {
    globalThis.fetch = originalFetch;
    resetProjectRegistryListenersForTests();
    resetProjectsCacheForTests();
  }
});
