// Packaging contract for the signed cross-platform desktop release (cave-gcb0i).
//
// The acceptance criteria for the release lane are properties of what gets
// PACKAGED and of who can reach the signing credentials. Neither is observable
// from a green build: a shell grant added to a capability compiles fine, and a
// signing secret exposed to PR CI is invisible until it leaks. These assertions
// make both fail on the PR that introduces them.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const releaseWorkflow = read("../.github/workflows/release.yml");
const ciWorkflow = read("../.github/workflows/ci.yml");
const cargoToml = read("../src-tauri/Cargo.toml");
const capabilitiesDir = fileURLToPath(new URL("../src-tauri/capabilities/", import.meta.url));

function jobBody(workflow, name) {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${name}:`);
  assert.notEqual(start, -1, `the workflow must define the ${name} job`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

// ── "No shell or arbitrary-filesystem grant is packaged" ───────────────
// Enforced at both layers, because either one alone is escapable: a capability
// can name a permission the plugin never registered, and a linked plugin with
// no capability today is one JSON edit away from being reachable.
test("no packaged capability grants the shell or filesystem plugin", () => {
  const offenders = [];
  for (const file of readdirSync(capabilitiesDir).filter((name) => name.endsWith(".json"))) {
    const capability = JSON.parse(readFileSync(capabilitiesDir + file, "utf8"));
    for (const entry of capability.permissions ?? []) {
      const identifier = typeof entry === "string" ? entry : entry.identifier;
      if (/^(shell|fs):/.test(identifier ?? "")) offenders.push(`${file}: ${identifier}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "the desktop bundle must ship no shell-execution or arbitrary-filesystem grant",
  );
});

test("the shell and filesystem plugins are not compiled into the desktop app", () => {
  assert.doesNotMatch(cargoToml, /^tauri-plugin-shell\b/m);
  assert.doesNotMatch(cargoToml, /^tauri-plugin-fs\b/m);
});

// ── "Signing/updater credentials are available only to approved release jobs" ──
const SIGNING_SECRETS = [
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "APPLE_SIGNING_IDENTITY",
  "APPLE_API_KEY_BASE64",
  "APPLE_PASSWORD",
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
];

test("no signing or updater credential is reachable from PR CI", () => {
  for (const secret of SIGNING_SECRETS) {
    assert.doesNotMatch(
      ciWorkflow,
      new RegExp(`secrets\\.${secret}\\b`),
      `${secret} must never be exposed to the pull-request workflow`,
    );
  }
});

test("the updater signing key is only ever read by the release workflow", () => {
  // A signing key referenced from a job that publishes nothing is a key with
  // no reason to be decrypted there, so pin the set of jobs allowed to see it.
  const signingJobs = new Set();
  let currentJob = null;
  for (const line of releaseWorkflow.split(/\r?\n/)) {
    const jobMatch = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (jobMatch) currentJob = jobMatch[1];
    if (/secrets\.TAURI_SIGNING_PRIVATE_KEY\b/.test(line) && currentJob) signingJobs.add(currentJob);
  }
  assert.deepEqual([...signingJobs].sort(), ["build"]);
});

// ── Updater manifest is verified before it is published ────────────────
test("the updater manifest is signature-verified before it reaches the release", () => {
  const job = jobBody(releaseWorkflow, "updater-manifest");
  const verifyAt = job.indexOf("scripts/verify-release-updater.mjs");
  const uploadAt = job.indexOf("gh release upload \"$RELEASE_TAG\" latest.json");
  assert.notEqual(verifyAt, -1, "updater-manifest must run the updater verification script");
  assert.notEqual(uploadAt, -1, "updater-manifest must upload latest.json");
  assert.ok(
    verifyAt < uploadAt,
    "verification must run BEFORE the upload so an unverifiable manifest is never published",
  );
  assert.match(job, /--manifest latest\.json/, "the just-generated manifest is what gets verified");
  assert.match(
    job,
    /--tag "\$RELEASE_TAG"/,
    "version drift is measured against the tag being released, not /releases/latest",
  );
});

// ── The gate must stay able to fail ────────────────────────────────────
// The bug this PR removed was a verification that exited 0 without looking.
// `continue-on-error` or a step-level `if:` would reintroduce it in one line,
// and the step would still appear in the job — so assert the step's own body,
// not merely its presence.
test("the verify step cannot be neutered by continue-on-error or a step condition", () => {
  const job = jobBody(releaseWorkflow, "updater-manifest");
  const lines = job.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*- name: Verify updater signatures/.test(line));
  assert.notEqual(start, -1, "the verify step must exist and keep a recognisable name");

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {6}- (name|uses):/.test(lines[index])) {
      end = index;
      break;
    }
  }
  const step = lines.slice(start, end).join("\n");

  assert.doesNotMatch(step, /continue-on-error/, "a failed verification must fail the job");
  assert.doesNotMatch(step, /^\s{8}if:/m, "the verification must not be skippable by condition");
  assert.match(step, /set -euo pipefail/, "the shell must abort on the verifier's non-zero exit");
});

// ── Target parity between the generator and the verifier ───────────────
test("every platform the manifest generator emits is a platform the verifier checks", () => {
  const generator = read("./generate-latest-json.mjs");
  const emitted = [...generator.matchAll(/^\s*add\(\s*"([a-z0-9_-]+)"/gm)].map((m) => m[1]);
  const verified = [...read("./verify-release-updater.mjs").matchAll(/"((?:darwin|linux|windows)-[a-z0-9_]+)"/g)]
    .map((m) => m[1]);
  assert.ok(emitted.length > 0, "the generator must declare its platform keys via add()");
  for (const key of emitted) {
    assert.ok(
      verified.includes(key),
      `${key} is published in latest.json but absent from the verifier's TARGETS, so it would ship unverified`,
    );
  }
});

// ── Checksums cover every installable artifact family ──────────────────
test("SHA256SUMS is published for the macOS, Linux and Windows installers", () => {
  const job = jobBody(releaseWorkflow, "checksums");
  // Anchor to a line that IS the command. Two of this job's three
  // "shasum -a 256" mentions are comments explaining how to verify the file by
  // hand, so a bare /shasum -a 256/ is satisfied by prose: measured by deleting
  // `shasum -a 256 CovenCave* | sort > SHA256SUMS` outright, after which this
  // file stayed green while the release computed no checksums at all.
  assert.match(
    job,
    /^ *shasum -a 256 [^\n#]*> *SHA256SUMS/m,
    "SHA256SUMS must be computed by a real shasum command, not merely mentioned in a comment",
  );
  assert.match(
    job,
    /^ *gh release upload "\$RELEASE_TAG" _release\/SHA256SUMS/m,
    "the computed SHA256SUMS must actually be attached to the release",
  );
  for (const pattern of [/\.dmg/, /\.AppImage/, /\.msi/]) {
    assert.match(job, pattern, `checksums must cover ${pattern.source} artifacts`);
  }
});

console.log("release-packaging-contract.test.mjs: ok");
