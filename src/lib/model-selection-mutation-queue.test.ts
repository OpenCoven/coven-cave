import assert from "node:assert/strict";
import { test } from "node:test";
import { createModelSelectionMutationQueue } from "./model-selection-mutation-queue.ts";

test("model selection mutations run in enqueue order after an earlier request settles", async () => {
  const queue = createModelSelectionMutationQueue();
  const order: string[] = [];
  let releaseFirst!: () => void;
  const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });

  const first = queue.enqueue(async () => {
    order.push("first-start");
    await firstReleased;
    order.push("first-end");
    return "first";
  });
  const second = queue.enqueue(async () => {
    order.push("second-start");
    return "second";
  });

  await Promise.resolve();
  assert.deepEqual(order, ["first-start"], "the newer mutation waits for the older write");
  releaseFirst();
  assert.equal(await first, "first");
  assert.equal(await second, "second");
  assert.deepEqual(order, ["first-start", "first-end", "second-start"]);
});

test("a rejected mutation does not strand later selections", async () => {
  const queue = createModelSelectionMutationQueue();
  const second = queue.enqueue(async () => {
    throw new Error("offline");
  });
  const third = queue.enqueue(async () => "next");

  await assert.rejects(second, /offline/);
  assert.equal(await third, "next");
});

console.log("model-selection-mutation-queue.test.ts: ok");
