import assert from "node:assert/strict";
import { test } from "node:test";

import {
  emitProjectRegistryMutation,
  getProjectRegistryMutationGenerationForTests,
  resetProjectRegistryListenersForTests,
  subscribeProjectRegistryMutation,
  subscribeProjectRegistryReload,
} from "./project-registry-events.ts";

test("project registry listeners unsubscribe cleanly and fan out copied mutation payloads", () => {
  resetProjectRegistryListenersForTests();
  const calls: string[] = [];
  const startGeneration = getProjectRegistryMutationGenerationForTests();

  let unsubscribeSecond = () => {};
  let addedLate = false;

  subscribeProjectRegistryMutation(({ mutation }) => {
    calls.push(`first:${mutation.kind}`);
    unsubscribeSecond();
    if (!addedLate) {
      addedLate = true;
      subscribeProjectRegistryMutation(({ mutation: next }) => {
        calls.push(`late:${next.kind}`);
      });
    }
  });
  unsubscribeSecond = subscribeProjectRegistryMutation(({ mutation }) => {
    calls.push(`second:${mutation.kind}`);
  });
  const unsubscribeThird = subscribeProjectRegistryMutation(({ mutation }) => {
    calls.push(`third:${mutation.kind}`);
  });

  emitProjectRegistryMutation({ kind: "delete", projectId: "p1" });
  assert.equal(
    getProjectRegistryMutationGenerationForTests(),
    startGeneration + 1,
    "one emitted mutation advances the shared project generation exactly once",
  );
  assert.deepEqual(
    calls,
    ["first:delete", "second:delete", "third:delete"],
    "the first emission uses a copied listener set, so unsubscribes/additions do not disturb fanout",
  );

  calls.length = 0;
  unsubscribeThird();
  emitProjectRegistryMutation();
  assert.equal(
    getProjectRegistryMutationGenerationForTests(),
    startGeneration + 2,
    "later mutations keep advancing the shared project generation one step at a time",
  );
  assert.deepEqual(calls, ["first:refresh", "late:refresh"], "later emissions reflect the updated subscriber set");
  resetProjectRegistryListenersForTests();
});

test("reload subscriptions fan out mutation payloads without unhandled rejections", async () => {
  resetProjectRegistryListenersForTests();
  const calls: string[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    subscribeProjectRegistryReload(async ({ mutation }) => {
      calls.push(`all:${mutation.kind}`);
    });
    subscribeProjectRegistryReload(async ({ mutation }) => {
      calls.push(`sage:${mutation.kind}`);
      throw new Error("boom");
    });

    emitProjectRegistryMutation({ kind: "delete", projectId: "p1" });
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(calls, ["all:delete", "sage:delete"], "every subscribed scope reloads on the shared notification");
    assert.deepEqual(unhandled, [], "reload callbacks swallow their own rejections");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    resetProjectRegistryListenersForTests();
  }
});
