#!/usr/bin/env node
// Tests for scripts/sidecar-lock.mjs — the cave-sidecar.lock.json reader.
// Covers: the checked-in lockfile is valid and agrees with the literal pins
// still living in the bundle scripts (until items 2-4 migrate them), schema
// validation rejects malformed input, and the canonical digest is stable
// under key reordering but sensitive to value changes.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SIDECAR_LOCK_FILENAME,
  SIDECAR_LOCK_SCHEMA_VERSION,
  loadSidecarLock,
  resolveComponentAssets,
  sidecarLockDigest,
  validateSidecarLock,
} from "./sidecar-lock.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function clone(value) {
  return structuredClone(value);
}

function validFixture() {
  return {
    version: SIDECAR_LOCK_SCHEMA_VERSION,
    components: {
      node: { kind: "host-toolchain", version: "24.18.0", match: "major-minor" },
      piper: {
        kind: "release-asset",
        repo: "rhasspy/piper",
        tag: "2023.11.14-2",
        assets: {
          "darwin-arm64": { name: "piper_macos_aarch64.tar.gz", sha256: "a".repeat(64) },
        },
        extraAssets: {
          "darwin-arm64": [{ name: "piper-phonemize_macos_aarch64.tar.gz", sha256: "b".repeat(64) }],
          all: [{ name: "espeak-ng-data.tar.bz2", tag: "tts-models", sha256: "c".repeat(64) }],
        },
      },
      coven: { kind: "external-binary", minVersion: null, requiredFlags: ["--stream-json"] },
    },
  };
}

// --- checked-in lockfile ---

{
  const { lock, digest, file } = loadSidecarLock(root);
  assert.equal(lock.version, SIDECAR_LOCK_SCHEMA_VERSION);
  assert.equal(path.basename(file), SIDECAR_LOCK_FILENAME);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(validateSidecarLock(lock), []);
  for (const name of ["node", "piper", "kokoro", "whisper", "coven"]) {
    assert.ok(lock.components[name], `lockfile must pin component "${name}"`);
  }
}

// Until items 2-4 of the spec migrate the bundle scripts onto the lockfile,
// the pins are duplicated. This guard fails if either side drifts: every
// sha256 in the lockfile's piper/kokoro/whisper components must appear
// verbatim in the corresponding script, and vice-versa for the versions.
{
  const { lock } = loadSidecarLock(root);
  const scriptFor = {
    piper: "scripts/sidecar-bundle.sh",
    kokoro: "scripts/sidecar-bundle.sh",
    whisper: "scripts/whisper-runtime-bundle.sh",
  };
  for (const [componentName, scriptPath] of Object.entries(scriptFor)) {
    const script = readFileSync(path.join(root, scriptPath), "utf8");
    const component = lock.components[componentName];
    const entries = [
      ...Object.values(component.assets),
      ...Object.values(component.extraAssets ?? {}).flat(),
    ];
    for (const entry of entries) {
      assert.ok(
        script.includes(entry.sha256),
        `${scriptPath} lost pin ${entry.name} (${entry.sha256}) still recorded in ${SIDECAR_LOCK_FILENAME}`,
      );
      assert.ok(
        script.includes(entry.name),
        `${scriptPath} lost asset name ${entry.name} recorded in ${SIDECAR_LOCK_FILENAME}`,
      );
    }
    assert.ok(script.includes(component.tag), `${scriptPath} lost tag ${component.tag}`);
    for (const build of Object.values(component.sourceBuilds ?? {})) {
      assert.ok(script.includes(build.commit), `${scriptPath} lost source commit ${build.commit}`);
    }
  }
  const prereqs = readFileSync(path.join(root, "src/lib/onboarding-prerequisites.ts"), "utf8");
  assert.ok(
    prereqs.includes(`"${lock.components.node.version}"`),
    `onboarding-prerequisites.ts MANAGED_NODE_VERSION drifted from lockfile ${lock.components.node.version}`,
  );
}

// --- validation ---

assert.deepEqual(validateSidecarLock(validFixture()), []);
assert.deepEqual(validateSidecarLock(null), ["lockfile root must be a JSON object"]);
assert.deepEqual(validateSidecarLock([]), ["lockfile root must be a JSON object"]);

function assertRejected(mutate, needle) {
  const lock = validFixture();
  mutate(lock);
  const errors = validateSidecarLock(lock);
  assert.ok(
    errors.some((error) => error.includes(needle)),
    `expected an error mentioning "${needle}", got: ${JSON.stringify(errors)}`,
  );
}

assertRejected((lock) => (lock.version = 2), '"version" must be 1');
assertRejected((lock) => delete lock.components, '"components" must be a non-empty object');
assertRejected((lock) => (lock.extra = true), 'unknown top-level field "extra"');
assertRejected((lock) => (lock.components.piper.kind = "mystery"), 'unknown kind "mystery"');
assertRejected((lock) => (lock.components.piper.repo = "not a repo!"), "owner/repo");
assertRejected((lock) => (lock.components.piper.tag = ""), '"tag" must be a non-empty string');
assertRejected(
  (lock) => (lock.components.piper.assets["darwin-arm64"].sha256 = "ABC123"),
  "64 lowercase hex chars",
);
assertRejected(
  (lock) => (lock.components.piper.assets["freebsd-x64"] = { name: "x.tar.gz", sha256: "d".repeat(64) }),
  'unknown platform-arch key "freebsd-x64"',
);
assertRejected(
  (lock) => (lock.components.piper.assets["darwin-arm64"].mirror = "https://example.com"),
  'unknown asset field "mirror"',
);
assertRejected((lock) => delete lock.components.piper.assets["darwin-arm64"].name, '"name" must be a non-empty string');
assertRejected((lock) => (lock.components.node.version = "24.18"), '"version" must be semver x.y.z');
assertRejected((lock) => (lock.components.node.match = "loose"), '"match" must be exact | major-minor | major');
assertRejected((lock) => (lock.components.coven.minVersion = 7), '"minVersion" must be a string or null');
assertRejected(
  (lock) => (lock.components.coven.requiredFlags = ["stream-json"]),
  '"requiredFlags" must be an array of --flags',
);
assertRejected(
  (lock) => (lock.components.piper.sourceBuilds = { darwin: { repo: "a/b", commit: "short" } }),
  '"commit" must be a 40-char sha',
);

// --- digest ---

{
  const lock = validFixture();
  const digest = sidecarLockDigest(lock);
  assert.match(digest, /^[0-9a-f]{64}$/);

  // Reordering keys must not change the digest.
  const reordered = {
    components: {
      coven: clone(lock.components.coven),
      piper: {
        extraAssets: clone(lock.components.piper.extraAssets),
        assets: clone(lock.components.piper.assets),
        tag: lock.components.piper.tag,
        repo: lock.components.piper.repo,
        kind: "release-asset",
      },
      node: { match: "major-minor", version: "24.18.0", kind: "host-toolchain" },
    },
    version: lock.version,
  };
  assert.equal(sidecarLockDigest(reordered), digest);

  // Any value change must change the digest.
  const bumped = clone(lock);
  bumped.components.piper.tag = "2023.11.14-3";
  assert.notEqual(sidecarLockDigest(bumped), digest);

  const reSha = clone(lock);
  reSha.components.piper.assets["darwin-arm64"].sha256 = "f".repeat(64);
  assert.notEqual(sidecarLockDigest(reSha), digest);
}

// --- resolveComponentAssets ---

{
  const lock = validFixture();
  const resolved = resolveComponentAssets(lock, "piper", "darwin-arm64");
  assert.equal(resolved.repo, "rhasspy/piper");
  assert.equal(resolved.tag, "2023.11.14-2");
  assert.equal(resolved.asset.name, "piper_macos_aarch64.tar.gz");
  assert.deepEqual(
    resolved.extras.map((extra) => extra.name),
    ["espeak-ng-data.tar.bz2", "piper-phonemize_macos_aarch64.tar.gz"],
  );
  assert.equal(resolveComponentAssets(lock, "piper", "linux-x64"), null);
  assert.throws(() => resolveComponentAssets(lock, "node", "darwin-arm64"), /not a release-asset/);
  assert.throws(() => resolveComponentAssets(lock, "ghost", "darwin-arm64"), /not a release-asset/);
}

// --- CLI seam ---

{
  const script = path.join(root, "scripts", "sidecar-lock.mjs");
  const digestRun = spawnSync(process.execPath, [script, "--digest"], { encoding: "utf8" });
  assert.equal(digestRun.status, 0, digestRun.stderr);
  assert.match(digestRun.stdout.trim(), /^[0-9a-f]{64}$/);

  const shRun = spawnSync(process.execPath, [script, "--sh", "kokoro", "darwin-arm64"], {
    encoding: "utf8",
  });
  assert.equal(shRun.status, 0, shRun.stderr);
  assert.match(shRun.stdout, /^LOCK_REPO='k2-fsa\/sherpa-onnx'$/m);
  assert.match(shRun.stdout, /^LOCK_TAG='v1\.13\.4'$/m);
  assert.match(shRun.stdout, /^LOCK_ASSET='sherpa-onnx-v1\.13\.4-osx-arm64-shared\.tar\.bz2'$/m);
  assert.match(shRun.stdout, /^LOCK_EXTRA_1_ASSET='espeak-ng-data\.tar\.bz2'$/m);
  assert.match(shRun.stdout, /^LOCK_EXTRA_1_TAG='tts-models'$/m);
  assert.match(shRun.stdout, /^LOCK_EXTRA_COUNT='1'$/m);

  const missingTarget = spawnSync(process.execPath, [script, "--sh", "whisper", "darwin-arm64"], {
    encoding: "utf8",
  });
  assert.equal(missingTarget.status, 1);
  assert.match(missingTarget.stderr, /no whisper asset pinned for darwin-arm64/);

  const badUsage = spawnSync(process.execPath, [script, "--sh"], { encoding: "utf8" });
  assert.equal(badUsage.status, 2);
}

console.log("sidecar-lock tests passed");
