// Sanity test for scripts/release-notes.sh. Run with:
//   npx --yes tsx --test scripts/release-notes.test.mjs
//
// Asserts the script:
//   1. Picks up the CHANGELOG.md section when one exists for the version.
//   2. Renders the arch-split install block for v0.0.54+.
//   3. Falls back to the legacy single-DMG install block for pre-v0.0.54.
//   4. Falls back to a git-log commit list when no CHANGELOG entry exists.
//   5. Always ends with a `**Full changelog:**` compare link.
//
// Live git history is needed for the fallback case, so this test is
// expected to run inside the repo's working tree (CI does not execute it
// — see CLAUDE.md / auto-memory reference_test_runner).

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const SCRIPT = fileURLToPath(new URL("./release-notes.sh", import.meta.url));
const REPO_ROOT = path.dirname(path.dirname(SCRIPT));

function render(version, previous, env) {
  const args = previous ? [version, previous] : [version];
  return execFileSync(SCRIPT, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...(env ?? {}) },
  });
}

test("v0.0.55 pulls its CHANGELOG section and renders the arch-split install block", () => {
  const body = render("v0.0.55");
  assert.match(body, /^## What's new in v0\.0\.55/m, "starts with the standard heading");
  assert.match(
    body,
    /Loopback-tolerant referer check/,
    "includes the CHANGELOG bullet for the loopback-tolerant fix",
  );
  assert.match(
    body,
    /CovenCave-v0\.0\.55-aarch64\.dmg/,
    "arch-split install block lists the aarch64 DMG",
  );
  assert.match(
    body,
    /CovenCave-v0\.0\.55-x86_64\.dmg/,
    "arch-split install block lists the x86_64 DMG",
  );
  assert.doesNotMatch(
    body,
    /CovenCave-v0\.0\.55\.dmg(?!-)/,
    "arch-split block must not also list the legacy un-suffixed DMG",
  );
  assert.match(
    body,
    /\*\*Full changelog:\*\* https:\/\/github\.com\/OpenCoven\/coven-cave\/compare\/v0\.0\.54\.\.\.v0\.0\.55/,
    "trailing compare link uses the auto-detected previous tag",
  );
});

test("pre-v0.0.54 versions render the legacy single-DMG install block", () => {
  const body = render("v0.0.42");
  assert.match(
    body,
    /download \[`CovenCave-v0\.0\.42\.dmg`\]\(https:\/\/github\.com\/OpenCoven\/coven-cave\/releases\/download\/v0\.0\.42\/CovenCave-v0\.0\.42\.dmg\)/,
    "legacy install block lists the un-suffixed DMG",
  );
  assert.doesNotMatch(
    body,
    /aarch64\.dmg|x86_64\.dmg/,
    "legacy block must not mention arch-suffixed DMGs",
  );
});

test("versions without a CHANGELOG entry fall back to a git-log bullet list", () => {
  // v0.0.42 is below the CHANGELOG cutoff (which starts at 0.0.50) so it
  // must hit the fallback branch.
  const body = render("v0.0.42", "v0.0.41");
  assert.match(
    body,
    /Commits since \[`v0\.0\.41`\]/,
    "fallback bullet list cites the previous tag",
  );
  assert.match(body, /^- /m, "fallback emits at least one `- ` bullet");
});

test("an explicit previous-tag argument overrides auto-detection", () => {
  const body = render("v0.0.55", "v0.0.50");
  assert.match(
    body,
    /compare\/v0\.0\.50\.\.\.v0\.0\.55/,
    "compare link respects the explicit previous tag",
  );
});

test("every rendered body ends with the standardized checksum + changelog footer", () => {
  for (const v of ["v0.0.55", "v0.0.42"]) {
    const body = render(v);
    assert.match(body, /shasum -a 256 -c SHA256SUMS/, `${v} body has the verify-checksums block`);
    assert.match(body, /\*\*Full changelog:\*\*/, `${v} body has the compare link`);
  }
});

// ── Build provenance when the registry guards were skipped (cave-yp21x) ─────
// v0.2.0 shipped through the emergency manual hatch with BOTH signed-registry
// gates skipped, and the only evidence was a `skipped` step in the Actions
// log — invisible to anyone reading the release. The body now says so.

test("the provenance block appears only when the guards were actually skipped", () => {
  const skipped = render("v0.0.55", undefined, { COVEN_RELEASE_REGISTRY_GUARDS_SKIPPED: "true" });
  assert.match(skipped, /^## Build provenance/m, "a skipped-guard build states its provenance");
  assert.match(skipped, /allow_unconfigured_registries/, "names the flag that caused it");
  assert.match(skipped, /built-in baseline schema parsers/, "says what it used instead");
  assert.match(skipped, /tag push cannot skip/, "says the normal path is still fail-closed");

  // The default release path must stay unchanged — an unset or false flag adds
  // nothing, so ordinary releases read exactly as before.
  assert.doesNotMatch(render("v0.0.55"), /Build provenance/, "unset flag renders no block");
  assert.doesNotMatch(
    render("v0.0.55", undefined, { COVEN_RELEASE_REGISTRY_GUARDS_SKIPPED: "false" }),
    /Build provenance/,
    "an explicit false renders no block",
  );
  // Only the exact string "true" counts — a truthy-looking value must not arm it.
  assert.doesNotMatch(
    render("v0.0.55", undefined, { COVEN_RELEASE_REGISTRY_GUARDS_SKIPPED: "1" }),
    /Build provenance/,
    "a non-'true' value renders no block",
  );
});

test("the provenance block never displaces the compare link", () => {
  // The body's contract is that it ends with the changelog link; a section
  // appended in the wrong place would bury it.
  const body = render("v0.0.55", undefined, { COVEN_RELEASE_REGISTRY_GUARDS_SKIPPED: "true" });
  assert.match(body.trimEnd().split("\n").at(-1) ?? "", /^\*\*Full changelog:\*\*/);
});
