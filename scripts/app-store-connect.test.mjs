import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildAltoolArgs,
  extractDeliveryId,
  isBuildNotFound,
  parseCommand,
} from "./app-store-connect.mjs";

test("builds authenticated validation and upload commands", () => {
  const auth = {
    keyId: "KEY123",
    issuerId: "issuer-id",
    subject: "user",
  };

  assert.deepEqual(buildAltoolArgs({ command: "validate", ipaPath: "/tmp/Cave.ipa" }, auth), [
    "altool",
    "--validate-app",
    "/tmp/Cave.ipa",
    "--type",
    "ios",
    "--api-key",
    "KEY123",
    "--api-issuer",
    "issuer-id",
    "--api-key-subject",
    "user",
    "--output-format",
    "json",
  ]);
  assert.deepEqual(buildAltoolArgs({ command: "upload", ipaPath: "/tmp/Cave.ipa" }, auth), [
    "altool",
    "--upload-app",
    "-f",
    "/tmp/Cave.ipa",
    "--type",
    "ios",
    "--api-key",
    "KEY123",
    "--api-issuer",
    "issuer-id",
    "--api-key-subject",
    "user",
    "--output-format",
    "json",
  ]);
});

test("lists App Store Connect apps to discover the numeric app ID", () => {
  assert.deepEqual(
    buildAltoolArgs(
      { command: "apps" },
      { keyId: "KEY123", issuerId: "issuer-id" },
    ),
    [
      "altool",
      "--list-apps",
      "--api-key",
      "KEY123",
      "--api-issuer",
      "issuer-id",
      "--output-format",
      "json",
    ],
  );
  assert.deepEqual(parseCommand(["apps"]), { command: "apps" });
});

test("builds delivery and version status commands", () => {
  const auth = { keyId: "KEY123", issuerId: "issuer-id" };

  assert.deepEqual(
    buildAltoolArgs({ command: "status", deliveryId: "delivery-uuid", wait: true }, auth),
    [
      "altool",
      "--build-status",
      "--delivery-id",
      "delivery-uuid",
      "--wait",
      "--api-key",
      "KEY123",
      "--api-issuer",
      "issuer-id",
      "--output-format",
      "json",
    ],
  );
  assert.deepEqual(
    buildAltoolArgs(
      {
        command: "status",
        appleId: "1234567890",
        bundleVersion: "2026081101",
        shortVersion: "0.2.6",
        wait: false,
      },
      auth,
    ),
    [
      "altool",
      "--build-status",
      "--apple-id",
      "1234567890",
      "--bundle-version",
      "2026081101",
      "--bundle-short-version-string",
      "0.2.6",
      "--platform",
      "ios",
      "--api-key",
      "KEY123",
      "--api-issuer",
      "issuer-id",
      "--output-format",
      "json",
    ],
  );
});

test("parses supported commands and rejects incomplete status selectors", () => {
  assert.deepEqual(parseCommand(["upload", "/tmp/Cave.ipa", "--wait"]), {
    command: "upload",
    ipaPath: "/tmp/Cave.ipa",
    wait: true,
  });
  assert.throws(
    () => parseCommand(["status", "--apple-id", "123"]),
    /requires .*--bundle-version and --short-version/,
  );
  assert.deepEqual(
    parseCommand([
      "status",
      "--apple-id",
      "123",
      "--bundle-version",
      "4",
      "--short-version",
      "1.0.0",
      "--allow-missing",
    ]),
    {
      command: "status",
      wait: false,
      allowMissing: true,
      appleId: "123",
      bundleVersion: "4",
      shortVersion: "1.0.0",
    },
  );
});

test("extracts delivery identifiers from nested altool JSON", () => {
  assert.equal(
    extractDeliveryId(JSON.stringify({ "uploaded-package": { "delivery-uuid": "delivery-uuid" } })),
    "delivery-uuid",
  );
  assert.equal(
    extractDeliveryId(JSON.stringify({ data: [{ RequestUUID: "request-uuid" }] })),
    "request-uuid",
  );
  assert.equal(
    extractDeliveryId('warning: retrying\n{"RequestUUID":"logged-request-uuid"}'),
    "logged-request-uuid",
  );
  assert.equal(extractDeliveryId("not json"), null);
});

test("recognizes only explicit build-not-found responses", () => {
  assert.equal(
    isBuildNotFound('{"errors":[{"code":"ENTITY_NOT_FOUND","detail":"No matching build"}]}'),
    true,
  );
  assert.equal(isBuildNotFound("Could not find a build matching those versions"), true);
  assert.equal(isBuildNotFound("Authentication failed"), false);
  assert.equal(isBuildNotFound("The network connection was lost"), false);
  assert.equal(isBuildNotFound("Build processing status is INVALID"), false);
});

test("allow-missing reserves exit 3 for Apple's explicit not-found response", () => {
  const directory = mkdtempSync(join(tmpdir(), "app-store-connect-test-"));
  const fakeXcrun = join(directory, "xcrun");
  const cliPath = fileURLToPath(new URL("./app-store-connect.mjs", import.meta.url));

  try {
    writeFileSync(
      fakeXcrun,
      `#!/usr/bin/env node
process.stderr.write(process.env.FAKE_ALTOOL_ERROR);
process.exit(1);
`,
    );
    chmodSync(fakeXcrun, 0o755);
    const baseEnv = {
      ...process.env,
      APPLE_API_KEY: "KEY123",
      APPLE_API_ISSUER: "issuer-id",
      PATH: `${directory}${delimiter}${process.env.PATH}`,
    };
    const args = [
      cliPath,
      "status",
      "--apple-id",
      "123",
      "--bundle-version",
      "4",
      "--short-version",
      "1.0.0",
      "--allow-missing",
    ];

    const missing = spawnSync(process.execPath, args, {
      encoding: "utf8",
      env: {
        ...baseEnv,
        FAKE_ALTOOL_ERROR: '{"errors":[{"code":"ENTITY_NOT_FOUND"}]}',
      },
    });
    assert.equal(missing.status, 3);
    assert.match(missing.stderr, /Apple reports no matching build/);

    const authFailure = spawnSync(process.execPath, args, {
      encoding: "utf8",
      env: {
        ...baseEnv,
        FAKE_ALTOOL_ERROR: '{"errors":[{"code":"NOT_AUTHORIZED"}]}',
      },
    });
    assert.equal(authFailure.status, 1);
    assert.doesNotMatch(authFailure.stderr, /Apple reports no matching build/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
