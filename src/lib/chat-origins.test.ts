import assert from "node:assert/strict";
import { test } from "node:test";
import * as origins from "./chat-origins.ts";

test("only enhance and journal are least-privilege meta runs", () => {
  assert.deepEqual([...(origins.META_RUN_ORIGINS ?? [])].sort(), ["enhance", "journal"]);
  for (const origin of ["enhance", "journal"] as const) assert.equal(origins.isMetaRunOrigin(origin), true);
  for (const origin of ["canvas", "chat", "call", "flow", null, undefined] as const) {
    assert.equal(origins.isMetaRunOrigin(origin), false);
  }
});
