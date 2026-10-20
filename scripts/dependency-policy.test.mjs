import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { parse } from "yaml";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const workspaceConfig = parse(await readFile(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8"));

const exactVersion = /^(?:\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?|workspace:\*)$/;
const depBlocks = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];

// Independently released Research: one reviewed URL with locked content integrity.
// Do not allow arbitrary URL, git, or local-path dependencies.
const researchPin = "https://github.com/OpenCoven/research/releases/download/v0.1.0/opencoven-research-0.1.0.tgz";
const researchIntegrity = "sha512-3FkNXEyn7BDNdhAAeKOaELqB5RsncuKUJkBVzaOJMshM4iqjRvxydDu8E6uUrQ3T3n36gcQIPmGxpKiJGgKhIQ==";
assert.equal(packageJson.optionalDependencies?.["@opencoven/research"], researchPin);

// The selected SDK is not published. These two reviewed tarballs are immutable
// source-pinned exceptions, not general permission for file/git dependencies.
const sdkPins = {
  "@opencoven/sdk-core": ["opencoven-sdk-core-0.0.1.tgz", "5f41291d303cf25e5ff4a3c40d0169f025f7e218da8637fc905935524b5e4e2b"],
  "@opencoven/coven-client": ["opencoven-coven-client-0.0.1.tgz", "5333c508bfb2e4bf4c5fce8e488a9f343e0894f10bdbac75f69427654a231180"],
};
const sdkProvenance = JSON.parse(await readFile(new URL("../vendor/opencoven-sdk/provenance.json", import.meta.url), "utf8"));
assert.equal(sdkProvenance.repository, "https://github.com/OpenCoven/sdk");
assert.equal(sdkProvenance.revision, "d19fdbe3912c012b3730932d5a03eff10ba3d32d");
assert.equal(sdkProvenance.packages.length, 2);
for (const [name, [file, digest]] of Object.entries(sdkPins)) {
  const bytes = await readFile(new URL(`../vendor/opencoven-sdk/${file}`, import.meta.url));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), digest, `${name} archive integrity`);
  const entry = sdkProvenance.packages.find(entry => entry.name === name);
  assert.deepEqual([entry?.file, entry?.sha256, entry?.bytes], [file, digest, bytes.length]);
  assert.equal(packageJson.dependencies[name], `file:vendor/opencoven-sdk/${file}`);
}
assert.equal(packageJson.pnpm.overrides["@opencoven/sdk-core"], packageJson.dependencies["@opencoven/sdk-core"]);

for (const blockName of depBlocks) {
  const block = packageJson[blockName] ?? {};
  for (const [name, version] of Object.entries(block)) {
    assert.equal(
      exactVersion.test(version) || (blockName === "optionalDependencies" && name === "@opencoven/research" && version === researchPin) || (blockName === "dependencies" && Object.hasOwn(sdkPins, name) && version === `file:vendor/opencoven-sdk/${sdkPins[name][0]}`),
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

assert.equal(
  packageJson.dependencies?.["@hpke/core"],
  "1.9.0",
  "@hpke/core must be a pinned production dependency",
);
assert.equal(
  packageJson.dependencies?.["@hpke/dhkem-x25519"],
  "1.8.0",
  "@hpke/dhkem-x25519 must be a pinned production dependency",
);
assert.equal(
  Object.hasOwn(packageJson.devDependencies ?? {}, "@hpke/core"),
  false,
  "@hpke/core must not be a development dependency",
);
assert.equal(
  Object.hasOwn(packageJson.devDependencies ?? {}, "@hpke/dhkem-x25519"),
  false,
  "@hpke/dhkem-x25519 must not be a development dependency",
);
assert.equal(
  packageJson.pnpm?.overrides?.["@hpke/common"],
  "1.10.0",
  "@hpke/common must resolve to the audited pinned version",
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
const researchLocked = Object.values(lockPackages).filter(entry => entry.resolution?.tarball === researchPin);
assert.equal(researchLocked.length, 1, "Research must have one published archive resolution");
assert.equal(researchLocked[0].resolution.integrity, researchIntegrity, "Research archive content must match the verified release");
assert.equal(lockfile.importers["."].optionalDependencies["@opencoven/research"].specifier, researchPin);

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

// Security floors for the dependency families used by Cave (#6139). Check every
// resolved copy, not just direct dependencies or override declarations.
const securityFloors = {
  "vite": "8.1.6", // GHSA-698v-4r3x-3vcv
  "dompurify": "3.4.16", // GHSA-6688-9rhm-gjv2, GHSA-p98j-92pf-mc4p
  "katex": "0.18.2", // GHSA-238p-pmpm-9mq7
  "source-map-js": "1.2.2", // GHSA-68fv-2mgg-jv7q
  "@vue/server-renderer": "3.5.42", // GHSA-g2v6-rqmx-r4w6
  "prosemirror-view": "1.42.3", // GHSA-c8x8-7fp4-3x9w
  "brace-expansion": "5.0.12", // GHSA-q2hr-2g5m-vwhr
};
function atLeastStable(version, floor) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return false;
  const actual = version.split(".").map(Number);
  const minimum = floor.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  }
  return true;
}
const vulnerable = Object.keys(lockPackages).map(splitLockKey)
  .filter(({ name, version }) => securityFloors[name] && !atLeastStable(version, securityFloors[name]));
const cargoLock = await readFile(new URL("../src-tauri/Cargo.lock", import.meta.url), "utf8");
for (const entry of cargoLock.split("[[package]]")) {
  if (!/^name = "rustls"$/m.test(entry)) continue;
  const version = /^version = "([^"]+)"$/m.exec(entry)?.[1];
  if (!atLeastStable(version ?? "", "0.23.45")) vulnerable.push({ name: "rustls", version });
}
assert.deepEqual(vulnerable, [], "Resolved dependency graph must exclude the vulnerable versions from #6139");

// KaTeX's security release crosses the consumers' 0.x ranges. Exercise the
// actual copies loaded by both consumers, including the advisory's trust gadget.
const require = createRequire(import.meta.url);
for (const consumer of ["mermaid", "@milkdown/crepe"]) {
  const katex = createRequire(require.resolve(consumer))("katex");
  assert.match(katex.renderToString("c = \\pm\\sqrt{a^2 + b^2}", { throwOnError: true }), /katex-mathml/);
  const inheritedTrust = Object.create({ trust: true });
  const output = katex.renderToString("\\href{javascript:alert(1)}{click}", inheritedTrust);
  assert.doesNotMatch(output, /href=["']javascript:/i, `${consumer} must not inherit trusted rendering`);
}

console.log(`dependency-policy.test.mjs: ok (sharp pinned coherently at ${resolvedSharp}; security floors satisfied)`);
