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

function render(version, previous) {
  const args = previous ? [version, previous] : [version];
  return execFileSync(SCRIPT, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
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
