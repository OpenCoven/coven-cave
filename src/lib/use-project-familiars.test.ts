// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { useProjectFamiliars } from "./use-project-familiars.ts";
import { PROJECT_ACCESS_CHANGED_EVENT } from "./project-access-events.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Source assertions (plan-required; reload adapted to memoized form)
// ---------------------------------------------------------------------------

const source = readFileSync(new URL("./use-project-familiars.ts", import.meta.url), "utf8");

assert.match(
  source,
  /ids\.length === 1 && Array\.isArray\(payload\.familiars\)[\s\S]*?\[ids\[0\]\]: payload\.familiars/,
  "the batch project-familiar hook accepts the API's single-project response shape",
);
assert.match(
  source,
  /error:\s*string \| null[\s\S]*?reload:\s*\(\) => void/,
  "the single-project state exposes error and reload fields",
);
assert.match(source, /const EMPTY_FAMILIARS: Familiar\[\] = \[\];/, "the hook uses a shared empty familiar list");
assert.match(
  source,
  /const currentFamiliars = enabled && projectId !== null && loadedProjectId === projectId \? familiars : EMPTY_FAMILIARS;/,
  "current familiars are masked when disabled and derived from the matching project only",
);
assert.match(
  source,
  /const currentLoading = Boolean\([\s\S]*?enabled && projectId !== null && currentError === null && \(loading \|\| loadedProjectId !== projectId\),[\s\S]*?\);/,
  "current loading stays true for a new project before its effect runs",
);
assert.match(
  source,
  /setErrorProjectId\(projectId\);/,
  "request failures are attributed to the current project",
);
// Reload is now a memoized useCallback that synchronously invalidates the
// in-flight generation and clears stale state before advancing the epoch.
assert.match(
  source,
  /const reload = useCallback\([\s\S]*?generationRef\.current \+= 1[\s\S]*?setReloadEpoch/,
  "reload is a useCallback that synchronously increments the generation and advances the epoch",
);
assert.match(
  source,
  /window\.addEventListener\(PROJECT_ACCESS_CHANGED_EVENT, onProjectAccessChanged\)/,
  "the selected-project hook subscribes to access mutations",
);
assert.match(
  source,
  /projectAccessChangedId\(event\) === projectId[\s\S]{0,80}reload\(\)/,
  "only the affected selected project invalidates its crew",
);

console.log("project familiar hook source assertions passed");

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
  resolve(resp: { ok: boolean; json(): Promise<unknown> }): void;
  reject(err: unknown): void;
};

function deferFetches() {
  const pending: FetchControl[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((_input: unknown) =>
    new Promise<Response>((res, rej) => {
      pending.push({
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

console.log("project familiar hook behavioral tests passed");
