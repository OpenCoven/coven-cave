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

// --- sharp version-skew guard (Windows sidecar) ------------------------------
// `next` hard-pins its own `sharp`; bumping our direct `sharp` dependency above
// that pin makes two sharp versions coexist in the lockfile. The sidecar's
// hoisted staging bundle then loads one version's `@img/sharp-<target>` native
// under the other version's JS → native/JS ABI mismatch → on win32 `format()`
// returns a table with no `heif`, so `sharp/dist/utility.cjs` throws at load and
// the avatar route 500s. macOS/Linux tolerate the mismatch, so ONLY the
// `Sidecar runtime (windows-latest)` CI leg catches it. This guard fails fast in
// the required Frontend-build check instead. Fix a divergence by aligning `sharp`
// to next's pin, or by adding `pnpm.overrides.sharp` so next's transitive copy is
// forced to the same version. (PR #2263 dug out this root cause.)
const lockfile = parse(await readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8"));
const lockPackages = lockfile.packages ?? lockfile.snapshots ?? {};

const splitLockKey = (key) => {
  const at = key.lastIndexOf("@");
  return { name: key.slice(0, at), version: key.slice(at + 1).replace(/\(.*\)$/, "") };
};

const sharpVersions = new Set();
const nativeVersions = new Map(); // `@img/sharp-<target>` → Set<version>
for (const key of Object.keys(lockPackages)) {
  const { name, version } = splitLockKey(key);
  if (name === "sharp") sharpVersions.add(version);
  // native ABI packages track sharp's version in lockstep; libvips packages do not.
  if (/^@img\/sharp-(?!libvips)/.test(name)) {
    if (!nativeVersions.has(name)) nativeVersions.set(name, new Set());
    nativeVersions.get(name).add(version);
  }
}

assert.ok(sharpVersions.size >= 1, "sharp must be present in pnpm-lock.yaml");
assert.equal(
  sharpVersions.size,
  1,
  `sharp must resolve to a SINGLE version in pnpm-lock.yaml, found ${[...sharpVersions].sort().join(", ")}. ` +
    "This is the version skew that breaks the Windows sidecar bundle: next pins its own sharp, so a direct " +
    "bump adds a second copy and the hoisted @img/sharp-<target> native mismatches sharp's JS (win32 drops " +
    "heif). Align sharp to next's pinned version, or add pnpm.overrides.sharp to force next's transitive copy.",
);

const [resolvedSharp] = [...sharpVersions];
assert.equal(
  packageJson.dependencies?.sharp,
  resolvedSharp,
  `package.json dependencies.sharp (${packageJson.dependencies?.sharp}) must equal the single resolved ` +
    `lockfile sharp version (${resolvedSharp})`,
);

for (const [name, versions] of nativeVersions) {
  assert.equal(
    versions.size,
    1,
    `${name} must resolve to a single version in pnpm-lock.yaml, found ${[...versions].sort().join(", ")} ` +
      "— a native/JS ABI skew that crashes the Windows sidecar. Reconcile sharp to one version (see above).",
  );
  assert.ok(
    versions.has(resolvedSharp),
    `${name} (${[...versions][0]}) must match the resolved sharp version (${resolvedSharp}); ` +
      "the sidecar bundle loads this native under sharp's JS.",
  );
}

console.log(`dependency-policy.test.mjs: ok (sharp pinned coherently at ${resolvedSharp})`);
