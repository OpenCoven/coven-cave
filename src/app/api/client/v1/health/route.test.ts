import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_V1_API_VERSION,
  CLIENT_V1_CAPABILITIES,
  CLIENT_V1_MIN_CLIENT_VERSION,
} from "@/lib/server/client-v1/contract.ts";

import { GET } from "./route.ts";

test("health returns the deterministic secret-free client-v1 success envelope", async () => {
  const first = await GET();
  const second = await GET();
  const expected = {
    apiVersion: CLIENT_V1_API_VERSION,
    minimumClientVersion: CLIENT_V1_MIN_CLIENT_VERSION,
    capabilities: [...CLIENT_V1_CAPABILITIES],
    data: { status: "ok" },
  };

  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), expected);
  assert.deepEqual(await second.json(), expected);
  assert.equal(JSON.stringify(expected).includes("secret"), false);
  assert.equal(expected.capabilities.includes("pairing"), true);
  assert.equal(expected.capabilities.includes("credentials"), true);
});
