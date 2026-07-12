import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { CORE_TOOLS_LOCK, resolveCoreToolsTarget } from "./core-tools-target.mjs";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

assert.deepEqual(CORE_TOOLS_LOCK, {
  schemaVersion: 1,
  coven: {
    package: "@opencoven/cli",
    version: "0.0.53",
    licenseBlob: "0cea5dc1a1ce3355c1353b961a8ca7a90367f976",
    intelSource: {
      repository: "https://github.com/OpenCoven/coven.git",
      tag: "v0.0.53",
      tagObject: "c390d3b69445b0769032d08b672afec83d71dcd8",
      commit: "a36fc5cb76bbafe7a0fbef888b68f22ad56106f5",
    },
  },
  covenCode: {
    package: "@opencoven/coven-code",
    version: "0.5.1",
    licenseBlob: "871ce8e638ad6d763308e44411d2c4a2e658cf55",
    attributionBlob: "74c026f0dc83489fdd7d4ff8d66eb5a81039b783",
  },
});
assert.equal(
  packageJson.dependencies[CORE_TOOLS_LOCK.coven.package],
  CORE_TOOLS_LOCK.coven.version,
  "root Coven CLI dependency must match the provenance lock",
);
assert.equal(
  packageJson.dependencies[CORE_TOOLS_LOCK.covenCode.package],
  CORE_TOOLS_LOCK.covenCode.version,
  "root Coven Code dependency must match the provenance lock",
);
assert.equal(Object.isFrozen(CORE_TOOLS_LOCK), true);
assert.equal(Object.isFrozen(CORE_TOOLS_LOCK.coven), true);
assert.equal(Object.isFrozen(CORE_TOOLS_LOCK.coven.intelSource), true);
assert.equal(Object.isFrozen(CORE_TOOLS_LOCK.covenCode), true);
assert.throws(() => {
  CORE_TOOLS_LOCK.coven.intelSource.commit = "poisoned-commit";
}, TypeError);
assert.equal(
  CORE_TOOLS_LOCK.coven.intelSource.commit,
  "a36fc5cb76bbafe7a0fbef888b68f22ad56106f5",
);

assert.deepEqual(resolveCoreToolsTarget({ platform: "darwin", arch: "arm64" }), {
  supported: true,
  target: "darwin-aarch64",
  cli: {
    kind: "package",
    packageName: "@opencoven/cli-macos",
    binary: "bin/coven",
  },
  codeArchive: "coven-code-macos-aarch64.tar.gz",
  outputNames: { coven: "coven", covenCode: "coven-code" },
});

assert.deepEqual(resolveCoreToolsTarget({ platform: "darwin", arch: "x64" }), {
  supported: true,
  target: "darwin-x86_64",
  cli: {
    kind: "source",
    repository: "https://github.com/OpenCoven/coven.git",
    tag: "v0.0.53",
    tagObject: "c390d3b69445b0769032d08b672afec83d71dcd8",
    commit: "a36fc5cb76bbafe7a0fbef888b68f22ad56106f5",
    binary: "target/release/coven",
  },
  codeArchive: "coven-code-macos-x86_64.tar.gz",
  outputNames: { coven: "coven", covenCode: "coven-code" },
});

assert.deepEqual(resolveCoreToolsTarget({ platform: "linux", arch: "x64" }), {
  supported: true,
  target: "linux-x86_64",
  cli: {
    kind: "package",
    packageName: "@opencoven/cli-linux-x64",
    binary: "bin/coven",
  },
  codeArchive: "coven-code-linux-x86_64.tar.gz",
  outputNames: { coven: "coven", covenCode: "coven-code" },
});

assert.deepEqual(resolveCoreToolsTarget({ platform: "win32", arch: "x64" }), {
  supported: true,
  target: "windows-x86_64",
  cli: {
    kind: "package",
    packageName: "@opencoven/cli-windows",
    binary: "bin/coven.exe",
  },
  codeArchive: "coven-code-windows-x86_64.zip",
  outputNames: { coven: "coven.exe", covenCode: "coven-code.exe" },
});

assert.deepEqual(resolveCoreToolsTarget({ platform: "linux", arch: "arm64" }), {
  supported: false,
  platform: "linux",
  arch: "arm64",
});

const mutableResult = resolveCoreToolsTarget({ platform: "linux", arch: "x64" });
mutableResult.cli.packageName = "@example/poisoned-cli";
mutableResult.outputNames.coven = "poisoned-coven";

const resolvedAgain = resolveCoreToolsTarget({ platform: "linux", arch: "x64" });
assert.deepEqual(resolvedAgain.cli, {
  kind: "package",
  packageName: "@opencoven/cli-linux-x64",
  binary: "bin/coven",
});
assert.deepEqual(resolvedAgain.outputNames, {
  coven: "coven",
  covenCode: "coven-code",
});

console.log("core-tools-target.test.mjs: ok");
