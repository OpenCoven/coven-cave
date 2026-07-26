import assert from "node:assert/strict";

import {
  covenCliMissingError,
  isMissingExecutableError,
} from "./coven-spawn-error.ts";

const enoent = Object.assign(new Error("spawn coven ENOENT"), {
  code: "ENOENT",
  syscall: "spawn coven",
});

assert.equal(isMissingExecutableError(enoent), true);
assert.equal(isMissingExecutableError(new Error("spawn coven ENOENT")), false);

assert.deepEqual(covenCliMissingError(), {
  ok: false,
  code: "ENOENT",
  error: "Coven CLI not found on PATH. Open Setup to install it, then try again.",
});

console.log("coven-spawn-error.test.ts: ok");
