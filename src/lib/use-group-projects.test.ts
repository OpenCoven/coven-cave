// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { resetProjectRegistryListenersForTests } from "./project-registry-events.ts";
import { resetProjectsCacheForTests } from "./use-projects-cache.ts";
import { useGroupProjects } from "./use-group-projects.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ familiarIds, snapshots }) {
  const state = useGroupProjects(familiarIds);
  snapshots.push({
    ids: state.projects.map((project) => project.id),
    access: state.projects.map((project) => project.access),
    loading: state.loading,
    loadedSuccessfully: state.loadedSuccessfully,
  });
  return createElement("group-project-probe");
}

const project = (id, access) => ({
  id,
  name: id,
  root: `/repo/${id}`,
  access,
  createdAt: "now",
  updatedAt: "now",
});

test("loads each familiar scope and exposes only their verified intersection", async () => {
  const originalFetch = globalThis.fetch;
  resetProjectRegistryListenersForTests();
  resetProjectsCacheForTests();
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("familiarId=alpha")) {
      return { ok: true, json: async () => ({ ok: true, projects: [project("shared", "write"), project("alpha", "write")] }) };
    }
    if (url.endsWith("familiarId=beta")) {
      return { ok: true, json: async () => ({ ok: true, projects: [project("shared", "read"), project("beta", "write")] }) };
    }
    throw new Error(`unexpected URL: ${url}`);
  });
  const snapshots = [];
  let renderer = null;

  try {
    await act(async () => {
      renderer = create(createElement(Probe, { familiarIds: ["beta", "alpha"], snapshots }));
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.deepEqual(snapshots.at(-1)?.ids, ["shared"]);
    assert.deepEqual(snapshots.at(-1)?.access, ["read"]);
    assert.equal(snapshots.at(-1)?.loadedSuccessfully, true);
  } finally {
    await act(async () => renderer?.unmount());
    globalThis.fetch = originalFetch;
    resetProjectRegistryListenersForTests();
    resetProjectsCacheForTests();
  }
});

test("a participant-scope change masks the previous group's choices immediately", async () => {
  const originalFetch = globalThis.fetch;
  const pending = [];
  resetProjectRegistryListenersForTests();
  resetProjectsCacheForTests();
  globalThis.fetch = (async (input) =>
    await new Promise((resolve) => pending.push({ url: String(input), resolve })));
  const snapshots = [];
  let renderer = null;

  const settle = async (request, projects) => {
    await act(async () => {
      request.resolve({ ok: true, json: async () => ({ ok: true, projects }) });
      await Promise.resolve();
    });
  };

  try {
    await act(async () => {
      renderer = create(createElement(Probe, { familiarIds: ["alpha"], snapshots }));
    });
    await settle(pending.shift(), [project("alpha", "write")]);
    assert.deepEqual(snapshots.at(-1)?.ids, ["alpha"]);

    snapshots.length = 0;
    await act(async () => {
      renderer.update(createElement(Probe, { familiarIds: ["beta"], snapshots }));
    });
    assert.ok(
      snapshots.every((snapshot) => snapshot.ids.length === 0 && !snapshot.loadedSuccessfully),
      "the prior familiar's project must never remain selectable during the new load",
    );
  } finally {
    await act(async () => renderer?.unmount());
    globalThis.fetch = originalFetch;
    resetProjectRegistryListenersForTests();
    resetProjectsCacheForTests();
  }
});
