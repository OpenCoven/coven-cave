// @ts-nocheck
import assert from "node:assert/strict";
import { scheduleDeferredDelete } from "./use-undo-delete.ts";

let deletes = 0;
const cancelled = scheduleDeferredDelete(async () => {
  deletes += 1;
}, 10);
clearTimeout(cancelled); // the same cancellation used by Undo
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(deletes, 0, "undo before commit sends no DELETE request");

scheduleDeferredDelete(async () => {
  deletes += 1;
}, 5);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(deletes, 1, "an un-cancelled deferred delete commits exactly once");

console.log("use-undo-delete-deferred.test.ts passed");
