import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  OPEN_COVEN_TOOLS,
  checkNpmLatestVersion,
  composeOpenCovenToolStatus,
  npmViewLaunchCommandForPath,
  openCovenToolReadinessStatuses,
} from "./opencoven-tools-status.ts";

const checkedAt = new Date("2026-07-12T16:00:00.000Z");

function verifiedProbe(version: string) {
  return {
    path: "C:\\tools\\coven.cmd",
    executablePath: "C:\\tools\\node_modules\\@opencoven\\cli\\bin\\coven.js",
    executableVerified: true,
    version,
    packageName: "@opencoven/cli",
    packagePath: "C:\\tools\\node_modules\\@opencoven\\cli",
  } as const;
}

test("local readiness completes without waiting for a blocked registry probe", async () => {
  let registryCalls = 0;
  const blockedRegistryProbe = () => {
    registryCalls += 1;
    return new Promise<never>(() => {});
  };
  // Simulate npm being hung elsewhere in the process. Readiness has no
  // dependency on that operation and must still settle.
  void blockedRegistryProbe();
  const readiness = openCovenToolReadinessStatuses({
    env: { NODE_ENV: "test", PATH: "/test" },
    discover: async () => verifiedProbe("0.1.1"),
  });
  const result = await Promise.race([
    readiness,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("readiness waited for registry")), 100),
    ),
  ]);
  assert.equal(result[0]?.compatible, true);
  assert.equal(result[0]?.latestCheck, null);
  assert.equal(registryCalls, 1);
});

async function windowsNpmShim() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "coven-npm-view-"));
  const npmCli = path.join(dir, "node_modules", "npm", "bin", "npm-cli.js");
  const npmCmd = path.join(dir, "npm.cmd");
  await mkdir(path.dirname(npmCli), { recursive: true });
  await writeFile(npmCli, "process.stdout.write('\\\"0.0.54\\\"');\n");
  await writeFile(npmCmd, "@ECHO off\r\nREM npm shim\r\n");
  return { npmCli, npmCmd };
}

test("Windows npm.cmd latest checks launch npm-cli.js through Node with fixed argv", async () => {
  const { npmCli, npmCmd } = await windowsNpmShim();
  assert.deepEqual(npmViewLaunchCommandForPath(npmCmd, "win32"), {
    command: process.execPath,
    fixedArgs: [npmCli],
  });

  const result = await checkNpmLatestVersion(OPEN_COVEN_TOOLS[0], {
    platform: "win32",
    now: () => checkedAt,
    resolveNpmPath: async () => npmCmd,
    fileExists: existsSync,
    env: () => ({ ...process.env, PATH: "C:\\fake" }),
    execFile: async (command, args, options) => {
      assert.equal(command, process.execPath, "Windows never passes npm.cmd to execFile");
      assert.deepEqual(
        args,
        [npmCli, "view", "@opencoven/cli", "version", "--json"],
        "the npm registry query is a fixed argv array",
      );
      assert.equal(options.timeout, 5000);
      return { stdout: "\"0.0.54\"" };
    },
  });

  assert.deepEqual(result, {
    status: "verified",
    checkedAt: checkedAt.toISOString(),
    latest: "0.0.54",
  });
});

test("registry timeouts return explicit freshness and error state", async () => {
  const failure = Object.assign(new Error("Command failed"), {
    killed: true,
    signal: "SIGTERM",
  });
  const latestCheck = await checkNpmLatestVersion(OPEN_COVEN_TOOLS[0], {
    now: () => checkedAt,
    resolveNpmPath: async () => process.execPath,
    execFile: async () => {
      throw failure;
    },
  });

  assert.deepEqual(latestCheck, {
    status: "failed",
    checkedAt: checkedAt.toISOString(),
    error: "timeout",
  });
  const status = composeOpenCovenToolStatus(
    OPEN_COVEN_TOOLS[0],
    verifiedProbe("0.0.53"),
    latestCheck,
  );
  assert.equal(status.latest, null);
  assert.equal(status.outdated, false, "failed checks do not imply a version comparison");
  assert.equal(status.latestCheck.status, "failed");
});

test("a verified newer npm version produces an outdated result", async () => {
  const latestCheck = await checkNpmLatestVersion(OPEN_COVEN_TOOLS[0], {
    now: () => checkedAt,
    resolveNpmPath: async () => process.execPath,
    execFile: async () => ({ stdout: "\"0.0.54\"" }),
  });
  const status = composeOpenCovenToolStatus(
    OPEN_COVEN_TOOLS[0],
    verifiedProbe("0.0.53"),
    latestCheck,
  );

  assert.equal(status.latestCheck.status, "verified");
  assert.equal(status.latest, "0.0.54");
  assert.equal(status.outdated, true);
});

test("missing npm, registry errors, and malformed versions remain explicit failures", async () => {
  const unavailable = await checkNpmLatestVersion(OPEN_COVEN_TOOLS[0], {
    now: () => checkedAt,
    resolveNpmPath: async () => null,
  });
  assert.equal(unavailable.status, "failed");
  assert.equal(unavailable.error, "npm_unavailable");

  const registryError = await checkNpmLatestVersion(OPEN_COVEN_TOOLS[0], {
    now: () => checkedAt,
    resolveNpmPath: async () => process.execPath,
    execFile: async () => {
      throw Object.assign(new Error("DNS lookup failed"), { code: "EAI_AGAIN" });
    },
  });
  assert.equal(registryError.status, "failed");
  assert.equal(registryError.error, "registry_error");

  const runtimeError = await checkNpmLatestVersion(OPEN_COVEN_TOOLS[0], {
    now: () => checkedAt,
    resolveNpmPath: async () => "/broken/node/bin/npm",
    execFile: async () => {
      throw Object.assign(
        new Error("node: error while loading shared libraries: libatomic.so.1"),
        { code: 127 },
      );
    },
  });
  assert.equal(runtimeError.status, "failed");
  assert.equal(runtimeError.error, "runtime_error");

  const malformed = await checkNpmLatestVersion(OPEN_COVEN_TOOLS[0], {
    now: () => checkedAt,
    resolveNpmPath: async () => process.execPath,
    execFile: async () => ({ stdout: "\"not-a-semver\"" }),
  });
  assert.equal(malformed.status, "failed");
  assert.equal(malformed.error, "malformed_version");
});

test("npm found only via the refreshed environment runs the query with that environment", async () => {
  const staleEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: "/stale" };
  const refreshedEnv: NodeJS.ProcessEnv = { NODE_ENV: "test", PATH: "/refreshed" };
  const seen: NodeJS.ProcessEnv[] = [];
  const result = await checkNpmLatestVersion(OPEN_COVEN_TOOLS[0], {
    now: () => checkedAt,
    env: () => staleEnv,
    refreshEnv: () => refreshedEnv,
    resolveNpmPath: async (env) => (env === refreshedEnv ? "/usr/local/bin/npm" : null),
    execFile: async (_command, _args, options) => {
      seen.push(options.env);
      return { stdout: "\"0.0.54\"" };
    },
  });
  assert.equal(result.status, "verified", "the refreshed environment recovers the lookup");
  assert.deepEqual(
    seen,
    [refreshedEnv],
    "the registry query runs with the same environment that located npm",
  );
});
