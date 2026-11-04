import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setImmediate } from "node:timers/promises";
import { MANAGED_NODE_VERSION, nodeArchiveFor } from "@/lib/onboarding-prerequisites";
import { globalNpmInstallOwner } from "@/lib/server/global-npm-install-lane";
import { installManagedNodeToolchain, managedNodePaths } from "@/lib/server/managed-node-toolchain";
import { ensureOnboardingCoreTools } from "@/lib/server/onboarding-core-tools";
import {
  canRepairDetectedCovenWithHostNpm,
  classifyOnboardingInstallFailure,
  installerErrorCode,
  installStartErrorMessage,
  DELETE,
  readOnboardingInstall,
  startOnboardingInstall,
} from "./install-service.ts";

test("cancellation during final Node verification stops setup even if reinspection is ready", { timeout: 5_000 }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), "coven-install-cancel-"));
  const env = { NODE_ENV: "test" } as const;
  const paths = managedNodePaths("linux", "x64", env, home);
  const artifact = nodeArchiveFor("linux", "x64");
  assert.ok(paths);
  assert.ok(artifact);
  let probes = 0;
  let inspections = 0;
  const starts: string[] = [];
  const install: typeof installManagedNodeToolchain = (options) => installManagedNodeToolchain({
    ...options,
    platform: "linux",
    architecture: "x64",
    env,
    home,
    fetch: async () => {
      const response = new Response("synthetic reviewed archive");
      Object.defineProperty(response, "url", { value: artifact.url });
      return response;
    },
    dependencies: {
      digest: () => artifact.sha256,
      extractArchive: async (_format, _archive, destination) => {
        await mkdir(path.join(destination, `node-v${MANAGED_NODE_VERSION}-linux-x64`));
      },
      probe: async () => {
        if (++probes === 1) return { status: "missing", paths };
        const cancelled = await DELETE(new Request("http://localhost/api/onboarding/install?target=managed-node", {
          method: "DELETE",
          headers: { host: "localhost" },
        }));
        assert.equal(cancelled.status, 200);
        assert.equal(options?.signal?.aborted, true);
        return { status: "unusable", paths, detail: "Node probe timed out" };
      },
    },
  });
  try {
    assert.equal(globalNpmInstallOwner(), null);
    const result = await ensureOnboardingCoreTools(async () => {}, {
      platform: "linux",
      inspect: async () => {
        inspections += 1;
        return {
          runtimeReady: inspections > 1,
          coreToolsReady: inspections > 2,
          components: {
            managedNode: inspections > 1 ? "ready" : "missing",
            covenCli: inspections > 2 ? "ready" : "missing",
          },
        };
      },
      startInstall: async (target) => {
        starts.push(target);
        return target === "managed-node"
          ? startOnboardingInstall(target, install)
          : { status: 202, body: { status: "started", started: true } };
      },
      readInstall: (target) => target === "managed-node"
        ? readOnboardingInstall(target)
        : { status: "done", ok: true, code: 0 },
      probeManagedNodeWrite: async () => ({ exists: true, writeProbe: "passed" }),
      now: Date.now,
      wait: async () => { await setImmediate(); },
    });
    assert.equal(result.ok, false, "a later ready inspection must not override user cancellation");
    assert.deepEqual(starts, ["managed-node"], "cancellation must not launch the CLI installer");
    assert.equal(inspections, 2);
    assert.equal(probes, 2);
    const job = readOnboardingInstall("managed-node");
    assert.equal(job.status, "done");
    assert.equal(job.ok, false);
    assert.equal(job.error, "install cancelled");
    assert.equal(job.failureCode, "unknown_failure");
    assert.equal(globalNpmInstallOwner(), null, "cancellation releases the install lane");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

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
