import assert from "node:assert/strict";
import test from "node:test";
import {
  canRepairDetectedCovenWithHostNpm,
  classifyOnboardingInstallFailure,
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

console.log("onboarding install-service.test.ts: ok");
