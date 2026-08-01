// @ts-nocheck
import assert from "node:assert/strict";
import test from "node:test";
import { createElement, useCallback } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import * as roleSurfaceHooks from "./use-role-surfaces.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function response(ok: boolean, body: unknown): Response {
  return {
    ok,
    json: async () => body,
  } as Response;
}

test("memory access preserves a successful empty inventory", async () => {
  assert.equal(typeof roleSurfaceHooks.createMemoryAccess, "function");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => response(true, { ok: true, entries: [] });
  try {
    const memory = roleSurfaceHooks.createMemoryAccess("salem");
    assert.deepEqual(await memory.listEntries(), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("memory access rejects network, non-OK, failed, and malformed inventory responses", async () => {
  assert.equal(typeof roleSurfaceHooks.createMemoryAccess, "function");
  const originalFetch = globalThis.fetch;
  const memory = roleSurfaceHooks.createMemoryAccess("salem");
  try {
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    await assert.rejects(memory.listEntries(), /offline/);

    globalThis.fetch = async () => response(false, { entries: [] });
    await assert.rejects(memory.listEntries());

    globalThis.fetch = async () => response(true, { ok: false, entries: [] });
    await assert.rejects(memory.listEntries());

    globalThis.fetch = async () => response(true, { entries: [] });
    await assert.rejects(memory.listEntries());

    globalThis.fetch = async () =>
      response(true, {
        ok: true,
        entries: [
          {
            relPath: "MEMORY.md",
            fullPath: "/tmp/MEMORY.md",
            rootLabel: "Familiar",
            sourceKindLabel: "Memory",
            size: "not-a-number",
            modified: "2026-07-26T00:00:00.000Z",
          },
        ],
      });
    await assert.rejects(memory.listEntries());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("memory access keeps a missing familiar as an honest empty without fetching", async () => {
  assert.equal(typeof roleSurfaceHooks.createMemoryAccess, "function");
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return response(true, { entries: [] });
  };
  try {
    assert.deepEqual(await roleSurfaceHooks.createMemoryAccess(null).listEntries(), []);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

type ProbeProps<T> = {
  scope: string;
  request(scope: string): Promise<T>;
  exposeReload?(reload: (options?: { retainData?: boolean }) => Promise<boolean>): void;
};

function LoaderProbe<T>({ scope, request, exposeReload }: ProbeProps<T>) {
  assert.equal(typeof roleSurfaceHooks.useLatestAsyncData, "function");
  const load = useCallback(() => request(scope), [request, scope]);
  const { data, error, reload } = roleSurfaceHooks.useLatestAsyncData({
    scopeKey: scope,
    load,
    errorMessage: "Couldn't load probe.",
  });
  exposeReload?.(reload);
  return createElement("output", null, JSON.stringify({ data, error }));
}

function output(renderer: ReactTestRenderer): { data: unknown; error: string | null } {
  return JSON.parse(renderer.root.findByType("output").children.join(""));
}

type RoleSurfaceFetchResponse = {
  ok: boolean;
  status?: number;
  json(): Promise<unknown>;
};

type DeferredFetchResponse = {
  url: string;
  resolve(value: RoleSurfaceFetchResponse): void;
};

type RoleSurfaceSnapshot = {
  familiarId: string | null;
  contextFamiliarId: string | null;
  rolesLoaded: boolean;
  rolesLoadedSuccessfully: boolean;
};

function deferredRoleSurfaceFetch() {
  const originalFetch = globalThis.fetch;
  const pending: DeferredFetchResponse[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return await new Promise((resolve) => pending.push({ url, resolve }));
  }) as typeof fetch;
  return {
    pending,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function familiar(id: string) {
  return {
    id,
    display_name: id,
    role: "Researcher",
  };
}

function settleRoles(response: DeferredFetchResponse, body: unknown) {
  return act(async () => {
    response.resolve({
      ok: true,
      json: async () => body,
    });
    await Promise.resolve();
  });
}

function failRoles(response: DeferredFetchResponse, options?: { status?: number; error?: Error }) {
  return act(async () => {
    response.resolve({
      ok: options?.error ? true : false,
      status: options?.status ?? 500,
      json: async () => {
        if (options?.error) throw options.error;
        return { ok: false };
      },
    });
    await Promise.resolve();
  });
}

function RoleSurfaceSessionProbe({
  familiarId,
  snapshots,
}: {
  familiarId: string | null;
  snapshots: RoleSurfaceSnapshot[];
}) {
  const session = roleSurfaceHooks.useRoleSurfaceSession({
    familiar: familiarId ? familiar(familiarId) : null,
    sessions: [],
    activeSessionId: null,
    daemonRunning: true,
    openUrl() {},
    openSession() {},
    focusCard() {},
    refreshTasks() {},
  });
  snapshots.push({
    familiarId,
    contextFamiliarId: session.context?.activeFamiliar.id ?? null,
    rolesLoaded: session.rolesLoaded,
    rolesLoadedSuccessfully: session.rolesLoadedSuccessfully,
  });
  return createElement("role-surface-session-probe");
}

test("selected content ignores a late response from the prior selection", async () => {
  const pending = new Map<string, Deferred<string>>();
  const request = (scope: string) => {
    const next = deferred<string>();
    pending.set(scope, next);
    return next.promise;
  };
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(createElement(LoaderProbe, { scope: "memory-a", request }));
  });
  await act(async () => {
    renderer.update(createElement(LoaderProbe, { scope: "memory-b", request }));
  });
  await act(async () => pending.get("memory-b")!.resolve("content-b"));
  assert.deepEqual(output(renderer), { data: "content-b", error: null });

  await act(async () => pending.get("memory-a")!.resolve("content-a"));
  assert.deepEqual(output(renderer), { data: "content-b", error: null });
  await act(async () => renderer.unmount());
});

test("familiar scope ignores a late failure from the prior familiar", async () => {
  const pending = new Map<string, Deferred<string[]>>();
  const request = (scope: string) => {
    const next = deferred<string[]>();
    pending.set(scope, next);
    return next.promise;
  };
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(createElement(LoaderProbe, { scope: "familiar-a", request }));
  });
  await act(async () => {
    renderer.update(createElement(LoaderProbe, { scope: "familiar-b", request }));
  });
  await act(async () => pending.get("familiar-b")!.resolve(["b-card"]));
  assert.deepEqual(output(renderer), { data: ["b-card"], error: null });

  await act(async () => pending.get("familiar-a")!.reject(new Error("late failure")));
  assert.deepEqual(output(renderer), { data: ["b-card"], error: null });
  await act(async () => renderer.unmount());
});

test("retry clears successful data while the fresh request is pending", async () => {
  const requests: Deferred<string>[] = [];
  const request = () => {
    const next = deferred<string>();
    requests.push(next);
    return next.promise;
  };
  let reload!: () => Promise<boolean>;
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(
      createElement(LoaderProbe, {
        scope: "same-scope",
        request,
        exposeReload: (nextReload) => {
          reload = nextReload;
        },
      }),
    );
  });
  await act(async () => requests[0].resolve("first"));
  assert.deepEqual(output(renderer), { data: "first", error: null });

  await act(async () => {
    void reload();
  });
  assert.deepEqual(output(renderer), { data: null, error: null });
  await act(async () => requests[1].resolve("second"));
  assert.deepEqual(output(renderer), { data: "second", error: null });
  await act(async () => renderer.unmount());
});

test("retained revalidation keeps usable data while pending and when refresh fails", async () => {
  const requests: Deferred<string>[] = [];
  const request = () => {
    const next = deferred<string>();
    requests.push(next);
    return next.promise;
  };
  let reload!: (options?: { retainData?: boolean }) => Promise<boolean>;
  let renderer!: ReactTestRenderer;

  await act(async () => {
    renderer = create(
      createElement(LoaderProbe, {
        scope: "same-scope",
        request,
        exposeReload: (nextReload) => {
          reload = nextReload;
        },
      }),
    );
  });
  await act(async () => requests[0].resolve("first"));
  assert.deepEqual(output(renderer), { data: "first", error: null });

  let refresh!: Promise<boolean>;
  await act(async () => {
    refresh = reload({ retainData: true });
  });
  assert.deepEqual(output(renderer), { data: "first", error: null });

  await act(async () => requests[1].reject(new Error("refresh failed")));
  assert.equal(await refresh, false);
  assert.deepEqual(output(renderer), { data: "first", error: "Couldn't load probe." });
  await act(async () => renderer.unmount());
});

test("role-surface session treats a successful empty roles list as settled evidence", async () => {
  const fetch = deferredRoleSurfaceFetch();
  const snapshots: RoleSurfaceSnapshot[] = [];
  let renderer!: ReactTestRenderer;

  try {
    await act(async () => {
      renderer = create(createElement(RoleSurfaceSessionProbe, { familiarId: "salem", snapshots }));
    });
    assert.equal(fetch.pending.length, 1);
    assert.equal(fetch.pending[0]?.url, "/api/roles");
    assert.deepEqual(snapshots.at(-1), {
      familiarId: "salem",
      contextFamiliarId: "salem",
      rolesLoaded: false,
      rolesLoadedSuccessfully: false,
    });

    await settleRoles(fetch.pending.shift()!, { roles: [] });
    assert.deepEqual(snapshots.at(-1), {
      familiarId: "salem",
      contextFamiliarId: "salem",
      rolesLoaded: true,
      rolesLoadedSuccessfully: true,
    });
  } finally {
    await act(async () => renderer?.unmount());
    fetch.restore();
  }
});

test("role-surface session clears success on familiar change and preserves failure as unsuccessful settlement", async () => {
  const fetch = deferredRoleSurfaceFetch();
  const snapshots: RoleSurfaceSnapshot[] = [];
  let renderer!: ReactTestRenderer;

  try {
    await act(async () => {
      renderer = create(createElement(RoleSurfaceSessionProbe, { familiarId: "familiar-a", snapshots }));
    });
    await settleRoles(fetch.pending.shift()!, {
      roles: [{ id: "researcher", familiar: "familiar-a", active: true }],
    });
    assert.deepEqual(snapshots.at(-1), {
      familiarId: "familiar-a",
      contextFamiliarId: "familiar-a",
      rolesLoaded: true,
      rolesLoadedSuccessfully: true,
    });

    snapshots.length = 0;
    await act(async () => {
      renderer.update(createElement(RoleSurfaceSessionProbe, { familiarId: "familiar-b", snapshots }));
    });
    assert.ok(
      snapshots.every(
        (snapshot) =>
          snapshot.familiarId === "familiar-b"
          && snapshot.contextFamiliarId === "familiar-b"
          && snapshot.rolesLoaded === false
          && snapshot.rolesLoadedSuccessfully === false,
      ),
      "switching familiars must not expose the previous familiar's settled-success state",
    );

    const familiarB = fetch.pending.shift()!;
    assert.equal(familiarB.url, "/api/roles");
    await failRoles(familiarB, { status: 503 });
    assert.deepEqual(snapshots.at(-1), {
      familiarId: "familiar-b",
      contextFamiliarId: "familiar-b",
      rolesLoaded: true,
      rolesLoadedSuccessfully: false,
    });
  } finally {
    await act(async () => renderer?.unmount());
    fetch.restore();
  }
});

test("role-surface session keeps a missing familiar unsettled and unfetched", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return response(true, { roles: [] });
  }) as typeof fetch;
  const snapshots: RoleSurfaceSnapshot[] = [];
  let renderer!: ReactTestRenderer;

  try {
    await act(async () => {
      renderer = create(createElement(RoleSurfaceSessionProbe, { familiarId: null, snapshots }));
    });
    assert.equal(calls, 0);
    assert.deepEqual(snapshots.at(-1), {
      familiarId: null,
      contextFamiliarId: null,
      rolesLoaded: false,
      rolesLoadedSuccessfully: false,
    });
  } finally {
    await act(async () => renderer?.unmount());
    globalThis.fetch = originalFetch;
  }
});
