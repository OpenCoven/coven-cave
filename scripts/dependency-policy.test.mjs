import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const workspaceConfig = parse(await readFile(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8"));

const exactVersion = /^(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?|workspace:\*)$/;
const depBlocks = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

for (const blockName of depBlocks) {
  const block = packageJson[blockName] ?? {};
  for (const [name, version] of Object.entries(block)) {
    assert.equal(
      exactVersion.test(version),
      true,
      `${blockName}.${name} must be pinned to an exact version, got ${version}`,
    );
  }
}

assert.match(
  packageJson.packageManager ?? "",
  /^pnpm@\d+\.\d+\.\d+$/,
  "packageManager must pin an exact pnpm version",
);

const [, pnpmVersion] = /^pnpm@(.+)$/.exec(packageJson.packageManager ?? "") ?? [];
assert.ok(pnpmVersion, "packageManager must use pnpm");
const [major, minor] = pnpmVersion.split(".").map(Number);
assert.ok(
  major > 10 || (major === 10 && minor >= 16),
  "packageManager must be pnpm >= 10.16.0 so minimumReleaseAge is enforced",
);

assert.equal(
  workspaceConfig.minimumReleaseAge,
  4320,
  "pnpm minimumReleaseAge must require packages to be at least 3 days old",
);

assert.equal(
  workspaceConfig.saveExact,
  true,
  "pnpm saveExact must keep future added dependencies pinned by default",
);

console.log("dependency-policy.test.mjs: ok");
