import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildAltoolArgs,
  extractDeliveryId,
  hasAltoolSemanticError,
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

test("treats semantic altool errors as failures even when the process exits zero", () => {
  assert.equal(
    hasAltoolSemanticError(
      "2026-08-16 11:52:12.969 ERROR: [altool.600003C544C0] Expected delivery ID argument is missing. (21)",
    ),
    true,
  );
  assert.equal(
    hasAltoolSemanticError('{"errors":[{"code":"ENTITY_NOT_FOUND","detail":"No matching build"}]}'),
    true,
  );
  assert.equal(hasAltoolSemanticError('{"errors":[]}'), false);
  assert.equal(hasAltoolSemanticError('{"status":"COMPLETE"}'), false);
});

test("allow-missing reserves exit 3 for Apple's explicit not-found response", () => {
  const directory = mkdtempSync(join(tmpdir(), "app-store-connect-test-"));
  const fakeXcrun = join(directory, "xcrun");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const cliPath = "scripts/app-store-connect.mjs";

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
      cwd: root,
      encoding: "utf8",
      env: {
        ...baseEnv,
        FAKE_ALTOOL_ERROR: '{"errors":[{"code":"ENTITY_NOT_FOUND"}]}',
      },
    });
    assert.equal(missing.status, 3);
    assert.match(missing.stderr, /Apple reports no matching build/);

    const authFailure = spawnSync(process.execPath, args, {
      cwd: root,
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

test("the CLI rejects a zero-exit semantic error instead of reporting processing success", () => {
  const directory = mkdtempSync(join(tmpdir(), "app-store-connect-zero-exit-test-"));
  const fakeXcrun = join(directory, "xcrun");
  const root = fileURLToPath(new URL("..", import.meta.url));

  try {
    writeFileSync(
      fakeXcrun,
      `#!/usr/bin/env node
process.stderr.write("2026-08-16 ERROR: Expected delivery ID argument is missing. (21)\\n");
process.exit(0);
`,
    );
    chmodSync(fakeXcrun, 0o755);
    const result = spawnSync(
      process.execPath,
      [
        "scripts/app-store-connect.mjs",
        "status",
        "--delivery-id",
        "delivery-uuid",
        "--wait",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          APPLE_API_KEY: "KEY123",
          APPLE_API_ISSUER: "issuer-id",
          PATH: `${directory}${delimiter}${process.env.PATH}`,
        },
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /reported an error despite exiting successfully/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("upload --wait polls the exact delivery ID returned by altool", () => {
  const directory = mkdtempSync(join(tmpdir(), "app-store-connect-upload-test-"));
  const fakeXcrun = join(directory, "xcrun");
  const ipaPath = join(directory, "CovenCave.ipa");
  const logPath = join(directory, "xcrun.jsonl");
  const root = fileURLToPath(new URL("..", import.meta.url));

  try {
    writeFileSync(ipaPath, "test ipa");
    writeFileSync(
      fakeXcrun,
      `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_XCRUN_LOG, JSON.stringify(args) + "\\n");
if (args.includes("--upload-app")) {
  process.stdout.write('{"uploaded-package":{"delivery-uuid":"returned-delivery-uuid"}}\\n');
} else if (args.includes("--build-status")) {
  process.stdout.write('{"status":"COMPLETE"}\\n');
} else {
  process.exit(2);
}
`,
    );
    chmodSync(fakeXcrun, 0o755);
    const result = spawnSync(
      process.execPath,
      ["scripts/app-store-connect.mjs", "upload", ipaPath, "--wait"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          APPLE_API_KEY: "KEY123",
          APPLE_API_ISSUER: "issuer-id",
          FAKE_XCRUN_LOG: logPath,
          PATH: `${directory}${delimiter}${process.env.PATH}`,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const invocations = readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(invocations.length, 2);
    assert.ok(invocations[0].includes("--upload-app"));
    const statusIndex = invocations[1].indexOf("--build-status");
    assert.deepEqual(
      invocations[1].slice(statusIndex, statusIndex + 4),
      [
        "--build-status",
        "--delivery-id",
        "returned-delivery-uuid",
        "--wait",
      ],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("upload --wait fails closed when altool omits the delivery ID", () => {
  const directory = mkdtempSync(join(tmpdir(), "app-store-connect-upload-no-id-test-"));
  const fakeXcrun = join(directory, "xcrun");
  const ipaPath = join(directory, "CovenCave.ipa");
  const root = fileURLToPath(new URL("..", import.meta.url));

  try {
    writeFileSync(ipaPath, "test ipa");
    writeFileSync(
      fakeXcrun,
      `#!/usr/bin/env node
process.stdout.write('{"status":"uploaded"}\\n');
`,
    );
    chmodSync(fakeXcrun, 0o755);
    const result = spawnSync(
      process.execPath,
      ["scripts/app-store-connect.mjs", "upload", ipaPath, "--wait"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          APPLE_API_KEY: "KEY123",
          APPLE_API_ISSUER: "issuer-id",
          PATH: `${directory}${delimiter}${process.env.PATH}`,
        },
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /upload succeeded but altool did not return a delivery identifier/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
