// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import {
  LOCAL_PROJECT_CREATION_MESSAGE,
  LOCAL_REQUEST_REQUIRED_CODE,
  ProjectCreationError,
} from "./project-errors.ts";
import { resetProjectRegistryListenersForTests } from "./project-registry-events.ts";
import { resetProjectsCacheForTests, useProjects } from "./use-projects.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type DeferredResponse = {
  url: string;
  resolve: (value: { ok: boolean; status?: number; json: () => Promise<unknown> }) => void;
};

type Snapshot = {
  familiarId: string | null;
  projects: string[];
  loading: boolean;
  loadedSuccessfully: boolean;
};

function ScopeProbe({ familiarId, snapshots }: { familiarId: string | null; snapshots: Snapshot[] }) {
  const state = useProjects({ familiarId });
  snapshots.push({
    familiarId,
    projects: state.projects.map((project) => project.id),
    loading: state.loading,
    loadedSuccessfully: state.loadedSuccessfully,
  });
  return createElement("scope-probe");
}

function CreationProbe({ onState }: { onState: (state: ReturnType<typeof useProjects>) => void }) {
  const state = useProjects();
  onState(state);
  return createElement("creation-probe");
}

function deferredFetch() {
  const originalFetch = globalThis.fetch;
  const pending: DeferredResponse[] = [];
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

const project = (id: string) => ({ id, name: id, root: `/repo/${id}` });

async function settle(response: DeferredResponse, projects: unknown[]) {
  await act(async () => {
    response.resolve({ ok: true, json: async () => ({ ok: true, projects }) });
    await Promise.resolve();
  });
}

test("mounted global-to-familiar transition never renders the retained global projects", async () => {
  resetProjectRegistryListenersForTests();
  resetProjectsCacheForTests();
  const fetch = deferredFetch();
  const snapshots: Snapshot[] = [];
  let renderer: ReturnType<typeof create> | null = null;

  try {
    await act(async () => {
      renderer = create(createElement(ScopeProbe, { familiarId: null, snapshots }));
    });
    assert.equal(fetch.pending.length, 1);
    assert.equal(fetch.pending[0]!.url, "/api/projects");
    await settle(fetch.pending.shift()!, [project("global-only")]);
    assert.deepEqual(snapshots.at(-1)?.projects, ["global-only"]);
    assert.equal(snapshots.at(-1)?.loadedSuccessfully, true);

    snapshots.length = 0;
    await act(async () => {
      renderer!.update(createElement(ScopeProbe, { familiarId: "familiar-b", snapshots }));
    });

    assert.ok(fetch.pending.some((request) => request.url === "/api/projects?familiarId=familiar-b"));
    assert.ok(
      snapshots.every((snapshot) => snapshot.projects.length === 0 && !snapshot.loadedSuccessfully),
      "the familiar B render and its pending request must not expose the retained global project",
    );

    const familiarB = fetch.pending.find((request) => request.url === "/api/projects?familiarId=familiar-b")!;
    await settle(familiarB, []);
    assert.deepEqual(snapshots.at(-1)?.projects, []);
    assert.equal(snapshots.at(-1)?.loadedSuccessfully, true, "an empty successful B result is still scoped to B");
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    fetch.restore();
    resetProjectRegistryListenersForTests();
    resetProjectsCacheForTests();
  }
});

test("mounted familiar A-to-B transition stays empty through a failed B request", async () => {
  resetProjectRegistryListenersForTests();
  resetProjectsCacheForTests();
  const fetch = deferredFetch();
  const snapshots: Snapshot[] = [];
  let renderer: ReturnType<typeof create> | null = null;

  try {
    await act(async () => {
      renderer = create(createElement(ScopeProbe, { familiarId: "familiar-a", snapshots }));
    });
    await settle(fetch.pending.shift()!, [project("a-only")]);
    assert.deepEqual(snapshots.at(-1)?.projects, ["a-only"]);

    snapshots.length = 0;
    await act(async () => {
      renderer!.update(createElement(ScopeProbe, { familiarId: "familiar-b", snapshots }));
    });
    assert.ok(
      snapshots.every((snapshot) => snapshot.projects.length === 0 && !snapshot.loadedSuccessfully),
      "the B transition must not render familiar A's retained project",
    );

    const familiarB = fetch.pending.find((request) => request.url === "/api/projects?familiarId=familiar-b")!;
    await act(async () => {
      familiarB.resolve({ ok: false, status: 500, json: async () => ({ ok: false, error: "offline" }) });
      await Promise.resolve();
    });
    assert.deepEqual(snapshots.at(-1)?.projects, []);
    assert.equal(snapshots.at(-1)?.loadedSuccessfully, false, "a failed B request cannot re-enable the picker");
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    fetch.restore();
    resetProjectRegistryListenersForTests();
    resetProjectsCacheForTests();
  }
});

test("project creation preserves the local-only code through nullable and throwing APIs", async () => {
  resetProjectRegistryListenersForTests();
  resetProjectsCacheForTests();
  const originalFetch = globalThis.fetch;
  const pending: DeferredResponse[] = [];
  let latestState: ReturnType<typeof useProjects> | null = null;
  let renderer: ReturnType<typeof create> | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return await new Promise((resolve) => pending.push({ url, resolve }));
  }) as typeof fetch;

  try {
    await act(async () => {
      renderer = create(createElement(CreationProbe, { onState: (state) => { latestState = state; } }));
    });
    assert.equal(pending.length, 1, "mount loads the project list before creation is attempted");
    await settle(pending.shift()!, []);
    assert.ok(latestState);

    const reported: ProjectCreationError[] = [];
    const nullable = latestState!.createProject("Remote", "/remote", {
      onError: (error) => reported.push(error),
    });
    assert.equal(pending.length, 1);
    pending.shift()!.resolve({
      ok: false,
      status: 403,
      json: async () => ({ ok: false, code: LOCAL_REQUEST_REQUIRED_CODE, error: "forbidden" }),
    });
    assert.equal(await nullable, null, "the nullable API keeps its null-on-failure contract");
    assert.equal(reported.length, 1);
    assert.equal(reported[0]!.code, LOCAL_REQUEST_REQUIRED_CODE);
    assert.equal(reported[0]!.message, LOCAL_PROJECT_CREATION_MESSAGE);

    const throwing = latestState!.createProjectOrThrow("Remote", "/remote");
    assert.equal(pending.length, 1);
    pending.shift()!.resolve({
      ok: false,
      status: 403,
      json: async () => ({ ok: false, code: LOCAL_REQUEST_REQUIRED_CODE, error: "forbidden" }),
    });
    await assert.rejects(throwing, (error: unknown) => {
      assert.ok(error instanceof ProjectCreationError);
      assert.equal(error.code, LOCAL_REQUEST_REQUIRED_CODE);
      assert.equal(error.message, LOCAL_PROJECT_CREATION_MESSAGE);
      return true;
    });

    const validationReported: ProjectCreationError[] = [];
    const invalidRoot = latestState!.createProject("Missing", "/missing", {
      onError: (error) => validationReported.push(error),
    });
    assert.equal(pending.length, 1);
    pending.shift()!.resolve({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "root does not exist" }),
    });
    assert.equal(await invalidRoot, null);
    assert.equal(validationReported[0]!.message, "root does not exist");
    assert.equal(validationReported[0]!.code, undefined);

    const validationThrow = latestState!.createProjectOrThrow("Missing", "/missing");
    assert.equal(pending.length, 1);
    pending.shift()!.resolve({
      ok: false,
      status: 400,
      json: async () => ({
        ok: false,
        code: "PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE",
        error: "Choose a specific folder for this project — your home folder itself or the top of a drive can't be a project root.",
      }),
    });
    await assert.rejects(validationThrow, (error: unknown) => {
      assert.ok(error instanceof ProjectCreationError);
      assert.equal(error.code, "PROJECT_ROOT_OUTSIDE_ALLOWED_WORKSPACE");
      assert.match(error.message, /home folder itself/);
      return true;
    });
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    globalThis.fetch = originalFetch;
    resetProjectRegistryListenersForTests();
    resetProjectsCacheForTests();
  }
});

test("unscoped project creation is visible before the initial registry load settles", async () => {
  resetProjectRegistryListenersForTests();
  resetProjectsCacheForTests();
  const originalFetch = globalThis.fetch;
  const pending: DeferredResponse[] = [];
  let latestState: ReturnType<typeof useProjects> | null = null;
  let renderer: ReturnType<typeof create> | null = null;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return await new Promise((resolve) => pending.push({ url, resolve }));
  }) as typeof fetch;

  try {
    await act(async () => {
      renderer = create(createElement(CreationProbe, { onState: (state) => { latestState = state; } }));
    });
    assert.equal(pending.length, 1, "the initial unscoped list is still in flight");

    const created = project("created-before-load");
    const creation = latestState!.createProject("Created", created.root, { emitMutation: false });
    assert.equal(pending.length, 2, "creation is independent of the pending list request");
    pending[1]!.resolve({ ok: true, status: 201, json: async () => ({ ok: true, project: created }) });
    await act(async () => {
      await creation;
    });

    assert.deepEqual(
      latestState!.projects.map((entry) => entry.id),
      [created.id],
      "the successful local registration must not remain masked by the pending GET",
    );
  } finally {
    await act(async () => {
      renderer?.unmount();
    });
    globalThis.fetch = originalFetch;
    resetProjectRegistryListenersForTests();
    resetProjectsCacheForTests();
  }
});
