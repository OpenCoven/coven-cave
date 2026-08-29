import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CLIENT_V1_API_VERSION,
  CLIENT_V1_MIN_CLIENT_VERSION,
} from "./contract.ts";
import {
  CLIENT_V1_COMPATIBILITY_PRESET_ENV,
  resolveClientV1Compatibility,
} from "./conformance-compatibility.ts";
import { clientV1SuccessResponse } from "./responses.ts";

test("emits an incompatible API major from the closed conformance preset", async () => {
  const compatibility = resolveClientV1Compatibility(
    { [CLIENT_V1_COMPATIBILITY_PRESET_ENV]: "api-major" },
    true,
  );
  assert.deepEqual(compatibility, {
    kind: "override",
    apiVersion: "2.0",
    minimumClientVersion: CLIENT_V1_MIN_CLIENT_VERSION,
  });

  const response = clientV1SuccessResponse(
    { probe: "compatibility" },
    { compatibility },
  );
  const envelope = await response.json();
  assert.equal(envelope.apiVersion, "2.0");
  assert.equal(envelope.minimumClientVersion, CLIENT_V1_MIN_CLIENT_VERSION);
  assert.equal(envelope.data.probe, "compatibility");
});

test("emits an incompatible minimum client version independently", async () => {
  const compatibility = resolveClientV1Compatibility(
    { [CLIENT_V1_COMPATIBILITY_PRESET_ENV]: "minimum-client" },
    true,
  );
  assert.deepEqual(compatibility, {
    kind: "override",
    apiVersion: CLIENT_V1_API_VERSION,
    minimumClientVersion: "999.0.0",
  });

  const response = clientV1SuccessResponse(
    { probe: "compatibility" },
    { compatibility },
  );
  const envelope = await response.json();
  assert.equal(envelope.apiVersion, CLIENT_V1_API_VERSION);
  assert.equal(envelope.minimumClientVersion, "999.0.0");
});

test("invalid selectors fail closed in the enabled conformance build", () => {
  assert.deepEqual(
    resolveClientV1Compatibility(
      { [CLIENT_V1_COMPATIBILITY_PRESET_ENV]: "arbitrary-json" },
      true,
    ),
    { kind: "invalid" },
  );
});

test("the disabled build gate ignores the runtime selector", () => {
  assert.deepEqual(
    resolveClientV1Compatibility(
      { [CLIENT_V1_COMPATIBILITY_PRESET_ENV]: "api-major" },
      false,
    ),
    { kind: "disabled" },
  );
});

test("normal builds compile the compatibility control disabled", () => {
  const config = readFileSync(
    path.join(process.cwd(), "next.config.ts"),
    "utf8",
  );
  assert.match(
    config,
    /COVEN_CAVE_CLIENT_V1_COMPATIBILITY_CONTROL_ENABLED/,
  );
  assert.match(
    config,
    /process\.env\.COVEN_CAVE_CLIENT_V1_COMPATIBILITY_CONTROL === "1"/,
  );
  assert.match(
    config,
    /COVEN_CAVE_CLIENT_V1_COMPATIBILITY_CONTROL_ENABLED:\s*[\s\S]*?"0"/,
  );
});
