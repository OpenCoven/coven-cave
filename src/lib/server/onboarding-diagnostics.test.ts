import assert from "node:assert/strict";
import test from "node:test";
import {
  createOnboardingSetupDiagnostics,
  diagnosticInstaller,
  normalizePersistedOnboardingSetupDiagnostics,
  sanitizeOnboardingDiagnosticLines,
} from "./onboarding-diagnostics.ts";

test("diagnostic installer output removes secrets and machine-local paths", () => {
  const lines = sanitizeOnboardingDiagnosticLines([
    "@opencoven/cli EUNKNOWN",
    "Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456",
    "NPM_TOKEN=npm_super_secret_value",
    "/home/sage/private/project/node_modules failed",
    "C:\\Users\\Sage\\AppData\\Local\\OpenCoven\\secret failed",
    "cwd=/home/sage/private/project",
    "cache=C:\\Users\\Sage\\AppData\\Local\\OpenCoven",
    "https://registry.example.test/pkg?token=secret#private",
  ].join("\n"));
  const text = lines.join("\n");

  assert.match(text, /@opencoven\/cli EUNKNOWN/);
  assert.match(text, /registry\.example\.test\/pkg/);
  assert.doesNotMatch(
    text,
    /ghp_|npm_super_secret|token=secret|\/home\/sage|C:\\Users\\Sage|#private/,
  );
  assert.match(text, /local path omitted|redacted/i);
});

test("diagnostic output enforces independent line and character budgets", () => {
  const value = Array.from(
    { length: 20 },
    (_, index) => `line-${index} ${"package verification failed ".repeat(20)}`,
  ).join("\n");
  const lines = sanitizeOnboardingDiagnosticLines(value);

  assert.equal(lines.length, 6);
  assert.match(lines[0] ?? "", /^line-14 /);
  assert.match(lines.at(-1) ?? "", /^line-19 /);
  assert.ok(lines.join("\n").length <= 1_600);
  assert.ok(lines.every((line) => line.length <= 280));
});

test("installer diagnostics retain allowlisted codes without raw job internals", () => {
  const unsafeView = {
    status: "done",
    code: 17,
    elapsedMs: 321.4,
    tail: "Node archive digest failed with ECHK",
    binaryPath: "/home/sage/.local/share/private/node",
    verification: { token: "secret" },
    daemon: { path: "/home/sage/private" },
  };
  const installer = diagnosticInstaller("coven-cli", unsafeView);

  assert.deepEqual(installer, {
    target: "coven-cli",
    status: "done",
    elapsedMs: 321,
    exitCode: 17,
    outputTail: ["Node archive digest failed with ECHK"],
  });
});

test("managed Node diagnostics omit synthetic process exit codes", () => {
  const installer = diagnosticInstaller("managed-node", {
    status: "done",
    code: 1,
    tail: "Node archive download failed",
  });

  assert.equal(installer.exitCode, null);
});

test("long installer output cannot erase stable lifecycle trace facts", () => {
  const installer = diagnosticInstaller("coven-cli", {
    status: "done",
    code: 1,
    diagnosticTrace: [
      "Managed toolchain/install lane: reserved.",
      "Installer process: exited with code 1.",
    ],
    tail: Array.from(
      { length: 20 },
      (_, index) => `npm output line ${index}`,
    ).join("\n"),
  });

  assert.equal(installer.outputTail.length, 6);
  assert.match(installer.outputTail[0] ?? "", /lane: reserved/);
  assert.match(installer.outputTail[1] ?? "", /exited with code 1/);
  assert.match(installer.outputTail.at(-1) ?? "", /npm output line 19/);
  assert.ok(installer.outputTail.join("\n").length <= 1_600);
});

test("combined trace and output charge their separating newline to the shared cap", () => {
  const installer = diagnosticInstaller("coven-cli", {
    status: "done",
    code: 1,
    diagnosticTrace: Array.from(
      { length: 4 },
      (_, index) => `trace ${index} ${"reserved lane ".repeat(40)}`,
    ),
    tail: Array.from(
      { length: 8 },
      (_, index) => `output ${index} ${"package failure ".repeat(40)}`,
    ).join("\n"),
  });

  assert.ok(installer.outputTail.join("\n").length <= 1_600);
});

test("persisted diagnostic snapshots are rebuilt from a strict safe allowlist", () => {
  const normalized = normalizePersistedOnboardingSetupDiagnostics({
    version: 1,
    capturedAt: "2026-08-10T12:34:56.000Z",
    stage: "core-tools",
    code: "download_failed",
    summary: "token=secret and /home/sage/private",
    nextStep: "run rm -rf",
    environment: {
      appVersion: "malicious-build-/home/sage",
      platform: "linux",
      architecture: "x64",
      env: { NPM_TOKEN: "secret" },
    },
    applicationData: {
      displayLocation: "/home/sage/private",
      exists: true,
      writeProbe: "passed",
    },
    components: {
      managedNode: "missing",
      covenCli: "unknown",
      localService: "not_checked",
    },
    installer: {
      target: "managed-node",
      status: "done",
      elapsedMs: 500,
      exitCode: 1,
      outputTail: [
        "download EAI_AGAIN",
        "Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456",
        "/home/sage/private/cache failed",
      ],
      rawEnvironment: { NPM_TOKEN: "secret" },
    },
    rawLog: "token=secret",
  });

  assert.ok(normalized);
  assert.equal(normalized.summary, "Cave couldn’t download its local components.");
  assert.equal(normalized.applicationData.displayLocation, "Cave application data");
  assert.equal(normalized.installer?.exitCode, null);
  const serialized = JSON.stringify(normalized);
  assert.doesNotMatch(
    serialized,
    /malicious-build|Authorization|ghp_|NPM_TOKEN|\/home\/sage|rawLog/,
  );
  assert.match(serialized, /EAI_AGAIN/);
});

test("persisted diagnostics reject invalid timestamps instead of making stale evidence current", () => {
  const normalized = normalizePersistedOnboardingSetupDiagnostics({
    version: 1,
    capturedAt: "not-a-timestamp",
    stage: "core-tools",
    code: "unknown_failure",
    environment: {},
    applicationData: { exists: null, writeProbe: "not_run" },
    components: {},
  });

  assert.equal(normalized, null);
});

for (const writeProbe of ["passed", "not_run", undefined] as const) {
  test(`persisted application-data claims require a failed write probe (${String(writeProbe)})`, () => {
    const normalized = normalizePersistedOnboardingSetupDiagnostics({
      version: 1,
      capturedAt: "2026-08-10T12:34:56.000Z",
      stage: "core-tools",
      code: "application_data_not_writable",
      environment: { platform: "linux", architecture: "x64" },
      applicationData: { exists: true, ...(writeProbe ? { writeProbe } : {}) },
      components: {},
    });

    assert.equal(normalized?.code, "filesystem_failed");
    assert.doesNotMatch(normalized?.summary ?? "", /application-data folder/i);
  });
}

test("generated snapshots persist only the bounded diagnostic contract", () => {
  const diagnostics = createOnboardingSetupDiagnostics({
    stage: "workspace",
    code: "application_data_not_writable",
    capturedAt: "2026-08-10T12:34:56.000Z",
    applicationData: { exists: true, writeProbe: "failed" },
  });
  const serialized = JSON.stringify({ failure: { diagnostics } });
  const persisted = JSON.parse(serialized).failure.diagnostics;

  assert.match(serialized, /application_data_not_writable/);
  assert.deepEqual(Object.keys(persisted).sort(), [
    "applicationData",
    "capturedAt",
    "code",
    "components",
    "environment",
    "nextStep",
    "stage",
    "summary",
    "version",
  ]);
  assert.doesNotMatch(serialized, /"(?:stack|environmentVariables|rawLog)"\s*:/i);
});

console.log("onboarding-diagnostics.test.ts: ok");
