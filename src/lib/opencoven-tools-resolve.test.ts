import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  isNodeModulesPackagePath,
  npmGlobalPrefixFromNpmPath,
  removeLauncherFile,
  resolveStaleOpenCovenLaunchers,
  type StaleLauncherDependencies,
} from "./opencoven-tools-resolve.ts";
import type { OpenCovenToolProbe } from "./opencoven-tool-verification.ts";

const LATEST = "0.1.1";
const GOOD_PATH = "/home/user/.local/bin/coven";
const GOOD_PKG = "/home/user/.local/lib/node_modules/@opencoven/cli";

function probe(overrides: Partial<OpenCovenToolProbe>): OpenCovenToolProbe {
  return {
    path: GOOD_PATH,
    executablePath: `${GOOD_PKG}/bin/coven.js`,
    executableVerified: true,
    version: LATEST,
    packageName: "@opencoven/cli",
    packagePath: GOOD_PKG,
    ...overrides,
  };
}

function staleProbe(binPath: string, version: string): OpenCovenToolProbe {
  const pkg = `${path.dirname(path.dirname(binPath))}/lib/node_modules/@opencoven/cli`;
  return probe({
    path: binPath,
    executablePath: `${pkg}/bin/coven.js`,
    packagePath: pkg,
    version,
  });
}

function makeDeps({
  discoverQueue,
  goodProbe = probe({}),
  existing = new Set([GOOD_PATH]),
  removeError,
}: {
  discoverQueue: OpenCovenToolProbe[];
  goodProbe?: OpenCovenToolProbe;
  existing?: Set<string>;
  removeError?: Error;
}): { deps: StaleLauncherDependencies; removed: string[] } {
  const removed: string[] = [];
  const deps: StaleLauncherDependencies = {
    platform: "linux",
    refreshEnv: () => ({ NODE_ENV: "test" }),
    npmGlobalPrefix: async () => "/home/user/.local",
    discover: async () => {
      const next = discoverQueue.shift();
      assert.ok(next, "discover called more times than the scripted queue expected");
      return next;
    },
    probeAt: async (_tool, binaryPath) => {
      assert.equal(binaryPath, GOOD_PATH, "the fresh copy is probed at npm's global bin");
      return goodProbe;
    },
    fileExists: async (file) => existing.has(file),
    removeFile: async (file) => {
      if (removeError) throw removeError;
      removed.push(file);
      existing.delete(file);
    },
  };
  return { deps, removed };
}

test("removes an orphaned same-package stale launcher, then verifies the fresh copy", async () => {
  const stale = staleProbe("/home/user/.nvm/versions/node/v24.13.0/bin/coven", "0.0.54");
  const { deps, removed } = makeDeps({
    discoverQueue: [stale, probe({})],
    existing: new Set([GOOD_PATH, stale.path!]),
  });

  const resolution = await resolveStaleOpenCovenLaunchers("coven-cli", LATEST, deps);

  assert.deepEqual(removed, [stale.path]);
  assert.deepEqual(resolution.removed, [stale.path]);
  assert.equal(resolution.hint, null);
  assert.ok(resolution.verification?.ok, "final verification succeeds after removal");
  assert.equal(resolution.verification?.current, LATEST);
  assert.match(resolution.log[0]!, /Removed stale coven launcher .* \(0\.0\.54\)/);
  assert.match(resolution.log[1]!, /now resolves at .*\.local\/bin\/coven \(0\.1\.1\)/);
});

test("clears multiple stacked stale launchers in one pass", async () => {
  const nvm = staleProbe("/home/user/.nvm/versions/node/v24.13.0/bin/coven", "0.0.54");
  const brew = staleProbe("/opt/homebrew/bin/coven", "0.0.31");
  const { deps, removed } = makeDeps({
    discoverQueue: [nvm, brew, probe({})],
    existing: new Set([GOOD_PATH, nvm.path!, brew.path!]),
  });

  const resolution = await resolveStaleOpenCovenLaunchers("coven-cli", LATEST, deps);

  assert.deepEqual(removed, [nvm.path, brew.path]);
  assert.ok(resolution.verification?.ok);
});

test("refuses to remove a launcher owned by a different package and hints instead", async () => {
  const foreign = probe({
    path: "/home/user/.cargo/bin/coven",
    executablePath: "/home/user/.cargo/bin/coven",
    executableVerified: false,
    version: "0.0.30",
    packageName: null,
    packagePath: null,
  });
  const { deps, removed } = makeDeps({ discoverQueue: [foreign] });

  const resolution = await resolveStaleOpenCovenLaunchers("coven-cli", LATEST, deps);

  assert.deepEqual(removed, []);
  assert.equal(resolution.verification?.ok, false);
  assert.match(resolution.hint!, /\.cargo\/bin\/coven belongs to an unrecognized launcher/);
  assert.match(resolution.hint!, /Move npm's global bin/);
});

test("an equal-version verified copy first on PATH simply verifies — no removal", async () => {
  const equalVersion = probe({
    path: "/opt/other/bin/coven",
    packagePath: "/opt/other/lib/node_modules/@opencoven/cli",
    executablePath: "/opt/other/lib/node_modules/@opencoven/cli/bin/coven.js",
  });
  const { deps, removed } = makeDeps({
    discoverQueue: [equalVersion],
    existing: new Set([GOOD_PATH, equalVersion.path!]),
  });

  const resolution = await resolveStaleOpenCovenLaunchers("coven-cli", LATEST, deps);

  assert.deepEqual(removed, []);
  assert.equal(resolution.hint, null);
  assert.ok(resolution.verification?.ok, "another equally-new verified install is not stale");
});

test("refuses removal when the shadow is not strictly behind the fresh copy (latest unknown)", async () => {
  const equalVersion = probe({
    path: "/opt/other/bin/coven",
    packagePath: "/opt/other/lib/node_modules/@opencoven/cli",
    executablePath: "/opt/other/lib/node_modules/@opencoven/cli/bin/coven.js",
  });
  const { deps, removed } = makeDeps({
    discoverQueue: [equalVersion],
    existing: new Set([GOOD_PATH, equalVersion.path!]),
  });

  const resolution = await resolveStaleOpenCovenLaunchers("coven-cli", null, deps);

  assert.deepEqual(removed, []);
  assert.ok(resolution.hint, "a non-removable copy still yields manual guidance");
});

test("never acts when the fresh npm-prefix copy is missing or unverified", async () => {
  const stale = staleProbe("/home/user/.nvm/versions/node/v24.13.0/bin/coven", "0.0.54");
  const missing = makeDeps({
    discoverQueue: [stale],
    existing: new Set([stale.path!]),
  });
  const missingResolution = await resolveStaleOpenCovenLaunchers(
    "coven-cli",
    LATEST,
    missing.deps,
  );
  assert.deepEqual(missing.removed, []);
  assert.match(missingResolution.log[0]!, /no coven launcher found under npm's global prefix/);

  const unverified = makeDeps({
    discoverQueue: [stale, stale],
    goodProbe: probe({ version: "0.0.54" }),
    existing: new Set([GOOD_PATH, stale.path!]),
  });
  const unverifiedResolution = await resolveStaleOpenCovenLaunchers(
    "coven-cli",
    LATEST,
    unverified.deps,
  );
  assert.deepEqual(unverified.removed, []);
  assert.match(
    unverifiedResolution.log[0]!,
    /did not verify as the freshly installed @opencoven\/cli/,
  );
});

test("a permission failure surfaces an exact manual removal command", async () => {
  const stale = staleProbe("/usr/local/bin/coven", "0.0.54");
  const { deps, removed } = makeDeps({
    discoverQueue: [stale, stale],
    existing: new Set([GOOD_PATH, stale.path!]),
    removeError: new Error("EACCES: permission denied"),
  });

  const resolution = await resolveStaleOpenCovenLaunchers("coven-cli", LATEST, deps);

  assert.deepEqual(removed, []);
  assert.match(resolution.log[0]!, /Could not remove stale coven launcher .*EACCES/);
  assert.match(resolution.hint!, /rm '\/usr\/local\/bin\/coven'/);
  assert.equal(resolution.verification?.ok, false);
});

test("stops without removal when PATH already resolves the fresh copy", async () => {
  const failingGood = probe({ executableVerified: false });
  const { deps, removed } = makeDeps({ discoverQueue: [failingGood] });

  const resolution = await resolveStaleOpenCovenLaunchers("coven-cli", LATEST, deps);

  assert.deepEqual(removed, []);
  assert.equal(resolution.hint, null);
  assert.equal(resolution.verification?.ok, false);
});

test("Windows removal covers the launcher's sibling shims", async () => {
  const goodPath = "C:\\npm\\coven.cmd";
  const goodProbe = probe({
    path: goodPath,
    executablePath: "C:\\npm\\node_modules\\@opencoven\\cli\\bin\\coven.js",
    packagePath: "C:\\npm\\node_modules\\@opencoven\\cli",
  });
  const stale = probe({
    path: "C:\\old\\coven.cmd",
    executablePath: "C:\\old\\node_modules\\@opencoven\\cli\\bin\\coven.js",
    packagePath: "C:\\old\\node_modules\\@opencoven\\cli",
    version: "0.0.54",
  });
  const existing = new Set([goodPath, "C:\\old\\coven", "C:\\old\\coven.cmd", "C:\\old\\coven.ps1"]);
  const removed: string[] = [];
  const resolution = await resolveStaleOpenCovenLaunchers("coven-cli", LATEST, {
    platform: "win32",
    refreshEnv: () => ({ NODE_ENV: "test" }),
    npmGlobalPrefix: async () => "C:\\npm",
    discover: (() => {
      const queue = [stale, goodProbe];
      return async () => queue.shift()!;
    })(),
    probeAt: async () => goodProbe,
    fileExists: async (file) => existing.has(file),
    removeFile: async (file) => {
      removed.push(file);
      existing.delete(file);
    },
  });

  assert.deepEqual(removed, ["C:\\old\\coven", "C:\\old\\coven.cmd", "C:\\old\\coven.ps1"]);
  assert.ok(resolution.verification?.ok);
});

test("refuses to remove a same-package SOURCE CHECKOUT on PATH (name match is not provenance)", async () => {
  // A developer working on @opencoven/cli with their git checkout's bin on
  // PATH: the checkout root package.json carries the same name and an older
  // version, but it is NOT an npm-managed install — deleting from it would
  // destroy tracked working-tree files.
  const checkout = probe({
    path: "/home/user/src/cli/bin/coven",
    executablePath: "/home/user/src/cli/bin/coven.js",
    packagePath: "/home/user/src/cli",
    version: "0.0.54",
  });
  const { deps, removed } = makeDeps({
    discoverQueue: [checkout],
    existing: new Set([GOOD_PATH, checkout.path!]),
  });

  const resolution = await resolveStaleOpenCovenLaunchers("coven-cli", LATEST, deps);

  assert.deepEqual(removed, []);
  assert.match(resolution.hint!, /src\/cli\/bin\/coven belongs to @opencoven\/cli, so Cave will not remove it/);
});

test("refuses to remove a same-package copy whose bin entry does not verify", async () => {
  const unverifiable = probe({
    path: "/opt/weird/bin/coven",
    executablePath: "/opt/weird/lib/node_modules/@opencoven/cli/bin/coven.js",
    packagePath: "/opt/weird/lib/node_modules/@opencoven/cli",
    executableVerified: false,
    version: "0.0.54",
  });
  const { deps, removed } = makeDeps({
    discoverQueue: [unverifiable],
    existing: new Set([GOOD_PATH, unverifiable.path!]),
  });

  const resolution = await resolveStaleOpenCovenLaunchers("coven-cli", LATEST, deps);

  assert.deepEqual(removed, []);
  assert.ok(resolution.hint, "unproven provenance yields manual guidance, never deletion");
});

test("isNodeModulesPackagePath demands a node_modules/<package> tail", () => {
  assert.ok(
    isNodeModulesPackagePath(
      "/home/u/.nvm/versions/node/v24.13.0/lib/node_modules/@opencoven/cli",
      "@opencoven/cli",
      "linux",
    ),
  );
  assert.ok(
    isNodeModulesPackagePath(
      "C:\\npm\\node_modules\\@OpenCoven\\cli",
      "@opencoven/cli",
      "win32",
    ),
    "win32 comparison is case-insensitive",
  );
  assert.ok(!isNodeModulesPackagePath("/home/u/src/cli", "@opencoven/cli", "linux"));
  assert.ok(
    !isNodeModulesPackagePath("/home/u/node_modules/cli", "@opencoven/cli", "linux"),
    "scope segment must match too",
  );
  assert.ok(
    !isNodeModulesPackagePath("/home/u/not_node_modules/@opencoven/cli", "@opencoven/cli", "linux"),
  );
});

test("npmGlobalPrefixFromNpmPath routes Windows npm.cmd through node npm-cli.js", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "coven-npm-prefix-"));
  const npmCli = path.join(dir, "node_modules", "npm", "bin", "npm-cli.js");
  const npmCmd = path.join(dir, "npm.cmd");
  await mkdir(path.dirname(npmCli), { recursive: true });
  await writeFile(npmCli, "process.stdout.write('C:\\\\Users\\\\dev\\\\npm-global\\n');\n");
  await writeFile(npmCmd, "@ECHO off\r\nREM npm shim\r\n");

  // The .cmd shim itself is never exec'd (Node >= 21.7 rejects it without a
  // shell); the launch remap runs npm-cli.js with Cave's own Node, so this
  // works — and is asserted — even from a POSIX test host.
  const prefix = await npmGlobalPrefixFromNpmPath(
    npmCmd,
    { ...process.env },
    "win32",
  );
  assert.equal(prefix, "C:\\Users\\dev\\npm-global");
  await rm(dir, { recursive: true, force: true });
});

test("removeLauncherFile deletes files but refuses directories", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "coven-resolve-"));
  const file = path.join(dir, "coven");
  await writeFile(file, "#!/bin/sh\n");

  await removeLauncherFile(file);
  await assert.rejects(() => removeLauncherFile(dir), /is not a launcher file/);
});

test("end-to-end on a real filesystem: stale launcher removed, fresh copy verifies", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX launcher layout (symlink + shebang) does not exist on win32");
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "coven-resolve-e2e-"));
  const makeInstall = async (prefix: string, version: string) => {
    const pkg = path.join(prefix, "lib", "node_modules", "@opencoven", "cli");
    const bin = path.join(prefix, "bin");
    await mkdir(path.join(pkg, "bin"), { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(
      path.join(pkg, "package.json"),
      JSON.stringify({ name: "@opencoven/cli", version, bin: { coven: "bin/coven.js" } }),
    );
    await writeFile(
      path.join(pkg, "bin", "coven.js"),
      `#!/usr/bin/env node\nconsole.log("coven v${version}");\n`,
      { mode: 0o755 },
    );
    await symlink(
      path.relative(bin, path.join(pkg, "bin", "coven.js")),
      path.join(bin, "coven"),
    );
    return { launcher: path.join(bin, "coven") };
  };

  const stale = await makeInstall(path.join(root, "stale"), "0.0.54");
  const good = await makeInstall(path.join(root, "good"), LATEST);
  const covenPath = [
    path.join(root, "stale", "bin"),
    path.join(root, "good", "bin"),
    path.dirname(process.execPath),
    // `which` and realpath live in the system dirs on every CI platform.
    "/usr/bin",
    "/bin",
  ].join(path.delimiter);

  const resolution = await resolveStaleOpenCovenLaunchers("coven-cli", LATEST, {
    refreshEnv: () => ({ ...process.env, PATH: covenPath }),
    npmGlobalPrefix: async () => path.join(root, "good"),
  });

  assert.deepEqual(resolution.removed, [stale.launcher]);
  assert.ok(resolution.verification?.ok, "fresh copy verifies after real removal");
  assert.equal(resolution.verification?.current, LATEST);
  assert.equal(resolution.verification?.path, good.launcher);
  await rm(root, { recursive: true, force: true });
});

console.log("opencoven-tools-resolve.test.ts: ok");
