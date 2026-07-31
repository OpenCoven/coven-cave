// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";

const readinessModule = await import("./use-local-daemon-readiness.ts").catch(
  () => ({}),
);
const createLocalDaemonReadinessController =
  readinessModule.createLocalDaemonReadinessController;

function response(ok, payload) {
  return {
    ok,
    json: async () => payload,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

test("local daemon readiness is strict, latest-request-safe, live, and unmount-safe", async () => {
  assert.equal(
    typeof createLocalDaemonReadinessController,
    "function",
    "the local daemon readiness controller is exported",
  );

  const payloads = [
    response(true, { running: true, target: { mode: "local" } }),
    response(true, { running: true, target: { mode: "hub" } }),
    response(false, { running: true, target: { mode: "local" } }),
    response(true, { running: false, target: { mode: "local" } }),
    response(true, { running: true, target: { mode: "LOCAL" } }),
  ];
  const publications = [];
  const controller = createLocalDaemonReadinessController({
    fetchImpl: async () => payloads.shift(),
    publish: (accepted) => publications.push(accepted),
  });
  controller.mount();
  for (let index = 0; index < 5; index += 1) {
    await controller.refresh();
  }
  assert.deepEqual(
    publications,
    [true, false, false, false, false],
    "only exact accepted local status is true and local-to-hub/offline loss flips false",
  );

  const older = deferred();
  const newer = deferred();
  const latestPublications = [];
  const latestController = createLocalDaemonReadinessController({
    fetchImpl: async () =>
      latestPublications.length === 0 && older.requested !== true
        ? ((older.requested = true), older.promise)
        : newer.promise,
    publish: (accepted) => latestPublications.push(accepted),
  });
  latestController.mount();
  const olderRefresh = latestController.refresh();
  const newerRefresh = latestController.refresh();
  newer.resolve(response(true, { running: true, target: { mode: "local" } }));
  await newerRefresh;
  older.resolve(response(true, { running: true, target: { mode: "hub" } }));
  await olderRefresh;
  assert.deepEqual(
    latestPublications,
    [true],
    "the later request remains authoritative when responses settle out of order",
  );

  const pending = deferred();
  const unmountedPublications = [];
  const unmountedController = createLocalDaemonReadinessController({
    fetchImpl: async () => pending.promise,
    publish: (accepted) => unmountedPublications.push(accepted),
  });
  unmountedController.mount();
  const pendingRefresh = unmountedController.refresh();
  unmountedController.unmount();
  pending.resolve(response(true, { running: true, target: { mode: "local" } }));
  await pendingRefresh;
  assert.deepEqual(
    unmountedPublications,
    [],
    "a late completion after unmount publishes nothing",
  );

  const failedPublications = [];
  const failedController = createLocalDaemonReadinessController({
    fetchImpl: async () => {
      throw new Error("offline");
    },
    publish: (accepted) => failedPublications.push(accepted),
  });
  failedController.mount();
  await failedController.refresh();
  assert.deepEqual(
    failedPublications,
    [false],
    "transport failure definitively publishes false",
  );
});
