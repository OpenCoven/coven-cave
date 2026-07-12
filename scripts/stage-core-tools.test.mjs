import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename as renamePath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CORE_TOOLS_LOCK, resolveCoreToolsTarget } from "./core-tools-target.mjs";
import {
  createDefaultCoreToolsDependencies,
  parseStageCoreToolsArgs,
  refreshCoreToolsManifest,
  stageCoreTools,
  validateStagingDestination,
  verifyCoreTools,
  writeJsonAtomically,
} from "./stage-core-tools.mjs";

const fixtureRoots = [];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobSha(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

function streamingBody(bytes) {
  const chunk = Buffer.from(bytes);
  let delivered = false;
  return {
    getReader: () => ({
      read: async () => {
        if (delivered) return { done: true };
        delivered = true;
        return { done: false, value: chunk };
      },
      cancel: async () => {},
      releaseLock: () => {},
    }),
  };
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function createFixture({
  platform = "linux",
  arch = "x64",
  cliBytes = Buffer.from("native-cli-bytes"),
  codeArchiveBytes = Buffer.from("verified-code-archive"),
  codeBytes = Buffer.from("native-code-bytes"),
  cliVersion = CORE_TOOLS_LOCK.coven.version,
  codeVersion = CORE_TOOLS_LOCK.covenCode.version,
  cliPackageName = CORE_TOOLS_LOCK.coven.package,
  codePackageName = CORE_TOOLS_LOCK.covenCode.package,
  nativePackageName,
  nativePackageVersion = CORE_TOOLS_LOCK.coven.version,
  includeCliBinary = true,
  checksum = sha256(codeArchiveBytes),
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cave-core-tools-test-"));
  fixtureRoots.push(root);
  const nodeModules = path.join(root, "node_modules");
  const dest = path.join(root, "resources", "tools");
  const legalRoot = path.join(root, "legal-root");
  const resolved = resolveCoreToolsTarget({ platform, arch });
  const cliLicenseBytes = Buffer.from("fixture CLI MIT license\n");
  const licenseBytes = Buffer.from("fixture GPL license\n");
  const attributionBytes = Buffer.from("fixture attribution\n");
  const noticeBytes = Buffer.from("fixture third-party notice\n");
  const lock = structuredClone(CORE_TOOLS_LOCK);
  lock.coven.licenseBlob = gitBlobSha(cliLicenseBytes);
  lock.covenCode.licenseBlob = gitBlobSha(licenseBytes);
  lock.covenCode.attributionBlob = gitBlobSha(attributionBytes);

  await writeJson(path.join(nodeModules, "@opencoven", "cli", "package.json"), {
    name: cliPackageName,
    version: cliVersion,
  });
  await writeJson(path.join(nodeModules, "@opencoven", "coven-code", "package.json"), {
    name: codePackageName,
    version: codeVersion,
  });
  if (resolved.supported) {
    await writeJson(
      path.join(nodeModules, "@opencoven", "coven-code", "checksums.json"),
      { [resolved.codeArchive]: { sha256: checksum } },
    );
    if (resolved.cli.kind === "package") {
      await writeJson(
        path.join(nodeModules, resolved.cli.packageName, "package.json"),
        {
          name: nativePackageName ?? resolved.cli.packageName,
          version: nativePackageVersion,
        },
      );
      if (includeCliBinary) {
        const cliPath = path.join(nodeModules, resolved.cli.packageName, resolved.cli.binary);
        await mkdir(path.dirname(cliPath), { recursive: true });
        await writeFile(cliPath, cliBytes);
        await chmod(cliPath, 0o644);
      }
    }
  }

  await mkdir(path.join(legalRoot, "licenses"), { recursive: true });
  await writeFile(path.join(legalRoot, "THIRD_PARTY_NOTICES.md"), noticeBytes);
  await writeFile(path.join(legalRoot, "licenses", "coven-cli-MIT.txt"), cliLicenseBytes);
  await writeFile(path.join(legalRoot, "licenses", "coven-code-GPL-3.0.txt"), licenseBytes);
  await writeFile(
    path.join(legalRoot, "licenses", "coven-code-ATTRIBUTION.md"),
    attributionBytes,
  );

  const calls = { downloads: [], extracts: [], probes: [], processes: [] };
  const deps = {
    downloadCodeArchive: async (request) => {
      calls.downloads.push(request);
      return codeArchiveBytes;
    },
    extractCodeBinary: async (request) => {
      calls.extracts.push(request);
      return codeBytes;
    },
    probeVersion: async (request) => {
      calls.probes.push(request);
      return path.basename(request.binaryPath).startsWith("coven-code")
        ? codeVersion
        : cliVersion;
    },
    runProcess: async (request) => {
      calls.processes.push(request);
      return { stdout: "", stderr: "" };
    },
  };

  return {
    root,
    nodeModules,
    dest,
    legalRoot,
    resolved,
    lock,
    cliBytes,
    codeArchiveBytes,
    codeBytes,
    cliLicenseBytes,
    licenseBytes,
    attributionBytes,
    noticeBytes,
    calls,
    deps,
  };
}

async function baselineFixture() {
  const fixture = await createFixture();
  const manifest = await stageCoreTools({
    platform: "linux",
    arch: "x64",
    nodeModules: fixture.nodeModules,
    dest: fixture.dest,
    legalRoot: fixture.legalRoot,
    lock: fixture.lock,
    deps: fixture.deps,
  });

  const covenPath = path.join(fixture.dest, "bin", "coven");
  const codePath = path.join(fixture.dest, "bin", "coven-code");
  assert.deepEqual(await readFile(covenPath), fixture.cliBytes);
  assert.deepEqual(await readFile(codePath), fixture.codeBytes);
  assert.equal((await stat(covenPath)).mode & 0o777, 0o755);
  assert.equal((await stat(codePath)).mode & 0o777, 0o755);

  assert.equal(fixture.calls.downloads.length, 1);
  assert.equal(
    fixture.calls.downloads[0].expectedSha256,
    sha256(fixture.codeArchiveBytes),
  );
  assert.equal(
    fixture.calls.downloads[0].url,
    "https://github.com/OpenCoven/coven-code/releases/download/v0.5.1/coven-code-linux-x86_64.tar.gz",
  );
  assert.equal(fixture.calls.extracts.length, 1);
  assert.deepEqual(fixture.calls.extracts[0].archiveBytes, fixture.codeArchiveBytes);

  assert.equal(fixture.calls.probes.length, 2);
  for (const probe of fixture.calls.probes) {
    assert.deepEqual(probe.args, ["--version"]);
    assert.ok(probe.timeoutMs > 0 && probe.timeoutMs <= 15_000);
  }

  assert.deepEqual(manifest, {
    schemaVersion: 1,
    target: "linux-x86_64",
    tools: {
      coven: {
        version: "0.0.53",
        file: "bin/coven",
        sha256: sha256(fixture.cliBytes),
      },
      covenCode: {
        version: "0.5.1",
        file: "bin/coven-code",
        sha256: sha256(fixture.codeBytes),
      },
    },
  });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(fixture.dest, "tools-manifest.json"), "utf8")),
    manifest,
  );
  assert.deepEqual(
    await readFile(path.join(fixture.dest, "placeholder.txt")),
    await readFile(new URL("../src-tauri/resources/tools/placeholder.txt", import.meta.url)),
    "staging must preserve the exact tracked tools placeholder bytes",
  );
  assert.deepEqual(
    await readFile(path.join(fixture.dest, "licenses", "coven-cli-MIT.txt")),
    fixture.cliLicenseBytes,
  );
  assert.deepEqual(
    await readFile(path.join(fixture.dest, "licenses", "coven-code-GPL-3.0.txt")),
    fixture.licenseBytes,
  );
  assert.deepEqual(
    await readFile(path.join(fixture.dest, "licenses", "coven-code-ATTRIBUTION.md")),
    fixture.attributionBytes,
  );
  assert.deepEqual(
    await readFile(path.join(fixture.dest, "licenses", "THIRD_PARTY_NOTICES.md")),
    fixture.noticeBytes,
  );
}

await baselineFixture();

async function stageFixture(fixture, overrides = {}) {
  return stageCoreTools({
    platform: overrides.platform ?? "linux",
    arch: overrides.arch ?? "x64",
    nodeModules: fixture.nodeModules,
    dest: fixture.dest,
    legalRoot: fixture.legalRoot,
    lock: fixture.lock,
    deps: overrides.deps ?? fixture.deps,
  });
}

async function failClosedFixtureCases() {
  {
    const fixture = await createFixture();
    await writeJson(
      path.join(fixture.nodeModules, "@opencoven", "coven-code", "checksums.json"),
      {},
    );
    await assert.rejects(stageFixture(fixture), /missing checksum for coven-code-linux-x86_64\.tar\.gz/);
    assert.equal(fixture.calls.downloads.length, 0);
  }

  {
    const fixture = await createFixture({ checksum: "0".repeat(64) });
    await assert.rejects(stageFixture(fixture), /archive checksum mismatch/);
    assert.equal(fixture.calls.extracts.length, 0, "bad archives must fail before extraction");
    await assert.rejects(stat(fixture.dest), /ENOENT/);
  }

  {
    const fixture = await createFixture({ checksum: "not-a-sha256" });
    await assert.rejects(stageFixture(fixture), /invalid checksum for coven-code-linux-x86_64\.tar\.gz/);
    assert.equal(fixture.calls.downloads.length, 0, "malformed checksums must fail before acquisition");
  }

  {
    const fixture = await createFixture({ includeCliBinary: false });
    await assert.rejects(stageFixture(fixture), /native CLI package binary.*is missing/);
    assert.equal(fixture.calls.downloads.length, 0);
  }

  {
    const fixture = await createFixture({ cliVersion: "0.0.52" });
    await assert.rejects(stageFixture(fixture), /@opencoven\/cli version mismatch.*0\.0\.53.*0\.0\.52/);
    assert.equal(fixture.calls.downloads.length, 0);
  }

  {
    const fixture = await createFixture({ codeVersion: "0.5.0" });
    await assert.rejects(stageFixture(fixture), /@opencoven\/coven-code version mismatch.*0\.5\.1.*0\.5\.0/);
    assert.equal(fixture.calls.downloads.length, 0);
  }

  for (const [fixtureOptions, expectedMessage] of [
    [
      { cliPackageName: "@attacker/cli" },
      /@opencoven\/cli package name mismatch.*@attacker\/cli/,
    ],
    [
      { codePackageName: "@attacker/coven-code" },
      /@opencoven\/coven-code package name mismatch.*@attacker\/coven-code/,
    ],
    [
      { nativePackageName: "@attacker/native-cli" },
      /@opencoven\/cli-linux-x64 package name mismatch.*@attacker\/native-cli/,
    ],
    [
      { nativePackageVersion: "0.0.52" },
      /@opencoven\/cli-linux-x64 version mismatch.*0\.0\.53.*0\.0\.52/,
    ],
  ]) {
    const fixture = await createFixture(fixtureOptions);
    await assert.rejects(stageFixture(fixture), expectedMessage);
    assert.equal(fixture.calls.downloads.length, 0);
  }

  for (const relativeAsset of [
    "THIRD_PARTY_NOTICES.md",
    path.join("licenses", "coven-cli-MIT.txt"),
    path.join("licenses", "coven-code-GPL-3.0.txt"),
    path.join("licenses", "coven-code-ATTRIBUTION.md"),
  ]) {
    const fixture = await createFixture();
    await rm(path.join(fixture.legalRoot, relativeAsset));
    await assert.rejects(stageFixture(fixture), /asset is missing/);
    assert.equal(fixture.calls.downloads.length, 0);
  }

  for (const [relativeAsset, expectedMessage] of [
    [path.join("licenses", "coven-cli-MIT.txt"), /Coven CLI license Git blob mismatch/],
    [path.join("licenses", "coven-code-GPL-3.0.txt"), /license Git blob mismatch/],
    [path.join("licenses", "coven-code-ATTRIBUTION.md"), /attribution Git blob mismatch/],
  ]) {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.legalRoot, relativeAsset), "mutated legal bytes\n");
    await assert.rejects(stageFixture(fixture), expectedMessage);
    assert.equal(fixture.calls.downloads.length, 0);
  }

  {
    const fixture = await createFixture();
    fixture.deps.probeVersion = async (request) => {
      fixture.calls.probes.push(request);
      return request.tool === "coven" ? "coven 9.9.9" : "coven-code v0.5.1";
    };
    await assert.rejects(stageFixture(fixture), /Coven CLI version mismatch.*0\.0\.53.*9\.9\.9/);
    assert.equal(fixture.calls.probes.length, 1);
    await assert.rejects(stat(path.join(fixture.dest, "tools-manifest.json")), /ENOENT/);
  }

  {
    const fixture = await createFixture({ platform: "linux", arch: "arm64" });
    await assert.rejects(
      stageFixture(fixture, { platform: "linux", arch: "arm64" }),
      /unsupported core tools target: linux\/arm64/,
    );
    assert.equal(fixture.calls.downloads.length, 0);
  }
}

async function intelProvenanceCases() {
  {
    const fixture = await createFixture({ platform: "darwin", arch: "x64" });
    fixture.deps.runProcess = async (request) => {
      fixture.calls.processes.push(request);
      if (request.args[0] === "rev-parse") return { stdout: "wrong-tag-object\n", stderr: "" };
      return { stdout: "", stderr: "" };
    };
    await assert.rejects(
      stageFixture(fixture, { platform: "darwin", arch: "x64" }),
      /Intel CLI tag object mismatch/,
    );
    assert.equal(fixture.calls.processes[0].command, "git");
    assert.deepEqual(fixture.calls.processes[0].args.slice(0, 6), [
      "clone",
      "--branch",
      "v0.0.53",
      "--depth",
      "1",
      "https://github.com/OpenCoven/coven.git",
    ]);
    assert.equal(fixture.calls.processes[0].args.length, 7);
    assert.ok(fixture.calls.processes[0].args[6].endsWith(path.join("source")));
    assert.deepEqual(fixture.calls.processes[1].args, [
      "rev-parse",
      "refs/tags/v0.0.53",
    ]);
    assert.equal(
      fixture.calls.processes.some((request) => request.command === "cargo"),
      false,
      "Cargo must not run after a tag-object mismatch",
    );
  }

  {
    const fixture = await createFixture({ platform: "darwin", arch: "x64" });
    fixture.deps.runProcess = async (request) => {
      fixture.calls.processes.push(request);
      if (request.args[0] === "rev-parse" && request.args[1].startsWith("refs/tags/")) {
        return { stdout: `${fixture.resolved.cli.tagObject}\n`, stderr: "" };
      }
      if (request.args[0] === "rev-parse" && request.args[1] === "HEAD") {
        return { stdout: "wrong-commit\n", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };
    await assert.rejects(
      stageFixture(fixture, { platform: "darwin", arch: "x64" }),
      /Intel CLI commit mismatch/,
    );
    assert.equal(
      fixture.calls.processes.some((request) => request.command === "cargo"),
      false,
      "Cargo must not run after a commit mismatch",
    );
  }

  {
    const sourceBytes = Buffer.from("source-built-native-cli");
    const fixture = await createFixture({ platform: "darwin", arch: "x64" });
    fixture.deps.runProcess = async (request) => {
      fixture.calls.processes.push(request);
      if (request.args[0] === "rev-parse" && request.args[1].startsWith("refs/tags/")) {
        return { stdout: `${fixture.resolved.cli.tagObject}\n`, stderr: "" };
      }
      if (request.args[0] === "rev-parse" && request.args[1] === "HEAD") {
        return { stdout: `${fixture.resolved.cli.commit}\n`, stderr: "" };
      }
      if (request.command === "cargo") {
        const built = path.join(request.cwd, ...fixture.resolved.cli.binary.split("/"));
        await mkdir(path.dirname(built), { recursive: true });
        await writeFile(built, sourceBytes);
      }
      return { stdout: "", stderr: "" };
    };
    const manifest = await stageFixture(fixture, { platform: "darwin", arch: "x64" });
    assert.deepEqual(await readFile(path.join(fixture.dest, "bin", "coven")), sourceBytes);
    assert.equal(manifest.tools.coven.sha256, sha256(sourceBytes));
    const cargo = fixture.calls.processes.find((request) => request.command === "cargo");
    assert.deepEqual(cargo.args, ["build", "--release", "--locked", "-p", "coven-cli"]);
    assert.equal((await stat(path.join(fixture.dest, "bin", "coven"))).mode & 0o777, 0o755);
  }
}

async function readManifest(dest) {
  return JSON.parse(await readFile(path.join(dest, "tools-manifest.json"), "utf8"));
}

async function writeManifest(dest, manifest) {
  await writeJson(path.join(dest, "tools-manifest.json"), manifest);
}

async function maintenanceCases() {
  {
    const fixture = await createFixture();
    await stageFixture(fixture);
    await writeFile(path.join(fixture.dest, "bin", "coven-code"), "post-signing mutation");
    fixture.calls.probes.length = 0;
    await assert.rejects(
      verifyCoreTools({
        toolsDir: fixture.dest,
        platform: "linux",
        arch: "x64",
        lock: fixture.lock,
        deps: fixture.deps,
      }),
      /covenCode SHA-256 mismatch/,
    );
    assert.equal(fixture.calls.probes.length, 0, "stale hashes must reject before probes");
  }

  for (const mutate of [
    (manifest) => {
      manifest.schemaVersion = 2;
    },
    (manifest) => {
      manifest.target = "windows-x86_64";
    },
    (manifest) => {
      manifest.tools.coven.version = "0.0.52";
    },
    (manifest) => {
      manifest.tools.coven.file = "../outside-coven";
    },
    (manifest) => {
      manifest.tools.covenCode.file = "/absolute/coven-code";
    },
  ]) {
    const fixture = await createFixture();
    await stageFixture(fixture);
    const manifest = await readManifest(fixture.dest);
    mutate(manifest);
    await writeManifest(fixture.dest, manifest);
    await assert.rejects(
      refreshCoreToolsManifest({
        toolsDir: fixture.dest,
        platform: "linux",
        arch: "x64",
        lock: fixture.lock,
      }),
      /manifest (?:schema|target|version|file).*mismatch|unsafe manifest file/,
    );
  }

  {
    const fixture = await createFixture();
    const before = await stageFixture(fixture);
    const signedCovenBytes = Buffer.from("signed native cli bytes");
    const signedCodeBytes = Buffer.from("signed native code bytes");
    await writeFile(path.join(fixture.dest, "bin", "coven"), signedCovenBytes);
    await writeFile(path.join(fixture.dest, "bin", "coven-code"), signedCodeBytes);

    fixture.calls.downloads.length = 0;
    fixture.calls.extracts.length = 0;
    fixture.calls.probes.length = 0;
    const refreshed = await refreshCoreToolsManifest({
      toolsDir: fixture.dest,
      platform: "linux",
      arch: "x64",
      lock: fixture.lock,
    });
    assert.equal(fixture.calls.downloads.length, 0);
    assert.equal(fixture.calls.extracts.length, 0);
    assert.equal(fixture.calls.probes.length, 0);
    assert.equal(refreshed.schemaVersion, before.schemaVersion);
    assert.equal(refreshed.target, before.target);
    assert.equal(refreshed.tools.coven.version, before.tools.coven.version);
    assert.equal(refreshed.tools.covenCode.version, before.tools.covenCode.version);
    assert.equal(refreshed.tools.coven.file, before.tools.coven.file);
    assert.equal(refreshed.tools.covenCode.file, before.tools.covenCode.file);
    assert.equal(refreshed.tools.coven.sha256, sha256(signedCovenBytes));
    assert.equal(refreshed.tools.covenCode.sha256, sha256(signedCodeBytes));
    assert.deepEqual(await readManifest(fixture.dest), refreshed);

    fixture.deps.probeVersion = async (request) => {
      fixture.calls.probes.push(request);
      return request.tool === "coven"
        ? "coven version 0.0.53 (fixture)"
        : "coven-code v0.5.1";
    };
    assert.deepEqual(
      await verifyCoreTools({
        toolsDir: fixture.dest,
        platform: "linux",
        arch: "x64",
        lock: fixture.lock,
        deps: fixture.deps,
      }),
      refreshed,
    );
    assert.equal(fixture.calls.probes.length, 2);
    assert.ok(fixture.calls.probes.every((request) => request.timeoutMs <= 15_000));
  }

  {
    const fixture = await createFixture();
    await stageFixture(fixture);
    fixture.calls.probes.length = 0;
    fixture.deps.probeVersion = async (request) => {
      fixture.calls.probes.push(request);
      return request.tool === "coven" ? "coven 0.0.53" : "coven-code 0.5.0";
    };
    await assert.rejects(
      verifyCoreTools({
        toolsDir: fixture.dest,
        platform: "linux",
        arch: "x64",
        lock: fixture.lock,
        deps: fixture.deps,
      }),
      /Coven Code version mismatch.*0\.5\.1.*0\.5\.0/,
    );
    assert.equal(fixture.calls.probes.length, 2);
  }

  {
    const fixture = await createFixture();
    await stageFixture(fixture);
    await writeFile(path.join(fixture.dest, "bin", "stale-target-binary"), "stale");
    const replacementCli = Buffer.from("replacement-cli-bytes");
    const replacementCode = Buffer.from("replacement-code-bytes");
    const cliSource = path.join(
      fixture.nodeModules,
      fixture.resolved.cli.packageName,
      ...fixture.resolved.cli.binary.split("/"),
    );
    await writeFile(cliSource, replacementCli);
    fixture.deps.extractCodeBinary = async (request) => {
      fixture.calls.extracts.push(request);
      return replacementCode;
    };
    await stageFixture(fixture);
    await assert.rejects(stat(path.join(fixture.dest, "bin", "stale-target-binary")), /ENOENT/);
    assert.deepEqual(await readFile(path.join(fixture.dest, "bin", "coven")), replacementCli);
    assert.deepEqual(await readFile(path.join(fixture.dest, "bin", "coven-code")), replacementCode);
    assert.equal(
      (await readdir(path.dirname(fixture.dest))).some((entry) =>
        entry.startsWith(`${path.basename(fixture.dest)}.backup-`)),
      false,
      "successful publication must remove its last-good backup",
    );
  }
}

async function atomicJsonCases() {
  {
    const root = await mkdtemp(path.join(os.tmpdir(), "cave-atomic-json-collision-"));
    fixtureRoots.push(root);
    const output = path.join(root, "manifest.json");
    let writeAttempts = 0;
    await writeJsonAtomically(
      output,
      { schemaVersion: 1 },
      {
        fsOps: {
          writeFile: async (file, bytes, options) => {
            writeAttempts += 1;
            assert.equal(options.flag, "wx");
            if (writeAttempts < 3) {
              throw Object.assign(new Error("simulated temporary collision"), {
                code: "EEXIST",
              });
            }
            return writeFile(file, bytes, options);
          },
          rename: renamePath,
          rm,
        },
      },
    );
    assert.equal(writeAttempts, 3);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), { schemaVersion: 1 });
    assert.deepEqual(await readdir(root), ["manifest.json"]);
  }

  {
    const root = await mkdtemp(path.join(os.tmpdir(), "cave-atomic-json-fault-"));
    fixtureRoots.push(root);
    const output = path.join(root, "manifest.json");
    const renameError = new Error("simulated atomic rename failure");
    await assert.rejects(
      writeJsonAtomically(
        output,
        { schemaVersion: 1 },
        {
          fsOps: {
            writeFile,
            rename: async () => {
              throw renameError;
            },
            rm,
          },
        },
      ),
      (error) => error === renameError,
    );
    assert.deepEqual(
      await readdir(root),
      [],
      "an atomic rename fault must not leave temporary JSON files behind",
    );
  }
}

async function exactVersionTokenCases() {
  {
    const fixture = await createFixture();
    fixture.deps.probeVersion = async (request) => {
      fixture.calls.probes.push(request);
      return request.tool === "coven" ? "coven 0.0.53.999" : "coven-code 0.5.1";
    };
    await assert.rejects(
      stageFixture(fixture),
      /Coven CLI version mismatch.*0\.0\.53/,
      "staging must reject a locked version embedded in an extended dotted token",
    );
  }

  {
    const fixture = await createFixture();
    await stageFixture(fixture);
    fixture.deps.probeVersion = async (request) => {
      fixture.calls.probes.push(request);
      return request.tool === "coven" ? "coven 0.0.53.999" : "coven-code 0.5.1";
    };
    await assert.rejects(
      verifyCoreTools({
        toolsDir: fixture.dest,
        platform: "linux",
        arch: "x64",
        lock: fixture.lock,
        deps: fixture.deps,
      }),
      /Coven CLI version mismatch.*0\.0\.53/,
      "verification must reject a locked version embedded in an extended dotted token",
    );
  }

  {
    const fixture = await createFixture();
    await stageFixture(fixture);
    fixture.deps.probeVersion = async (request) => {
      fixture.calls.probes.push(request);
      return request.tool === "coven"
        ? "coven 0.0.53 conflicting-runtime 9.9.9"
        : "coven-code 0.5.1";
    };
    await assert.rejects(
      verifyCoreTools({
        toolsDir: fixture.dest,
        platform: "linux",
        arch: "x64",
        lock: fixture.lock,
        deps: fixture.deps,
      }),
      /expected exactly 0\.0\.53.*0\.0\.53, 9\.9\.9/,
      "verification must reject conflicting standalone semantic-version tokens",
    );
  }

  for (const output of [
    "coven 0.0.53-beta",
    "coven 0.0.53+fixture-build",
    "coven 0.0.53adjacent",
  ]) {
    const fixture = await createFixture();
    await stageFixture(fixture);
    fixture.deps.probeVersion = async (request) =>
      request.tool === "coven" ? output : "coven-code 0.5.1";
    await assert.rejects(
      verifyCoreTools({
        toolsDir: fixture.dest,
        platform: "linux",
        arch: "x64",
        lock: fixture.lock,
        deps: fixture.deps,
      }),
      /Coven CLI version mismatch.*0\.0\.53/,
      `verification must reject non-exact version output: ${output}`,
    );
  }

  {
    const output = "coven 0.0.53_rc1";
    const outcomes = [];

    const stagingFixture = await createFixture();
    stagingFixture.deps.probeVersion = async (request) =>
      request.tool === "coven" ? output : "coven-code 0.5.1";
    try {
      await stageFixture(stagingFixture);
      outcomes.push({ mode: "stage", rejected: false, error: null });
    } catch (error) {
      outcomes.push({ mode: "stage", rejected: true, error });
    }

    const verificationFixture = await createFixture();
    await stageFixture(verificationFixture);
    verificationFixture.deps.probeVersion = async (request) =>
      request.tool === "coven" ? output : "coven-code 0.5.1";
    try {
      await verifyCoreTools({
        toolsDir: verificationFixture.dest,
        platform: "linux",
        arch: "x64",
        lock: verificationFixture.lock,
        deps: verificationFixture.deps,
      });
      outcomes.push({ mode: "verify", rejected: false, error: null });
    } catch (error) {
      outcomes.push({ mode: "verify", rejected: true, error });
    }

    assert.deepEqual(
      outcomes.map(({ mode, rejected }) => ({ mode, rejected })),
      [
        { mode: "stage", rejected: true },
        { mode: "verify", rejected: true },
      ],
      "stage and verify must both reject an underscore-adjacent version token",
    );
    for (const outcome of outcomes) {
      assert.match(outcome.error.message, /Coven CLI version mismatch.*unrecognized output/);
    }
  }
}

async function replaceBinWithExternalDirectoryLink(fixture) {
  await stageFixture(fixture);
  const externalBin = path.join(fixture.root, "external-tools-bin");
  await mkdir(externalBin, { recursive: true });
  for (const name of ["coven", "coven-code"]) {
    await writeFile(
      path.join(externalBin, name),
      await readFile(path.join(fixture.dest, "bin", name)),
    );
  }
  await rm(path.join(fixture.dest, "bin"), { recursive: true, force: true });
  try {
    await symlink(
      externalBin,
      path.join(fixture.dest, "bin"),
      process.platform === "win32" ? "junction" : "dir",
    );
    return true;
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
      console.log(`stage-core-tools.test.mjs: linked-bin containment skipped (${error.code})`);
      return false;
    }
    throw error;
  }
}

async function maintenanceContainmentCases() {
  {
    const fixture = await createFixture();
    if (await replaceBinWithExternalDirectoryLink(fixture)) {
      await assert.rejects(
        refreshCoreToolsManifest({
          toolsDir: fixture.dest,
          platform: "linux",
          arch: "x64",
          lock: fixture.lock,
        }),
        /maintenance path.*(?:symlink|escapes)/,
        "refresh must reject a linked bin directory that escapes toolsDir",
      );
    }
  }

  {
    const fixture = await createFixture();
    if (await replaceBinWithExternalDirectoryLink(fixture)) {
      fixture.calls.probes.length = 0;
      await assert.rejects(
        verifyCoreTools({
          toolsDir: fixture.dest,
          platform: "linux",
          arch: "x64",
          lock: fixture.lock,
          deps: fixture.deps,
        }),
        /maintenance path.*(?:symlink|escapes)/,
        "verify must reject a linked bin directory that escapes toolsDir",
      );
      assert.equal(fixture.calls.probes.length, 0, "escaped binaries must never be probed");
    }
  }
}

async function publicationRollbackCase() {
  {
    const fixture = await createFixture();
    const oldManifestBytes = Buffer.from("last-good-manifest\n");
    const sentinelBytes = Buffer.from("last-good-sentinel\n");
    await mkdir(fixture.dest, { recursive: true });
    await writeFile(path.join(fixture.dest, "tools-manifest.json"), oldManifestBytes);
    await writeFile(path.join(fixture.dest, "last-good-sentinel.txt"), sentinelBytes);

    const publicationError = new Error("forced publication rename failure");
    const renameCalls = [];
    const publicationFs = {
      lstat,
      rm,
      rename: async (source, destination) => {
        renameCalls.push({ source, destination });
        if (
          destination === fixture.dest &&
          path.basename(source).startsWith(`${path.basename(fixture.dest)}.stage-`)
        ) {
          throw publicationError;
        }
        return renamePath(source, destination);
      },
    };

    let caught;
    try {
      await stageCoreTools({
        platform: "linux",
        arch: "x64",
        nodeModules: fixture.nodeModules,
        dest: fixture.dest,
        legalRoot: fixture.legalRoot,
        lock: fixture.lock,
        deps: fixture.deps,
        publicationFs,
      });
    } catch (error) {
      caught = error;
    }

    assert.deepEqual(
      await readFile(path.join(fixture.dest, "last-good-sentinel.txt")),
      sentinelBytes,
      "publication failure must preserve the last-good destination sentinel",
    );
    assert.deepEqual(
      await readFile(path.join(fixture.dest, "tools-manifest.json")),
      oldManifestBytes,
      "publication failure must preserve the last-good manifest bytes",
    );
    assert.equal(caught, publicationError, "the original publication error must be surfaced");
    await assert.rejects(stat(path.join(fixture.dest, "bin")), /ENOENT/);
    assert.equal(renameCalls.length >= 3, true, "publication must back up, attempt, and restore");
  }

  {
    const fixture = await createFixture();
    const sentinelBytes = Buffer.from("preserved-in-backup\n");
    await mkdir(fixture.dest, { recursive: true });
    await writeFile(path.join(fixture.dest, "last-good-sentinel.txt"), sentinelBytes);
    const publicationError = new Error("forced publication rename failure");
    const rollbackError = new Error("forced rollback rename failure");
    let backupPath;
    let stagingPath;
    const publicationFs = {
      lstat,
      rm,
      rename: async (source, destination) => {
        if (source === fixture.dest) {
          backupPath = destination;
          return renamePath(source, destination);
        }
        if (path.basename(source).startsWith(`${path.basename(fixture.dest)}.stage-`)) {
          stagingPath = source;
          throw publicationError;
        }
        if (source === backupPath && destination === fixture.dest) throw rollbackError;
        return renamePath(source, destination);
      },
    };
    let caught;
    try {
      await stageCoreTools({
        platform: "linux",
        arch: "x64",
        nodeModules: fixture.nodeModules,
        dest: fixture.dest,
        legalRoot: fixture.legalRoot,
        lock: fixture.lock,
        deps: fixture.deps,
        publicationFs,
      });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught instanceof AggregateError);
    assert.deepEqual(caught.errors, [publicationError, rollbackError]);
    assert.match(caught.message, new RegExp(backupPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.deepEqual(
      await readFile(path.join(backupPath, "last-good-sentinel.txt")),
      sentinelBytes,
    );
    await assert.rejects(stat(fixture.dest), /ENOENT/);
    await assert.rejects(stat(stagingPath), /ENOENT/);
  }
}

async function apiDestinationSafetyCases() {
  {
    const fixture = await createFixture();
    await rm(path.join(fixture.nodeModules, "@opencoven", "cli", "package.json"));
    const unsafeDest = path.join(fixture.nodeModules, "nested-tools-output");
    await assert.rejects(
      stageCoreTools({
        platform: "linux",
        arch: "x64",
        nodeModules: fixture.nodeModules,
        dest: unsafeDest,
        legalRoot: fixture.legalRoot,
        lock: fixture.lock,
        deps: fixture.deps,
      }),
      /unsafe staging destination.*node_modules/i,
      "destination safety must run before package metadata reads",
    );
    assert.deepEqual(fixture.calls.downloads, []);
    assert.deepEqual(fixture.calls.extracts, []);
    assert.deepEqual(fixture.calls.probes, []);
  }

  {
    const fixture = await createFixture();
    const unsafeDest = path.join(fixture.legalRoot, "nested-tools-output");
    await assert.rejects(
      stageCoreTools({
        platform: "linux",
        arch: "x64",
        nodeModules: fixture.nodeModules,
        dest: unsafeDest,
        legalRoot: fixture.legalRoot,
        lock: fixture.lock,
        deps: fixture.deps,
      }),
      /unsafe staging destination.*legal/i,
    );
    assert.deepEqual(fixture.calls.downloads, []);
    assert.deepEqual(fixture.calls.extracts, []);
    assert.deepEqual(fixture.calls.probes, []);
  }
}

async function destinationSafetyMatrixCases() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cave-destination-matrix-"));
  fixtureRoots.push(root);
  const repositoryRoot = path.join(root, "repository");
  const canonicalToolsDir = path.join(
    repositoryRoot,
    "src-tauri",
    "resources",
    "tools",
  );
  const currentWorkingDirectory = path.join(root, "work", "current");
  const nodeModules = path.join(root, "inputs", "node_modules");
  const legalRoot = path.join(root, "legal-inputs", "legal");
  await Promise.all([
    mkdir(canonicalToolsDir, { recursive: true }),
    mkdir(currentWorkingDirectory, { recursive: true }),
    mkdir(nodeModules, { recursive: true }),
    mkdir(legalRoot, { recursive: true }),
  ]);

  const validationContext = {
    nodeModules,
    legalRoot,
    repositoryRoot,
    currentWorkingDirectory,
    canonicalToolsDir,
  };
  const validDestination = path.join(root, "safe-output", "tools");
  assert.deepEqual(
    await validateStagingDestination({
      ...validationContext,
      dest: validDestination,
    }),
    {
      dest: validDestination,
      nodeModules,
      legalRoot,
    },
  );

  assert.deepEqual(
    await validateStagingDestination({
      dest: canonicalToolsDir,
      nodeModules: path.join(repositoryRoot, "node_modules"),
      legalRoot: repositoryRoot,
      repositoryRoot,
      currentWorkingDirectory: repositoryRoot,
      canonicalToolsDir,
    }),
    {
      dest: canonicalToolsDir,
      nodeModules: path.join(repositoryRoot, "node_modules"),
      legalRoot: repositoryRoot,
    },
    "the canonical tools directory is the one allowed in-repository destination",
  );

  for (const [dest, expected] of [
    [path.parse(root).root, /filesystem root/],
    [repositoryRoot, /repository root or ancestor/],
    [path.dirname(repositoryRoot), /repository root or ancestor/],
    [path.join(repositoryRoot, "src-tauri", "resources", "other"), /only .*tools.*inside/],
    [currentWorkingDirectory, /current working directory or ancestor/],
    [path.dirname(currentWorkingDirectory), /current working directory or ancestor/],
    [path.join(nodeModules, "nested"), /overlaps node_modules/],
    [path.dirname(nodeModules), /overlaps node_modules/],
    [path.join(legalRoot, "nested"), /overlaps legal input/],
    [path.dirname(legalRoot), /overlaps legal input/],
  ]) {
    await assert.rejects(
      validateStagingDestination({ ...validationContext, dest }),
      expected,
    );
  }

  const nodeModulesLink = path.join(root, "node-modules-link");
  await symlink(nodeModules, nodeModulesLink, "dir");
  await assert.rejects(
    validateStagingDestination({
      ...validationContext,
      dest: path.join(nodeModulesLink, "nested"),
    }),
    /overlaps node_modules/,
    "a non-existent destination below a symlink must resolve through its real parent",
  );

  const brokenParent = path.join(root, "broken-destination-parent");
  await symlink(path.join(root, "does-not-exist"), brokenParent, "dir");
  await assert.rejects(
    validateStagingDestination({
      ...validationContext,
      dest: path.join(brokenParent, "nested"),
    }),
    /unable to resolve staging destination/,
    "an existing but unresolvable destination parent must fail closed",
  );

  const linkedDestinationTarget = path.join(root, "linked-destination-target");
  const linkedDestination = path.join(root, "linked-destination");
  await mkdir(linkedDestinationTarget);
  await symlink(
    linkedDestinationTarget,
    linkedDestination,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    validateStagingDestination({
      ...validationContext,
      dest: linkedDestination,
    }),
    /unsafe staging destination.*symlink or junction/i,
    "an existing generic destination must not itself be a symlink or junction",
  );
}

async function canonicalToolsFinalSymlinkCase() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cave-canonical-tools-link-"));
  fixtureRoots.push(root);
  const repositoryRoot = path.join(root, "repository");
  const resourcesDir = path.join(repositoryRoot, "src-tauri", "resources");
  const canonicalToolsDir = path.join(resourcesDir, "tools");
  const externalToolsDir = path.join(root, "external-tools");
  const nodeModules = path.join(repositoryRoot, "node_modules");
  const sentinel = path.join(externalToolsDir, "must-survive.txt");
  await Promise.all([
    mkdir(resourcesDir, { recursive: true }),
    mkdir(externalToolsDir, { recursive: true }),
    mkdir(nodeModules, { recursive: true }),
  ]);
  await writeFile(sentinel, "external destination must remain untouched\n");
  await symlink(
    externalToolsDir,
    canonicalToolsDir,
    process.platform === "win32" ? "junction" : "dir",
  );

  await assert.rejects(
    validateStagingDestination({
      dest: canonicalToolsDir,
      nodeModules,
      legalRoot: repositoryRoot,
      repositoryRoot,
      currentWorkingDirectory: repositoryRoot,
      canonicalToolsDir,
    }),
    /canonical tools.*symlink or junction/i,
  );
  assert.equal(
    await readFile(sentinel, "utf8"),
    "external destination must remain untouched\n",
  );

  const substitutedCanonicalToolsDir = path.join(repositoryRoot, "alternate-tools");
  await mkdir(substitutedCanonicalToolsDir);
  await assert.rejects(
    validateStagingDestination({
      dest: substitutedCanonicalToolsDir,
      nodeModules,
      legalRoot: repositoryRoot,
      repositoryRoot,
      currentWorkingDirectory: repositoryRoot,
      canonicalToolsDir: substitutedCanonicalToolsDir,
    }),
    /canonical tools directory must be exactly/i,
    "callers must not substitute a different in-repository canonical exception",
  );
}

async function canonicalToolsAncestorSymlinkCases() {
  {
    const root = await mkdtemp(path.join(os.tmpdir(), "cave-tools-ancestor-escape-"));
    fixtureRoots.push(root);
    const repositoryRoot = path.join(root, "repository");
    const srcTauriDir = path.join(repositoryRoot, "src-tauri");
    const externalResources = path.join(root, "external-resources");
    const canonicalToolsDir = path.join(srcTauriDir, "resources", "tools");
    const nodeModules = path.join(repositoryRoot, "node_modules");
    await Promise.all([
      mkdir(srcTauriDir, { recursive: true }),
      mkdir(path.join(externalResources, "tools"), { recursive: true }),
      mkdir(nodeModules, { recursive: true }),
    ]);
    await symlink(
      externalResources,
      path.join(srcTauriDir, "resources"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await assert.rejects(
      validateStagingDestination({
        dest: canonicalToolsDir,
        nodeModules,
        legalRoot: repositoryRoot,
        repositoryRoot,
        currentWorkingDirectory: repositoryRoot,
        canonicalToolsDir,
      }),
      /canonical tools directory must resolve inside the repository/i,
    );
  }

  {
    const root = await mkdtemp(path.join(os.tmpdir(), "cave-tools-ancestor-inside-"));
    fixtureRoots.push(root);
    const repositoryRoot = path.join(root, "repository");
    const srcTauriDir = path.join(repositoryRoot, "src-tauri");
    const internalResources = path.join(repositoryRoot, "generated", "resources");
    const canonicalToolsDir = path.join(srcTauriDir, "resources", "tools");
    const resolvedToolsDir = path.join(internalResources, "tools");
    const nodeModules = path.join(repositoryRoot, "node_modules");
    await Promise.all([
      mkdir(srcTauriDir, { recursive: true }),
      mkdir(resolvedToolsDir, { recursive: true }),
      mkdir(nodeModules, { recursive: true }),
    ]);
    await symlink(
      internalResources,
      path.join(srcTauriDir, "resources"),
      process.platform === "win32" ? "junction" : "dir",
    );

    assert.deepEqual(
      await validateStagingDestination({
        dest: canonicalToolsDir,
        nodeModules,
        legalRoot: repositoryRoot,
        repositoryRoot,
        currentWorkingDirectory: repositoryRoot,
        canonicalToolsDir,
      }),
      {
        dest: resolvedToolsDir,
        nodeModules,
        legalRoot: repositoryRoot,
      },
      "a symlinked ancestor may remain when its resolved target stays in-repository",
    );
  }
}

async function defaultDependencyCases() {
  {
    let cancelled = 0;
    let bodyRead = false;
    const dependencies = createDefaultCoreToolsDependencies({
      platform: "linux",
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        url,
        headers: {
          get: (name) => name.toLowerCase() === "content-length"
            ? String((128 * 1024 * 1024) + 1)
            : null,
        },
        body: { cancel: async () => { cancelled += 1; } },
        arrayBuffer: async () => {
          bodyRead = true;
          throw new Error("oversized response body must not be read");
        },
      }),
      runProcess: async () => ({ stdout: "", stderr: "" }),
    });
    await assert.rejects(
      dependencies.downloadCodeArchive({
        url: "https://github.com/OpenCoven/coven-code/oversized.tar.gz",
        expectedSha256: "0".repeat(64),
        timeoutMs: 1_000,
      }),
      /archive size exceeds 128 MiB limit/,
    );
    assert.equal(bodyRead, false, "Content-Length must reject before reading the body");
    assert.equal(cancelled, 1);
  }

  {
    const chunks = [Buffer.from("12345"), Buffer.from("6789")];
    let readIndex = 0;
    let cancelled = 0;
    const dependencies = createDefaultCoreToolsDependencies({
      platform: "linux",
      maxArchiveBytes: 8,
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        url,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => readIndex < chunks.length
              ? { done: false, value: chunks[readIndex++] }
              : { done: true },
            cancel: async () => { cancelled += 1; },
            releaseLock: () => {},
          }),
        },
        arrayBuffer: async () => {
          throw new Error("streaming response must not use arrayBuffer");
        },
      }),
      runProcess: async () => ({ stdout: "", stderr: "" }),
    });
    await assert.rejects(
      dependencies.downloadCodeArchive({
        url: "https://github.com/OpenCoven/coven-code/streamed.tar.gz",
        expectedSha256: "0".repeat(64),
        timeoutMs: 1_000,
      }),
      /archive size exceeds 8 byte limit/,
    );
    assert.equal(readIndex, 2, "stream size must be checked incrementally");
    assert.equal(cancelled, 1, "oversized streams must be cancelled");
  }

  {
    const bytes = Buffer.from("non-streaming-body");
    const dependencies = createDefaultCoreToolsDependencies({
      platform: "linux",
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        url,
        headers: { get: () => null },
        arrayBuffer: async () => bytes,
      }),
      runProcess: async () => ({ stdout: "", stderr: "" }),
    });
    await assert.rejects(
      dependencies.downloadCodeArchive({
        url: "https://github.com/OpenCoven/coven-code/non-streaming.tar.gz",
        expectedSha256: sha256(bytes),
        timeoutMs: 1_000,
      }),
      /streaming response body is unavailable/,
    );
  }

  {
    const fetchCalls = [];
    const dependencies = createDefaultCoreToolsDependencies({
      platform: "linux",
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url, options });
        if (fetchCalls.length > 1) {
          return {
            ok: false,
            status: 302,
            url,
            headers: { get: () => "https://github.com/final.tar.gz" },
            body: { cancel: async () => {} },
          };
        }
        return {
          ok: false,
          status: 302,
          url,
          headers: { get: () => "http://downgraded.example/then-https" },
          body: { cancel: async () => {} },
        };
      },
      runProcess: async () => ({ stdout: "", stderr: "" }),
    });
    let error;
    try {
      await dependencies.downloadCodeArchive({
        url: "https://github.com/OpenCoven/coven-code/archive.tar.gz",
        archiveName: "archive.tar.gz",
        expectedSha256: "0".repeat(64),
        timeoutMs: 1_000,
      });
    } catch (caught) {
      error = caught;
    }
    assert.equal(fetchCalls.length, 1, "the HTTP redirect hop must never be fetched");
    assert.match(error?.message ?? "", /non-HTTPS redirect hop/);
  }

  {
    const fetchCalls = [];
    const dependencies = createDefaultCoreToolsDependencies({
      platform: "linux",
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url, options });
        return {
          ok: true,
          status: 200,
          url,
          body: streamingBody(Uint8Array.from([1, 2, 3])),
        };
      },
      runProcess: async () => ({ stdout: "", stderr: "" }),
    });
    await assert.rejects(
      dependencies.downloadCodeArchive({
        url: "http://github.com/OpenCoven/coven-code/archive.tar.gz",
        archiveName: "archive.tar.gz",
        expectedSha256: "0".repeat(64),
        timeoutMs: 1_000,
      }),
      /HTTPS/,
    );
    assert.equal(fetchCalls.length, 0);

    assert.deepEqual(
      await dependencies.downloadCodeArchive({
        url: "https://github.com/OpenCoven/coven-code/archive.tar.gz",
        archiveName: "archive.tar.gz",
        expectedSha256: sha256(Buffer.from([1, 2, 3])),
        timeoutMs: 1_000,
      }),
      Buffer.from([1, 2, 3]),
    );
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].options.redirect, "manual");
    assert.ok(fetchCalls[0].options.signal instanceof AbortSignal);
    await assert.rejects(
      dependencies.downloadCodeArchive({
        url: "https://github.com/OpenCoven/coven-code/archive.tar.gz",
        archiveName: "archive.tar.gz",
        expectedSha256: "0".repeat(64),
        timeoutMs: 1_000,
      }),
      /archive checksum mismatch/,
    );
  }

  {
    const finalBytes = Buffer.from("relative-redirect-result");
    const fetchCalls = [];
    let cancelledBodies = 0;
    const dependencies = createDefaultCoreToolsDependencies({
      platform: "linux",
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url, options });
        if (fetchCalls.length === 1) {
          return {
            ok: false,
            status: 307,
            url,
            headers: { get: () => "./release.tar.gz" },
            body: { cancel: async () => { cancelledBodies += 1; } },
          };
        }
        return {
          ok: true,
          status: 200,
          url,
          headers: { get: () => null },
          body: streamingBody(finalBytes),
        };
      },
      runProcess: async () => ({ stdout: "", stderr: "" }),
    });
    assert.deepEqual(
      await dependencies.downloadCodeArchive({
        url: "https://github.com/OpenCoven/coven-code/archive.tar.gz",
        archiveName: "archive.tar.gz",
        expectedSha256: sha256(finalBytes),
        timeoutMs: 1_000,
      }),
      finalBytes,
    );
    assert.deepEqual(fetchCalls.map((call) => call.url), [
      "https://github.com/OpenCoven/coven-code/archive.tar.gz",
      "https://github.com/OpenCoven/coven-code/release.tar.gz",
    ]);
    assert.ok(fetchCalls.every((call) => call.options.redirect === "manual"));
    assert.equal(fetchCalls[0].options.signal, fetchCalls[1].options.signal);
    assert.equal(cancelledBodies, 1);
  }

  {
    const fetchCalls = [];
    const dependencies = createDefaultCoreToolsDependencies({
      platform: "linux",
      fetchImpl: async (url, options) => {
        fetchCalls.push({ url, options });
        return {
          ok: false,
          status: 302,
          url,
          headers: { get: () => `/hop-${fetchCalls.length}` },
          body: { cancel: async () => {} },
        };
      },
      runProcess: async () => ({ stdout: "", stderr: "" }),
    });
    await assert.rejects(
      dependencies.downloadCodeArchive({
        url: "https://github.com/archive.tar.gz",
        archiveName: "archive.tar.gz",
        expectedSha256: "0".repeat(64),
        timeoutMs: 1_000,
      }),
      /exceeded 5 redirects/,
    );
    assert.equal(fetchCalls.length, 6);
    assert.ok(fetchCalls.every((call) => call.options.signal === fetchCalls[0].options.signal));
  }

  for (const [status, location, expected] of [
    [302, null, /redirect missing Location/],
    [300, "/unsupported", /unsupported HTTP redirect status 300/],
  ]) {
    const dependencies = createDefaultCoreToolsDependencies({
      platform: "linux",
      fetchImpl: async (url) => ({
        ok: false,
        status,
        url,
        headers: { get: () => location },
        body: { cancel: async () => {} },
      }),
      runProcess: async () => ({ stdout: "", stderr: "" }),
    });
    await assert.rejects(
      dependencies.downloadCodeArchive({
        url: "https://github.com/archive.tar.gz",
        archiveName: "archive.tar.gz",
        expectedSha256: "0".repeat(64),
        timeoutMs: 1_000,
      }),
      expected,
    );
  }

  {
    const dependencies = createDefaultCoreToolsDependencies({
      platform: "linux",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: "http://downgraded.example/archive.tar.gz",
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
      runProcess: async () => ({ stdout: "", stderr: "" }),
    });
    await assert.rejects(
      dependencies.downloadCodeArchive({
        url: "https://github.com/OpenCoven/coven-code/archive.tar.gz",
        archiveName: "archive.tar.gz",
        expectedSha256: "0".repeat(64),
        timeoutMs: 1_000,
      }),
      /redirected to a non-HTTPS URL/,
    );
  }

  {
    const processCalls = [];
    const dependencies = createDefaultCoreToolsDependencies({
      platform: "linux",
      fetchImpl: async () => {
        throw new Error("fetch must not run during extraction");
      },
      runProcess: async (request) => {
        processCalls.push(request);
        const extractDir = request.args[request.args.indexOf("-C") + 1];
        const output = path.join(extractDir, "coven-code");
        await writeFile(output, "extracted-bytes");
        return { stdout: "", stderr: "" };
      },
    });
    assert.deepEqual(
      await dependencies.extractCodeBinary({
        archiveBytes: Buffer.from("archive-fixture"),
        archiveName: "coven-code-linux-x86_64.tar.gz",
        binaryName: "coven-code",
        timeoutMs: 4_000,
      }),
      Buffer.from("extracted-bytes"),
    );
    assert.equal(processCalls[0].command, "tar");
    assert.deepEqual(processCalls[0].args.slice(-2), ["--", "coven-code"]);
    assert.equal(processCalls[0].timeoutMs, 4_000);
  }

  {
    const processCalls = [];
    const dependencies = createDefaultCoreToolsDependencies({
      platform: "win32",
      fetchImpl: async () => {
        throw new Error("fetch must not run during extraction");
      },
      runProcess: async (request) => {
        processCalls.push(request);
        await writeFile(request.args.at(-1), "windows-extracted-bytes");
        return { stdout: "", stderr: "" };
      },
    });
    assert.deepEqual(
      await dependencies.extractCodeBinary({
        archiveBytes: Buffer.from("zip-fixture"),
        archiveName: "coven-code-windows-x86_64.zip",
        binaryName: "coven-code.exe",
        timeoutMs: 4_000,
      }),
      Buffer.from("windows-extracted-bytes"),
    );
    assert.equal(processCalls[0].command, "powershell.exe");
    const fileArgument = processCalls[0].args.indexOf("-File");
    assert.notEqual(fileArgument, -1, "Windows extraction must invoke a tracked script");
    assert.equal(processCalls[0].args.includes("-Command"), false);
    assert.equal(
      path.basename(processCalls[0].args[fileArgument + 1]),
      "extract-coven-code.ps1",
    );
    assert.match(
      await readFile(processCalls[0].args[fileArgument + 1], "utf8"),
      /\.FullName -ceq \$MemberName/,
      "the tracked extractor must match the requested ZIP member case-sensitively",
    );
    assert.deepEqual(processCalls[0].args.slice(fileArgument + 3, -1), ["coven-code.exe"]);
    assert.equal(processCalls[0].timeoutMs, 4_000);
  }

  {
    const processCalls = [];
    const dependencies = createDefaultCoreToolsDependencies({
      platform: "linux",
      fetchImpl: async () => {
        throw new Error("fetch must not run during a probe");
      },
      runProcess: async (request) => {
        processCalls.push(request);
        return { stdout: "coven 0.0.53\n", stderr: "" };
      },
    });
    assert.equal(
      await dependencies.probeVersion({
        binaryPath: "/fixture/bin/coven",
        args: ["--version"],
        timeoutMs: 3_000,
      }),
      "coven 0.0.53\n",
    );
    assert.deepEqual(processCalls[0], {
      command: "/fixture/bin/coven",
      args: ["--version"],
      timeoutMs: 3_000,
    });
  }
}

function cliParsingCases() {
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const canonicalDest = path.join(repositoryRoot, "src-tauri", "resources", "tools");
  assert.deepEqual(parseStageCoreToolsArgs(["--refresh-manifest", "/tmp/tools"]), {
    mode: "refresh",
    toolsDir: path.resolve("/tmp/tools"),
  });
  assert.deepEqual(parseStageCoreToolsArgs(["--verify", "/tmp/tools"]), {
    mode: "verify",
    toolsDir: path.resolve("/tmp/tools"),
  });
  assert.deepEqual(
    parseStageCoreToolsArgs([
      "--node-modules",
      "/tmp/node_modules",
      "--dest",
      canonicalDest,
    ]),
    {
      mode: "stage",
      nodeModules: path.resolve("/tmp/node_modules"),
      dest: canonicalDest,
      platform: process.platform,
      arch: process.arch,
    },
  );
  for (const unsafeDest of [
    ".",
    repositoryRoot,
    path.parse(repositoryRoot).root,
    path.dirname(repositoryRoot),
    path.join(repositoryRoot, "src-tauri", "resources", "not-tools"),
  ]) {
    assert.throws(
      () => parseStageCoreToolsArgs(["--dest", unsafeDest]),
      /--dest must be the canonical Tauri tools resource directory/,
    );
  }
  assert.throws(
    () => parseStageCoreToolsArgs(["--dest", canonicalDest, "--platform", "linux"]),
    /--platform is not supported/,
  );
  assert.throws(
    () => parseStageCoreToolsArgs(["--dest", canonicalDest, "--arch", "x64"]),
    /--arch is not supported/,
  );
  assert.throws(
    () => parseStageCoreToolsArgs(["--node-modules", "/tmp/node_modules"]),
    /--dest is required/,
  );
  assert.throws(
    () => parseStageCoreToolsArgs(["--verify", "/tmp/tools", "--arch", "x64"]),
    /maintenance mode accepts exactly/,
  );
  assert.throws(() => parseStageCoreToolsArgs(["--refresh-manifest"]), /requires a tools directory/);
  assert.throws(() => parseStageCoreToolsArgs(["--unknown"]), /unknown option/);
}

async function repositoryLegalAssetsCase() {
  const fixture = await createFixture();
  const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
  const attributeLines = new Set(
    (await readFile(path.join(repositoryRoot, ".gitattributes"), "utf8"))
      .split(/\r?\n/)
      .filter(Boolean),
  );
  const pinnedLegalAssets = [
    {
      file: path.join("licenses", "coven-cli-MIT.txt"),
      size: 1_076,
      blob: CORE_TOOLS_LOCK.coven.licenseBlob,
    },
    {
      file: path.join("licenses", "coven-code-GPL-3.0.txt"),
      size: 35_821,
      blob: CORE_TOOLS_LOCK.covenCode.licenseBlob,
    },
    {
      file: path.join("licenses", "coven-code-ATTRIBUTION.md"),
      size: 2_446,
      blob: CORE_TOOLS_LOCK.covenCode.attributionBlob,
    },
  ];
  for (const asset of pinnedLegalAssets) {
    const attributePath = asset.file.split(path.sep).join("/");
    assert.equal(
      attributeLines.has(`${attributePath} -text`),
      true,
      `${attributePath} must disable Git line-ending conversion`,
    );
    const bytes = await readFile(path.join(repositoryRoot, asset.file));
    assert.equal(bytes.length, asset.size, `${attributePath} byte size changed`);
    assert.equal(gitBlobSha(bytes), asset.blob, `${attributePath} Git blob changed`);
  }
  const expectedNotice = `# Third-party notices

## Coven CLI 0.0.53

Copyright OpenCoven contributors. Distributed unmodified under the MIT License.
Corresponding source: https://github.com/OpenCoven/coven/tree/v0.0.53

## Coven Code 0.5.1

Copyright OpenCoven contributors and Claurst contributors. Distributed
unmodified under GPL-3.0-only. Coven Code is derived from Claurst; attribution,
license text, and corresponding source are available at:
https://github.com/OpenCoven/coven-code/tree/v0.5.1
`;
  assert.equal(
    await readFile(path.join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), "utf8"),
    expectedNotice,
  );
  await stageCoreTools({
    platform: "linux",
    arch: "x64",
    nodeModules: fixture.nodeModules,
    dest: fixture.dest,
    legalRoot: repositoryRoot,
    lock: CORE_TOOLS_LOCK,
    deps: fixture.deps,
  });
  for (const [source, staged] of [
    ["THIRD_PARTY_NOTICES.md", path.join("licenses", "THIRD_PARTY_NOTICES.md")],
    [
      path.join("licenses", "coven-cli-MIT.txt"),
      path.join("licenses", "coven-cli-MIT.txt"),
    ],
    [
      path.join("licenses", "coven-code-GPL-3.0.txt"),
      path.join("licenses", "coven-code-GPL-3.0.txt"),
    ],
    [
      path.join("licenses", "coven-code-ATTRIBUTION.md"),
      path.join("licenses", "coven-code-ATTRIBUTION.md"),
    ],
  ]) {
    assert.deepEqual(
      await readFile(path.join(fixture.dest, staged)),
      await readFile(path.join(repositoryRoot, source)),
    );
  }
}

await failClosedFixtureCases();
await intelProvenanceCases();
await maintenanceCases();
await atomicJsonCases();
await exactVersionTokenCases();
await maintenanceContainmentCases();
await publicationRollbackCase();
await apiDestinationSafetyCases();
await destinationSafetyMatrixCases();
await canonicalToolsFinalSymlinkCase();
await canonicalToolsAncestorSymlinkCases();
await defaultDependencyCases();
cliParsingCases();
await repositoryLegalAssetsCase();
await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true })));

console.log("stage-core-tools.test.mjs: staging, provenance, maintenance, and CLI fixtures ok");
