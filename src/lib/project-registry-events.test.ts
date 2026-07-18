import assert from "node:assert/strict";
import { test } from "node:test";

import {
  emitProjectRegistryMutation,
  getProjectRegistryMutationGenerationForTests,
  resetProjectRegistryListenersForTests,
  subscribeProjectRegistryMutation,
  subscribeProjectRegistryReload,
} from "./project-registry-events.ts";

test("project registry listeners unsubscribe cleanly and fan out over a copied set", () => {
  resetProjectRegistryListenersForTests();
  const calls: string[] = [];
  const startGeneration = getProjectRegistryMutationGenerationForTests();

  let unsubscribeSecond = () => {};
  let addedLate = false;

  subscribeProjectRegistryMutation(() => {
    calls.push("first");
    unsubscribeSecond();
    if (!addedLate) {
      addedLate = true;
      subscribeProjectRegistryMutation(() => {
        calls.push("late");
      });
    }
  });
  unsubscribeSecond = subscribeProjectRegistryMutation(() => {
    calls.push("second");
  });
  const unsubscribeThird = subscribeProjectRegistryMutation(() => {
    calls.push("third");
  });

  emitProjectRegistryMutation();
  assert.equal(
    getProjectRegistryMutationGenerationForTests(),
    startGeneration + 1,
    "one emitted mutation advances the shared project generation exactly once",
  );
  assert.deepEqual(
    calls,
    ["first", "second", "third"],
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
  assert.deepEqual(calls, ["first", "late"], "later emissions reflect the updated subscriber set");
  resetProjectRegistryListenersForTests();
});

test("reload subscriptions fan out to multiple scopes without unhandled rejections", async () => {
  resetProjectRegistryListenersForTests();
  const calls: string[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    subscribeProjectRegistryReload(async () => {
      calls.push("all");
    });
    subscribeProjectRegistryReload(async () => {
      calls.push("sage");
      throw new Error("boom");
    });

    emitProjectRegistryMutation();
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(calls, ["all", "sage"], "every subscribed scope reloads on the shared notification");
    assert.deepEqual(unhandled, [], "reload callbacks swallow their own rejections");
  } finally {
    process.off("unhandledRejection", onUnhandled);
    resetProjectRegistryListenersForTests();
  }
});
