import assert from "node:assert/strict";
import test from "node:test";
import {
  canRepairDetectedCovenWithHostNpm,
  classifyOnboardingInstallFailure,
  installerErrorCode,
  installStartErrorMessage,
} from "./install-service.ts";

test("Coven CLI repair uses host npm only for Windows npm command shims", () => {
  assert.equal(canRepairDetectedCovenWithHostNpm("C:\\Users\\coven.cmd", "win32"), true);
  assert.equal(canRepairDetectedCovenWithHostNpm("C:\\Users\\coven.bat", "win32"), true);
  assert.equal(canRepairDetectedCovenWithHostNpm("C:\\Program Files\\Coven\\coven.exe", "win32"), false);
  assert.equal(canRepairDetectedCovenWithHostNpm("/usr/local/bin/coven", "linux"), true);
});

const cases = [
  {
    name: "timeout",
    input: { code: null, output: "install timed out after 240s" },
    expected: "install_timeout",
  },
  {
    name: "launch",
    input: { code: null, output: "", launchFailed: true },
    expected: "installer_start_failed",
  },
  {
    name: "Windows access-denied launch",
    input: {
      code: null,
      output: "",
      error: "Installer launch failed with EACCES.",
      launchFailed: true,
    },
    expected: "filesystem_failed",
  },
  {
    name: "integrity",
    input: { code: 1, output: "npm integrity checksum mismatch" },
    expected: "integrity_check_failed",
  },
  {
    name: "archive",
    input: { code: 1, output: "could not unpack archive" },
    expected: "archive_failed",
  },
  {
    name: "download",
    input: { code: 1, output: "registry network request failed" },
    expected: "download_failed",
  },
  {
    name: "filesystem",
    input: { code: 1, output: "EACCES in the selected host npm prefix" },
    expected: "filesystem_failed",
  },
  {
    name: "verification",
    input: { code: 0, output: "binary still missing after install" },
    expected: "verification_failed",
  },
  {
    name: "verification despite historical success output",
    input: { code: 0, output: "download complete; checksum verified; archive unpacked" },
    expected: "verification_failed",
  },
  {
    name: "verification despite historical timeout output",
    input: { code: 0, output: "installer warning: request timed out; verification failed" },
    expected: "verification_failed",
  },
  {
    name: "busy executable conflict",
    input: { code: 1, output: "EBUSY: coven.exe is locked" },
    expected: "install_busy",
  },
  {
    name: "integrity output that names the executable",
    input: { code: 1, output: "checksum mismatch for C:\\tools\\coven.exe" },
    expected: "integrity_check_failed",
  },
  {
    name: "download output that names the executable",
    input: { code: 1, output: "download failed before writing coven.exe" },
    expected: "download_failed",
  },
  {
    name: "unknown output that only names the executable",
    input: { code: 1, output: "coven.exe returned EWHAT" },
    expected: "unknown_failure",
  },
  {
    name: "local service recovery",
    input: {
      code: 0,
      output: "install completed",
      recoveryFailed: true,
    },
    expected: "local_service_failed",
  },
  {
    name: "unknown",
    input: { code: 1, output: "installer returned EWHAT" },
    expected: "unknown_failure",
  },
] as const;

for (const fixture of cases) {
  test(`install service classifies ${fixture.name} failures`, () => {
    assert.equal(
      classifyOnboardingInstallFailure(fixture.input),
      fixture.expected,
    );
  });
}

test("installer launch diagnostics retain only stable Windows error codes", () => {
  const error = Object.assign(
    new Error("spawn C:\\Users\\Sage\\private\\node.exe EACCES"),
    { code: "EACCES", path: "C:\\Users\\Sage\\private\\node.exe" },
  );

  assert.equal(installerErrorCode(error), "EACCES");
  assert.equal(
    installStartErrorMessage(error),
    "The operating system blocked Cave from starting the installer (EACCES). Check the affected user-scoped location and security controls, then retry setup.",
  );
  assert.doesNotMatch(installStartErrorMessage(error), /Sage|node\.exe/);
});

test("missing installer executables produce an actionable restart message", () => {
  const error = Object.assign(new Error("spawn node.exe ENOENT"), {
    code: "ENOENT",
  });

  assert.equal(installerErrorCode(error), "ENOENT");
  assert.match(installStartErrorMessage(error), /reviewed executable was missing/);
  assert.match(installStartErrorMessage(error), /Restart Cave/);
});

test("installer resource failures do not overstate the exhausted resource", () => {
  const error = Object.assign(new Error("spawn node.exe ENFILE"), {
    code: "ENFILE",
  });

  assert.equal(installerErrorCode(error), "ENFILE");
  assert.equal(
    installStartErrorMessage(error),
    "Cave could not start the installer because system resources are temporarily exhausted. Close other apps or processes, wait a moment, then click Install again.",
  );
  assert.doesNotMatch(installStartErrorMessage(error), /process slots/);
});

console.log("onboarding install-service.test.ts: ok");
