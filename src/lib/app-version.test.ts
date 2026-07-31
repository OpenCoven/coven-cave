// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import YAML from "yaml";

const packageJson = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
const tauriConfig = JSON.parse(await readFile(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const cargoToml = await readFile(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");
const iosProject = await readFile(new URL("../../apps/ios/CovenCave/project.yml", import.meta.url), "utf8");
const appVersionSource = await readFile(new URL("./app-version.ts", import.meta.url), "utf8");
const releaseWorkflow = await readFile(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
const buildInfoRoute = await readFile(new URL("../app/api/app/build-info/route.ts", import.meta.url), "utf8");

function collectReleaseSettingOccurrences(node, targetKey, sourceLabel, path = [], occurrences = []) {
  if (YAML.isMap(node)) {
    for (const pair of node.items) {
      const keyNode = pair.key;
      if (!YAML.isScalar(keyNode) || typeof keyNode.value !== "string") {
        throw new Error(
          `${sourceLabel} release validation requires string mapping keys; found ${describeOpaqueMappingKey(keyNode)} at ${formatPathSegments(path)}`,
        );
      }

      const nextPath = [...path, keyNode.value];
      if (keyNode.value === targetKey) {
        occurrences.push({ path: nextPath, valueNode: pair.value });
      }
      collectReleaseSettingOccurrences(pair.value, targetKey, sourceLabel, nextPath, occurrences);
    }
  } else if (YAML.isSeq(node)) {
    node.items.forEach((item, index) => {
      collectReleaseSettingOccurrences(item, targetKey, sourceLabel, [...path, String(index)], occurrences);
    });
  }

  return occurrences;
}

function samePathSegments(left, right) {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function formatPathSegments(path) {
  return JSON.stringify(path);
}

function describeOpaqueMappingKey(keyNode) {
  if (keyNode?.constructor?.name === "Alias") {
    return "alias mapping key";
  }

  if (YAML.isSeq(keyNode)) {
    return "sequence mapping key";
  }

  if (YAML.isMap(keyNode)) {
    return "mapping mapping key";
  }

  return "non-string mapping key";
}

function readIosReleaseSettings(source, sourceLabel = "apps/ios/CovenCave/project.yml") {
  const document = YAML.parseDocument(source, { prettyErrors: true });

  if (document.errors.length > 0) {
    throw document.errors[0];
  }

  const marketingVersion = readCanonicalReleaseSetting(document, "MARKETING_VERSION", sourceLabel);
  const buildVersion = readCanonicalReleaseSetting(document, "CURRENT_PROJECT_VERSION", sourceLabel);

  return { marketingVersion, buildVersion };
}

function readCanonicalReleaseSetting(document, key, sourceLabel) {
  const canonicalPath = ["settings", "base", key];
  const occurrences = collectReleaseSettingOccurrences(document.contents, key, sourceLabel);

  if (occurrences.length !== 1 || !samePathSegments(occurrences[0].path, canonicalPath)) {
    const detail =
      occurrences.length === 0
        ? "was not found"
        : `was also found at ${occurrences.map((occurrence) => formatPathSegments(occurrence.path)).join(", ")}`;
    throw new Error(
      `${sourceLabel} must define ${key} exactly once at ${formatPathSegments(canonicalPath)}; ${detail}`,
    );
  }

  const valueNode = occurrences[0].valueNode;

  if (!YAML.isScalar(valueNode) || typeof valueNode.value !== "string") {
    throw new Error(`${sourceLabel} must use a string scalar at ${formatPathSegments(canonicalPath)}`);
  }

  return valueNode.value;
}

const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const cargoDescription = cargoToml.match(/^description\s*=\s*"([^"]+)"/m)?.[1];
const cargoAuthors = cargoToml.match(/^authors\s*=\s*\[([^\]]+)\]/m)?.[1] ?? "";
const cargoLicense = cargoToml.match(/^license\s*=\s*"([^"]+)"/m)?.[1];
const cargoRepository = cargoToml.match(/^repository\s*=\s*"([^"]+)"/m)?.[1];
const iosReleaseSettings = readIosReleaseSettings(iosProject);
const iosMarketingVersion = iosReleaseSettings.marketingVersion;
const iosBuildVersion = iosReleaseSettings.buildVersion;

assert.equal(tauriConfig.version, packageJson.version, "Tauri bundle version must match package.json");
assert.equal(cargoVersion, packageJson.version, "Tauri Cargo package version must match package.json");
assert.equal(
  cargoDescription,
  "Desktop control room for OpenCoven familiars, workflows, memory, and local agent sessions.",
  "Cargo package description must describe CovenCave, not the Tauri template",
);
assert.match(cargoAuthors, /OpenCoven contributors/, "Cargo package authors must name OpenCoven contributors");
assert.equal(cargoLicense, "MIT OR AGPL-3.0-only", "Cargo package license must match the repository dual-license offer");
assert.equal(cargoRepository, "https://github.com/OpenCoven/coven-cave", "Cargo package repository must point at Coven Cave");
assert.equal(packageJson.description, cargoDescription, "package.json and Cargo descriptions must match");
assert.equal(packageJson.license, cargoLicense, "package.json and Cargo licenses must match");
assert.equal(tauriConfig.bundle.publisher, "OpenCoven", "Tauri bundle publisher must be OpenCoven");
assert.equal(tauriConfig.bundle.license, cargoLicense, "Tauri bundle license must match Cargo license");
assert.equal(tauriConfig.bundle.licenseFile, "../LICENSE", "Tauri bundle must include the repository license notice");
assert.equal(tauriConfig.bundle.category, "DeveloperTool", "Tauri bundle category must identify CovenCave as a developer tool");
assert.match(
  tauriConfig.bundle.longDescription,
  /OpenCoven desktop control room/,
  "Tauri bundle long description must explain the app's purpose",
);
assert.match(
  appVersionSource,
  /from "\.\.\/\.\.\/package\.json"/,
  "App-reported version must be sourced from package.json",
);
assert.match(
  appVersionSource,
  /export const APP_VERSION/,
  "App version module must export APP_VERSION for UI reporting",
);
assert.match(
  appVersionSource,
  /NEXT_PUBLIC_COVEN_CAVE_BUILD_REVISION/,
  "App build identity must be supplied from an explicit public release revision",
);
assert.match(appVersionSource, /export const APP_BUILD_REVISION/, "App build revision must be available to diagnostics");
assert.match(appVersionSource, /export const APP_BUILD_IDENTITY/, "App build identity must combine version and revision");
assert.ok(
  iosMarketingVersion,
  "apps/ios/CovenCave/project.yml must define MARKETING_VERSION",
);
assert.equal(
  iosMarketingVersion,
  packageJson.version,
  "iOS MARKETING_VERSION must match package.json version",
);
assert.equal(
  iosBuildVersion,
  "1",
  "iOS CURRENT_PROJECT_VERSION must remain 1 for this release",
);

assert.throws(
  () =>
    readIosReleaseSettings(`
name: Example
settings:
  base:
    MARKETING_VERSION: "0.2.1"
targets:
  Example:
    settings:
      base:
        MARKETING_VERSION: "9.9.9"
`),
  /\["settings","base","MARKETING_VERSION"\]/,
  "A target-level MARKETING_VERSION override must be rejected",
);

assert.throws(
  () =>
    readIosReleaseSettings(`
name: Example
"settings.base":
  MARKETING_VERSION: "0.2.1"
  CURRENT_PROJECT_VERSION: "1"
`),
  /\["settings","base","MARKETING_VERSION"\]/,
  "A literal dotted settings.base mapping must not satisfy the canonical nested path",
);

assert.throws(
  () =>
    readIosReleaseSettings(
      `
name: Example
settings:
  ? [ignored]
  : base:
      MARKETING_VERSION: "0.2.1"
      CURRENT_PROJECT_VERSION: "1"
`,
      "fixtures/complex-mapping-key.yml",
    ),
  /fixtures\/complex-mapping-key\.yml.*string mapping keys/i,
  "A complex mapping key on the release path must be rejected explicitly",
);

assert.throws(
  () =>
    readIosReleaseSettings(
      `
name: Example
settings:
  base: &baseSettings
    MARKETING_VERSION: "0.2.1"
    CURRENT_PROJECT_VERSION: "1"
  ? *baseSettings
  : MARKETING_VERSION: "9.9.9"
`,
      "fixtures/alias-mapping-key.yml",
    ),
  /fixtures\/alias-mapping-key\.yml.*string mapping keys/i,
  "An alias mapping key that hides a MARKETING_VERSION override must be rejected explicitly",
);

assert.throws(
  () =>
    readIosReleaseSettings(`
name: Example
settings:
  base:
    MARKETING_VERSION: "0.2.1
    CURRENT_PROJECT_VERSION: "1"
`),
  /Unexpected end of stream|quoted scalar|parse/i,
  "An unbalanced quoted marketing version must be rejected by semantic parsing",
);

assert.deepEqual(
  readIosReleaseSettings(`
name: Example
settings:
  base:
    MARKETING_VERSION: "0.2.1"
    CURRENT_PROJECT_VERSION: "1"
`),
  {
    marketingVersion: "0.2.1",
    buildVersion: "1",
  },
  "A canonical quoted document must yield semantic release values",
);

assert.match(
  releaseWorkflow,
  /NEXT_PUBLIC_COVEN_CAVE_BUILD_REVISION=\$\(git rev-parse --verify HEAD\)/,
  "release builds must bake the checked-out source revision into the packaged app",
);
assert.match(buildInfoRoute, /APP_BUILD_IDENTITY/, "the packaged sidecar exposes a safe artifact identity endpoint");
assert.match(buildInfoRoute, /APP_BUILD_REVISION/, "the artifact endpoint includes its revision fingerprint");

console.log("app-version.test.ts: ok");
