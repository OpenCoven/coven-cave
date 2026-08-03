// @ts-nocheck
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { listGrokModels } from "./grok-models.ts";

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => true;
  return child;
}

const failedChild = fakeChild();
const failed = listGrokModels("sage", {
  binary: () => "grok",
  env: () => ({}),
  spawnImpl: () => failedChild,
});
failedChild.stdout.emit(
  "data",
  "Default model: grok-4.5\n\nAvailable models:\n  * grok-4.5 (default)\n",
);
failedChild.emit("close", 1);
assert.deepEqual(
  await failed,
  [],
  "parseable output from a failed Grok command must not claim live inventory",
);

const successfulChild = fakeChild();
const successful = listGrokModels("sage", {
  binary: () => "grok",
  env: () => ({}),
  spawnImpl: () => successfulChild,
});
successfulChild.stdout.emit(
  "data",
  "Default model: grok-4.5\n\nAvailable models:\n  * grok-4.5 (default)\n",
);
successfulChild.emit("close", 0);
assert.deepEqual(await successful, [{ id: "grok-4.5", label: "grok-4.5 (default)" }]);

console.log("server/grok-models.test.ts: ok");
