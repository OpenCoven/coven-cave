// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Fragment } from "react";
import { act, create } from "react-test-renderer";

import { useProjectFamiliars, useProjectFamiliarsByProject } from "./use-project-familiars.ts";
import { PROJECT_ACCESS_CHANGED_EVENT } from "./project-access-events.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Snapshot = {
  familiars: { id: string }[];
  loading: boolean;
  error: string | null;
  loadedSuccessfully: boolean;
  reload: () => void;
};

function Probe({
  projectId,
  enabled,
  snapshots,
}: {
  projectId: string | null;
  enabled: boolean;
  snapshots: Snapshot[];
}) {
  const state = useProjectFamiliars({ projectId, enabled });
  snapshots.push({
    familiars: state.familiars as { id: string }[],
    loading: state.loading,
    error: state.error,
    loadedSuccessfully: state.loadedSuccessfully,
    reload: state.reload,
  });
  return createElement("div");
}

type FetchControl = {
  url: string;
  signal: AbortSignal;
  resolve(resp: { ok: boolean; json(): Promise<unknown> }): void;
  reject(err: unknown): void;
};

function deferFetches() {
  const pending: FetchControl[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: unknown, options: RequestInit) =>
    new Promise<Response>((res, rej) => {
      pending.push({
        url: String(input),
        signal: options.signal as AbortSignal,
        resolve: ({ ok, json }) => res({ ok, json } as unknown as Response),
        reject: rej,
      });
    })) as unknown as typeof fetch;
  return {
    pending,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function BatchProbe({ projectIds, enabled = true, snapshots }) {
  snapshots.push(useProjectFamiliarsByProject({ projectIds, enabled }));
  return createElement("div");
}

function batchResponse(familiarsByProject) {
  return { ok: true, json: async () => ({ ok: true, familiarsByProject }) };
}

function goodResponse(familiars: { id: string }[]) {
  return { ok: true, json: async () => ({ ok: true, familiars }) };
}

function badResponse() {
  return { ok: false, json: async () => ({}) };
}

const CREW = [{ id: "kitty", name: "Kitty" }];

async function cleanupRenderer(deferred: ReturnType<typeof deferFetches>, renderer: ReturnType<typeof create> | null) {
  try {
    await act(async () => {
      renderer?.unmount();
    });
  } finally {
    deferred.restore();
  }
}

// ---------------------------------------------------------------------------
// Behavioral tests
// ---------------------------------------------------------------------------

test("loaded crew is synchronously hidden when enabled becomes false, before effect flushing", async () => {
  const deferred = deferFetches();
  const snapshots: Snapshot[] = [];
  let renderer: ReturnType<typeof create> | null = null;

  try {
    // Mount and load project A successfully.
    await act(async () => {
      renderer = create(createElement(Probe, { projectId: "proj-a", enabled: true, snapshots }));
    });
    await act(async () => {
      deferred.pending[0].resolve(goodResponse(CREW));
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(snapshots.at(-1)!.familiars.length, 1, "project A loaded");
    assert.equal(snapshots.at(-1)!.loadedSuccessfully, true);

    // Switch enabled=false. Use sync act so we can inspect the FIRST render
    // (pre-passive-effect) from the snapshot array. The derived masking happens
    // in the render function, so snapshot[n] — pushed before any effect fires —
    // must already show empty familiars and null error.
    const snapshotsBefore = snapshots.length;
    act(() => {
      renderer!.update(createElement(Probe, { projectId: "proj-a", enabled: false, snapshots }));
    });

    // First snapshot in this act = the render triggered by the prop change,
    // captured before passive effects ran.
    const preEffect = snapshots[snapshotsBefore];
    assert.ok(preEffect, "probe rendered on disable");
    assert.deepEqual(preEffect.familiars, [], "familiars synchronously hidden before effect");
    assert.equal(preEffect.error, null, "error synchronously hidden before effect");
    assert.equal(preEffect.loading, false, "loading correctly false when disabled");
  } finally {
    await cleanupRenderer(deferred, renderer);
  }
});

test("loaded crew from project A is synchronously hidden and project B reports loading on prop switch", async () => {
  const deferred = deferFetches();
  const snapshots: Snapshot[] = [];
  let renderer: ReturnType<typeof create> | null = null;

  try {
    // Load project A.
    await act(async () => {
      renderer = create(createElement(Probe, { projectId: "proj-a", enabled: true, snapshots }));
    });

    await act(async () => {
      deferred.pending[0].resolve(goodResponse(CREW));
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(snapshots.at(-1)!.familiars.length, 1, "project A loaded");

    // Switch to project B. The fetch for B is deferred so it never resolves
    // inside this act — B's crew is genuinely unavailable to any effect.
    const snapshotsBefore = snapshots.length;
    act(() => {
      renderer!.update(createElement(Probe, { projectId: "proj-b", enabled: true, snapshots }));
    });

    // Pre-effect render: project B not yet loaded, A's crew must be hidden.
    const preEffect = snapshots[snapshotsBefore];
    assert.ok(preEffect, "probe rendered on project switch");
    assert.deepEqual(preEffect.familiars, [], "project A familiars synchronously hidden");
    assert.equal(preEffect.loading, true, "project B reports loading synchronously");
    assert.equal(preEffect.error, null, "no error from project A carried over");
  } finally {
    await cleanupRenderer(deferred, renderer);
  }
});

test("an access mutation invalidates only the affected loaded project", async () => {
  const deferred = deferFetches();
  const snapshots: Snapshot[] = [];
  let renderer: ReturnType<typeof create> | null = null;
  const previousWindow = globalThis.window;
  const eventTarget = new EventTarget();
  globalThis.window = eventTarget as Window & typeof globalThis;

  try {
    await act(async () => {
      renderer = create(createElement(Probe, { projectId: "proj-a", enabled: true, snapshots }));
    });
    await act(async () => {
      deferred.pending[0].resolve(goodResponse(CREW));
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(snapshots.at(-1)!.loadedSuccessfully, true);

    await act(async () => {
      eventTarget.dispatchEvent(new CustomEvent(PROJECT_ACCESS_CHANGED_EVENT, {
        detail: { projectId: "proj-b" },
      }));
    });
    assert.equal(deferred.pending.length, 1, "unrelated project mutation does not reload");

    await act(async () => {
      eventTarget.dispatchEvent(new CustomEvent(PROJECT_ACCESS_CHANGED_EVENT, {
        detail: { projectId: "proj-a" },
      }));
    });
    assert.deepEqual(snapshots.at(-1)!.familiars, [], "affected crew is hidden immediately");
    assert.equal(snapshots.at(-1)!.loading, true);
    assert.equal(snapshots.at(-1)!.loadedSuccessfully, false);
    assert.equal(deferred.pending.length, 2, "affected project starts a fresh request");
  } finally {
    await cleanupRenderer(deferred, renderer);
    globalThis.window = previousWindow;
  }
});

test("a failed current request exposes the project error", async () => {
  const deferred = deferFetches();
  const snapshots: Snapshot[] = [];
  let renderer: ReturnType<typeof create> | null = null;

  try {
    await act(async () => {
      renderer = create(createElement(Probe, { projectId: "proj-a", enabled: true, snapshots }));
    });
    assert.equal(snapshots.at(-1)!.loading, true);

    await act(async () => {
      deferred.pending[0].resolve(badResponse());
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(snapshots.at(-1)!.error, "Couldn't load project crew");
    assert.equal(snapshots.at(-1)!.loading, false);
    assert.deepEqual(snapshots.at(-1)!.familiars, []);
    assert.equal(snapshots.at(-1)!.loadedSuccessfully, false);
  } finally {
    await cleanupRenderer(deferred, renderer);
  }
});

test("reload clears error immediately, stale retry completions stay ignored, and the fresh retry succeeds", async () => {
  const deferred = deferFetches();
  const snapshots: Snapshot[] = [];
  let renderer: ReturnType<typeof create> | null = null;

  try {
    // Mount — request 1 starts.
    await act(async () => {
      renderer = create(createElement(Probe, { projectId: "proj-a", enabled: true, snapshots }));
    });
    assert.equal(deferred.pending.length, 1, "fetch1 pending");
    assert.equal(snapshots.at(-1)!.loading, true);

    // Resolve request 1 with an error so the current project error is visible.
    await act(async () => {
      deferred.pending[0].resolve(badResponse());
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(snapshots.at(-1)!.error, "Couldn't load project crew");
    assert.equal(snapshots.at(-1)!.loading, false);
    assert.deepEqual(snapshots.at(-1)!.familiars, []);
    assert.equal(snapshots.at(-1)!.loadedSuccessfully, false);

    // Reload clears the error synchronously and starts request 2.
    const reloadFn = snapshots.at(-1)!.reload;
    await act(async () => {
      reloadFn();
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(snapshots.at(-1)!.error, null, "reload clears error synchronously");
    assert.equal(snapshots.at(-1)!.loading, true, "loading resumes immediately after reload");
    assert.deepEqual(snapshots.at(-1)!.familiars, [], "familiars cleared after reload");
    assert.equal(deferred.pending.length, 2, "fetch2 started by reload effect");

    // While request 2 is in flight, reload again. Request 2 becomes stale and
    // request 3 takes over.
    await act(async () => {
      reloadFn();
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(deferred.pending.length, 3, "fetch3 started by second reload");
    assert.equal(snapshots.at(-1)!.error, null);
    assert.equal(snapshots.at(-1)!.loading, true);

    // Resolve request 2 (stale generation). It must not rerender or repopulate.
    const snapshotsBeforeStale = snapshots.length;
    await act(async () => {
      deferred.pending[1].resolve(goodResponse(CREW));
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(snapshots.length, snapshotsBeforeStale, "stale completion causes no re-render");
    assert.deepEqual(snapshots.at(-1)!.familiars, [], "stale completion cannot repopulate familiars");
    assert.equal(snapshots.at(-1)!.loading, true, "still loading after stale resolution");

    // Resolve request 3 (current generation) — state updates correctly.
    await act(async () => {
      deferred.pending[2].resolve(goodResponse(CREW));
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(snapshots.at(-1)!.familiars.length, 1, "fresh fetch populates familiars");
    assert.equal(snapshots.at(-1)!.loading, false);
    assert.equal(snapshots.at(-1)!.loadedSuccessfully, true);
  } finally {
    await cleanupRenderer(deferred, renderer);
  }
});

test("reload callback identity is stable across state-only rerenders for unchanged props", async () => {
  const deferred = deferFetches();
  const snapshots: Snapshot[] = [];
  let renderer: ReturnType<typeof create> | null = null;

  try {
    await act(async () => {
      renderer = create(createElement(Probe, { projectId: "proj-a", enabled: true, snapshots }));
    });

    // Capture reload identity before any state changes.
    const reloadRef1 = snapshots.at(-1)!.reload;

    // Completing the fetch triggers state updates (setFamiliars, setLoadedProjectId,
    // setLoading) — re-renders with the same enabled + projectId props.
    await act(async () => {
      deferred.pending[0].resolve(goodResponse(CREW));
      await Promise.resolve();
      await Promise.resolve();
    });

    const reloadRef2 = snapshots.at(-1)!.reload;

    assert.equal(snapshots.at(-1)!.familiars.length, 1, "loaded successfully");
    // Props (enabled, projectId) did not change — useCallback must return the
    // same function reference.
    assert.equal(reloadRef1, reloadRef2, "reload callback identity stable across state-only rerender");
  } finally {
    await cleanupRenderer(deferred, renderer);
  }
});

test("two consumers share one read and switching/unmounting aborts only unobserved requests", async () => {
  const deferred = deferFetches();
  const first: Snapshot[] = [];
  const second: Snapshot[] = [];
  let renderer = null;
  const tree = (projectId, includeSecond = true) => createElement(Fragment, null,
    createElement(Probe, { key: "first", projectId, enabled: true, snapshots: first }),
    includeSecond && createElement(Probe, { key: "second", projectId: "proj-a", enabled: true, snapshots: second }),
  );
  try {
    await act(async () => { renderer = create(tree("proj-a")); });
    assert.equal(deferred.pending.length, 1);
    assert.equal(deferred.pending[0].signal.aborted, false);

    await act(async () => { renderer.update(tree("proj-b")); });
    assert.equal(deferred.pending.length, 2);
    assert.equal(deferred.pending[0].signal.aborted, false, "second consumer still needs A");
    assert.deepEqual(first.at(-1).familiars, []);

    await act(async () => { renderer.update(tree("proj-b", false)); });
    assert.equal(deferred.pending[0].signal.aborted, true, "A has no subscribers");
    assert.equal(deferred.pending[1].signal.aborted, false, "B is still observed");
    const before = first.length;
    await act(async () => { deferred.pending[0].resolve(goodResponse(CREW)); });
    assert.equal(first.length, before, "an aborted transport ignoring its signal cannot publish");
    await act(async () => { deferred.pending[1].resolve(goodResponse([{ id: "sage" }])); });
    assert.deepEqual(first.at(-1).familiars, [{ id: "sage" }]);
  } finally {
    await cleanupRenderer(deferred, renderer);
  }
});

for (const batchFirst of [true, false]) {
  test(`single and batch hooks share overlapping reads (${batchFirst ? "batch" : "single"} mounts first)`, async () => {
    const deferred = deferFetches();
    const single: Snapshot[] = [];
    const batch = [];
    let renderer = null;
    const elements = [
      createElement(Probe, { key: "single", projectId: "proj-a", enabled: true, snapshots: single }),
      createElement(BatchProbe, { key: "batch", projectIds: ["proj-b", "proj-a", "proj-a"], snapshots: batch }),
    ];
    try {
      await act(async () => {
        renderer = create(createElement(Fragment, null, ...(batchFirst ? elements.reverse() : elements)));
      });
      assert.equal(deferred.pending.length, batchFirst ? 1 : 2);
      const requested = deferred.pending.flatMap(({ url }) => new URL(url, "http://localhost").searchParams.getAll("projectId"));
      assert.deepEqual(requested.sort(), ["proj-a", "proj-b"], "no project is requested twice");
      await act(async () => {
        if (batchFirst) {
          deferred.pending[0].resolve(batchResponse({ "proj-a": CREW, "proj-b": [] }));
        } else {
          deferred.pending[0].resolve(goodResponse(CREW));
          deferred.pending[1].resolve(goodResponse([]));
        }
      });
      assert.equal(single.at(-1).loadedSuccessfully, true);
      assert.equal(batch.at(-1).loadedProjectIds.size, 2);
      assert.equal(batch.at(-1).loadingProjectIds.size, 0);
      assert.equal(single.at(-1).familiars, batch.at(-1).familiarsByProject.get("proj-a"));
      assert.deepEqual(batch.at(-1).familiarsByProject.get("proj-b"), []);
    } finally {
      await cleanupRenderer(deferred, renderer);
    }
  });
}

test("overlapping batch consumers retain transport until its last observed project leaves", async () => {
  const deferred = deferFetches();
  const first = [];
  const second = [];
  let renderer = null;
  const tree = (includeFirst) => createElement(Fragment, null,
    includeFirst && createElement(BatchProbe, { key: "first", projectIds: ["proj-a", "proj-b"], snapshots: first }),
    createElement(BatchProbe, { key: "second", projectIds: ["proj-b", "proj-c"], snapshots: second }),
  );
  try {
    await act(async () => { renderer = create(tree(true)); });
    assert.equal(deferred.pending.length, 2);
    assert.deepEqual(new URL(deferred.pending[1].url, "http://localhost").searchParams.getAll("projectId"), ["proj-c"]);
    await act(async () => { renderer.update(tree(false)); });
    assert.equal(deferred.pending[0].signal.aborted, false, "B still needs the A/B transport");
    await act(async () => {
      deferred.pending[0].resolve(batchResponse({ "proj-a": CREW, "proj-b": CREW }));
    });
    assert.deepEqual([...second.at(-1).loadedProjectIds], ["proj-b"]);
    assert.deepEqual([...second.at(-1).loadingProjectIds], ["proj-c"]);
    await act(async () => { renderer.unmount(); });
    renderer = null;
    assert.equal(deferred.pending[1].signal.aborted, true, "C lost its last subscriber");
  } finally {
    await cleanupRenderer(deferred, renderer);
  }
});

for (const initiallyLoaded of [false, true]) {
  test(`A → B → A requires a new load and rejects stale replies (${initiallyLoaded ? "loaded" : "pending"} A)`, async () => {
    const deferred = deferFetches();
    const snapshots: Snapshot[] = [];
    let renderer = null;
    const probe = (projectId) => createElement(Probe, { projectId, enabled: true, snapshots });
    try {
      await act(async () => { renderer = create(probe("proj-a")); });
      if (initiallyLoaded) {
        await act(async () => { deferred.pending[0].resolve(goodResponse(CREW)); });
      }
      await act(async () => { renderer.update(probe("proj-b")); });
      const before = snapshots.length;
      act(() => { renderer.update(probe("proj-a")); });
      assert.deepEqual(snapshots[before].familiars, []);
      assert.equal(snapshots[before].loadedSuccessfully, false);
      assert.equal(snapshots[before].loading, true);
      assert.equal(deferred.pending.length, 3);
      assert.equal(deferred.pending[1].signal.aborted, true);
      if (!initiallyLoaded) assert.equal(deferred.pending[0].signal.aborted, true);
      const beforeStale = snapshots.length;
      await act(async () => {
        if (!initiallyLoaded) deferred.pending[0].resolve(goodResponse(CREW));
        deferred.pending[1].reject(new Error("late project B failure"));
      });
      assert.equal(snapshots.length, beforeStale);
      await act(async () => { deferred.pending[2].resolve(goodResponse([])); });
      assert.deepEqual(snapshots.at(-1).familiars, []);
      assert.equal(snapshots.at(-1).loadedSuccessfully, true);
    } finally {
      await cleanupRenderer(deferred, renderer);
    }
  });
}

test("batch selection masks loaded identities before effects and normalizes reorder-only changes", async () => {
  const deferred = deferFetches();
  const snapshots = [];
  let renderer = null;
  const probe = (projectIds, enabled = true) => createElement(BatchProbe, { projectIds, enabled, snapshots });
  try {
    await act(async () => { renderer = create(probe(["proj-a", "proj-b"])); });
    await act(async () => {
      deferred.pending[0].resolve(batchResponse({ "proj-a": CREW, "proj-b": CREW }));
    });
    const loadedMap = snapshots.at(-1).familiarsByProject;
    await act(async () => { renderer.update(probe([" proj-b ", "proj-a", "proj-a", ""])); });
    assert.equal(deferred.pending.length, 1);
    assert.equal(snapshots.at(-1).familiarsByProject, loadedMap);

    const before = snapshots.length;
    act(() => { renderer.update(probe(["proj-c"])); });
    assert.equal(snapshots[before].familiarsByProject.size, 0);
    assert.equal(snapshots[before].loadedProjectIds.size, 0);
    assert.deepEqual([...snapshots[before].loadingProjectIds], ["proj-c"]);
    const beforeReturn = snapshots.length;
    act(() => { renderer.update(probe(["proj-a", "proj-b"])); });
    assert.equal(snapshots[beforeReturn].familiarsByProject.size, 0);
    assert.equal(snapshots[beforeReturn].loadedProjectIds.size, 0);
    assert.equal(deferred.pending.length, 3);
    assert.equal(deferred.pending[1].signal.aborted, true);
    const beforeDisable = snapshots.length;
    act(() => { renderer.update(probe(["proj-a", "proj-b"], false)); });
    assert.equal(snapshots[beforeDisable].familiarsByProject.size, 0);
    assert.equal(snapshots[beforeDisable].loadedProjectIds.size, 0);
    assert.equal(snapshots[beforeDisable].loadingProjectIds.size, 0);
    assert.equal(deferred.pending[2].signal.aborted, true);
  } finally {
    await cleanupRenderer(deferred, renderer);
  }
});

test("access changes fence a shared in-flight generation without cancelling unaffected batch projects", async () => {
  const deferred = deferFetches();
  const single: Snapshot[] = [];
  const batch = [];
  let renderer = null;
  const previousWindow = globalThis.window;
  const eventTarget = new EventTarget();
  globalThis.window = eventTarget as Window & typeof globalThis;
  try {
    await act(async () => {
      renderer = create(createElement(Fragment, null,
        createElement(BatchProbe, { projectIds: ["proj-a", "proj-b"], snapshots: batch }),
        createElement(Probe, { projectId: "proj-a", enabled: true, snapshots: single }),
      ));
    });
    await act(async () => {
      eventTarget.dispatchEvent(new CustomEvent(PROJECT_ACCESS_CHANGED_EVENT, { detail: { projectId: "proj-a" } }));
    });
    assert.equal(deferred.pending.length, 2, "one invalidation request, not one per consumer");
    assert.equal(deferred.pending[0].signal.aborted, false, "B still observes the old transport");
    await act(async () => {
      deferred.pending[0].resolve(batchResponse({ "proj-a": CREW, "proj-b": CREW }));
    });
    assert.deepEqual(single.at(-1).familiars, []);
    assert.equal(single.at(-1).loadedSuccessfully, false);
    assert.equal(single.at(-1).loading, true);
    assert.equal(batch.at(-1).familiarsByProject.has("proj-a"), false);
    assert.equal(batch.at(-1).loadedProjectIds.has("proj-a"), false);
    assert.equal(batch.at(-1).loadingProjectIds.has("proj-a"), true);
    assert.equal(batch.at(-1).loadedProjectIds.has("proj-b"), true);
    await act(async () => { deferred.pending[1].resolve(goodResponse([])); });
    assert.equal(single.at(-1).loadedSuccessfully, true);
    assert.deepEqual(single.at(-1).familiars, [], "revoked membership replaces old crew");
    assert.deepEqual(batch.at(-1).familiarsByProject.get("proj-a"), []);

    await act(async () => {
      eventTarget.dispatchEvent(new CustomEvent(PROJECT_ACCESS_CHANGED_EVENT, { detail: { projectId: "proj-a" } }));
    });
    assert.equal(single.at(-1).loadedSuccessfully, false);
    assert.equal(batch.at(-1).loadedProjectIds.has("proj-a"), false);
    assert.equal(batch.at(-1).loadedProjectIds.has("proj-b"), true);
    await act(async () => { deferred.pending[2].resolve(badResponse()); });
    assert.equal(single.at(-1).loadedSuccessfully, false);
    assert.equal(single.at(-1).error, "Couldn't load project crew");
    assert.equal(batch.at(-1).loadedProjectIds.has("proj-a"), false);
    assert.equal(batch.at(-1).loadingProjectIds.has("proj-a"), false);
  } finally {
    await cleanupRenderer(deferred, renderer);
    globalThis.window = previousWindow;
  }
});

test("revocation while parsing a response prevents it from repopulating after the replacement succeeds", async () => {
  const deferred = deferFetches();
  const snapshots: Snapshot[] = [];
  let renderer = null;
  const previousWindow = globalThis.window;
  const eventTarget = new EventTarget();
  globalThis.window = eventTarget as Window & typeof globalThis;
  let resolveBody;
  const body = new Promise((resolve) => { resolveBody = resolve; });
  try {
    await act(async () => {
      renderer = create(createElement(Probe, { projectId: "proj-a", enabled: true, snapshots }));
    });
    await act(async () => {
      deferred.pending[0].resolve({ ok: true, json: () => body });
    });
    await act(async () => {
      eventTarget.dispatchEvent(new CustomEvent(PROJECT_ACCESS_CHANGED_EVENT, { detail: { projectId: "proj-a" } }));
    });
    assert.equal(deferred.pending[0].signal.aborted, true);
    assert.equal(deferred.pending.length, 2);
    await act(async () => { deferred.pending[1].resolve(goodResponse([])); });
    const beforeStale = snapshots.length;
    await act(async () => { resolveBody({ ok: true, familiars: CREW }); });
    assert.equal(snapshots.length, beforeStale);
    assert.deepEqual(snapshots.at(-1).familiars, []);
    assert.equal(snapshots.at(-1).loadedSuccessfully, true);
    await act(async () => { renderer.unmount(); });
    renderer = null;
    eventTarget.dispatchEvent(new CustomEvent(PROJECT_ACCESS_CHANGED_EVENT, { detail: { projectId: "proj-a" } }));
    assert.equal(deferred.pending.length, 2, "unmount releases the access event subscription");
  } finally {
    await cleanupRenderer(deferred, renderer);
    globalThis.window = previousWindow;
  }
});

test("a new consumer never inherits completed membership and shared reload retries failures truthfully", async () => {
  const deferred = deferFetches();
  const single: Snapshot[] = [];
  const batch = [];
  let renderer = null;
  const tree = (includeBatch) => createElement(Fragment, null,
    createElement(Probe, { key: "single", projectId: "proj-a", enabled: true, snapshots: single }),
    includeBatch && createElement(BatchProbe, { key: "batch", projectIds: ["proj-a"], snapshots: batch }),
  );
  try {
    await act(async () => { renderer = create(tree(false)); });
    const reload = single.at(-1).reload;
    await act(async () => { deferred.pending[0].resolve(goodResponse(CREW)); });
    await act(async () => { renderer.update(tree(true)); });
    assert.equal(deferred.pending.length, 2, "completed membership is not a reusable cache");
    assert.equal(batch[0].loadedProjectIds.size, 0);
    assert.equal(batch[0].familiarsByProject.size, 0);
    assert.equal(single.at(-1).loadedSuccessfully, false, "revalidation clears existing authority too");
    assert.deepEqual(single.at(-1).familiars, []);
    await act(async () => { deferred.pending[1].reject(new Error("offline")); });
    assert.equal(batch.at(-1).loadedProjectIds.size, 0);
    assert.equal(batch.at(-1).loadingProjectIds.size, 0);
    assert.equal(single.at(-1).error, "Couldn't load project crew");
    assert.equal(single.at(-1).loadedSuccessfully, false);
    assert.equal(single.at(-1).reload, reload);
    await act(async () => { reload(); });
    assert.equal(deferred.pending.length, 3);
    assert.equal(batch.at(-1).loadingProjectIds.has("proj-a"), true);
    assert.equal(single.at(-1).error, null);
    await act(async () => { deferred.pending[2].resolve(batchResponse({ "proj-a": CREW })); });
    assert.equal(single.at(-1).loadedSuccessfully, true);
    assert.equal(batch.at(-1).loadedProjectIds.has("proj-a"), true);
    assert.equal(single.at(-1).reload, reload);
  } finally {
    await cleanupRenderer(deferred, renderer);
  }
});

test("malformed and partial batches never mark missing membership as successfully authorized", async () => {
  const deferred = deferFetches();
  const snapshots = [];
  let renderer = null;
  try {
    await act(async () => {
      renderer = create(createElement(BatchProbe, { projectIds: ["proj-a", "proj-b"], snapshots }));
    });
    await act(async () => { deferred.pending[0].resolve(batchResponse({ "proj-a": [] })); });
    assert.deepEqual([...snapshots.at(-1).loadedProjectIds], ["proj-a"]);
    assert.deepEqual(snapshots.at(-1).familiarsByProject.get("proj-a"), []);
    assert.equal(snapshots.at(-1).familiarsByProject.has("proj-b"), false);
    assert.equal(snapshots.at(-1).loadingProjectIds.size, 0);
    await act(async () => {
      renderer.update(createElement(BatchProbe, { projectIds: ["proj-c"], snapshots }));
    });
    await act(async () => {
      deferred.pending[1].resolve({ ok: true, json: async () => { throw new Error("invalid JSON"); } });
    });
    assert.equal(snapshots.at(-1).loadedProjectIds.size, 0);
    assert.equal(snapshots.at(-1).loadingProjectIds.size, 0);
    assert.equal(snapshots.at(-1).familiarsByProject.size, 0);
  } finally {
    await cleanupRenderer(deferred, renderer);
  }
});

test("empty scopes stay idle and disabling/re-enabling never restores old authority", async () => {
  const deferred = deferFetches();
  const single: Snapshot[] = [];
  const batch = [];
  let renderer = null;
  const tree = (projectId, enabled) => createElement(Fragment, null,
    createElement(Probe, { projectId, enabled, snapshots: single }),
    createElement(BatchProbe, { projectIds: ["", " "], snapshots: batch }),
  );
  try {
    await act(async () => { renderer = create(tree(null, true)); });
    await act(async () => { renderer.update(tree(" ", true)); });
    assert.equal(deferred.pending.length, 0);
    assert.equal(single.at(-1).loading, false);
    assert.equal(single.at(-1).loadedSuccessfully, false);
    assert.equal(batch.at(-1).loadingProjectIds.size, 0);
    await act(async () => { renderer.update(tree("proj-a", true)); });
    await act(async () => { deferred.pending[0].resolve(goodResponse(CREW)); });
    await act(async () => { renderer.update(tree("proj-a", false)); });
    const before = single.length;
    act(() => { renderer.update(tree("proj-a", true)); });
    assert.equal(single[before].loadedSuccessfully, false);
    assert.deepEqual(single[before].familiars, []);
    assert.equal(single[before].loading, true);
    assert.equal(deferred.pending.length, 2);
    await act(async () => { renderer.unmount(); });
    renderer = null;
    assert.equal(deferred.pending[1].signal.aborted, true);
  } finally {
    await cleanupRenderer(deferred, renderer);
  }
});
