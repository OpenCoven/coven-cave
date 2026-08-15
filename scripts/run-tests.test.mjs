import assert from "node:assert/strict";
import { test } from "node:test";

import { nodeArgsFor } from "./run-tests.mjs";

test("credential settlement runs with the alias loader", () => {
  const file = "src/lib/server/client-v1/credential-settlement.test.ts";

  assert.deepEqual(nodeArgsFor(file), [
    "--require",
    "./scripts/css-source-contract-hook.cjs",
    "--experimental-strip-types",
    "--import",
    "./scripts/test-alias-register.mjs",
    file,
  ]);
});
