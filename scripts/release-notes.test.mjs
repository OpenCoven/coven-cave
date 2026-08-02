// Tests for scripts/release-notes.sh — the renderer that writes every
// user-facing GitHub release body.
//
// These used to read this checkout's own tags and CHANGELOG, which meant they
// could not run against CI's shallow clone and were allowlisted out of the
// wiring guard (cave-5yyj1). They now build a throwaway git repo per run and
// point the script at it with COVEN_RELEASE_NOTES_ROOT, so they depend on
// nothing outside this file and are wired into the normal suite.
//
// Asserts the script:
//   1. Picks up the CHANGELOG.md section when one exists for the version.
//   2. Renders the arch-split install block above the cutoff.
//   3. Falls back to the legacy single-DMG block below the cutoff.
//   4. Falls back to a git-log commit list when no CHANGELOG entry exists.
//   5. Always ends with a `**Full changelog:**` compare link.
//   6. Emits the cave-yp21x build-provenance block only when guards were skipped.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const SCRIPT = fileURLToPath(new URL("./release-notes.sh", import.meta.url));
const SLUG = "ExampleOrg/example-repo";

/**
 * A throwaway repository carrying the tag history and CHANGELOG the cases need.
 *
 * Commits use a fixed identity and signing is disabled explicitly: a machine
 * with `commit.gpgsign = true` (this repo requires signed commits) would
 * otherwise fail to build the fixture.
 */
function seedRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "release-notes-fixture-"));
  const git = (...args) =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  git("init", "-q", "-b", "main");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  // Point hooks at an empty directory. A machine with a global core.hooksPath
  // or init.templateDir would otherwise fire someone's real hooks against this
  // throwaway repo — a fixture must not run arbitrary local automation just to
  // make five commits. (Guard taken from a parallel session's fixture, which
  // had it and this one did not; see cave-5yyj1.)
  const hooks = path.join(dir, "empty-hooks");
  mkdirSync(hooks, { recursive: true });
  git("config", "core.hooksPath", hooks);

  const commitTag = (tag, subject) => {
    writeFileSync(path.join(dir, `${tag}.txt`), `${tag}\n`);
    git("add", "-A");
    git("commit", "-q", "-m", subject);
    git("tag", tag);
  };

  // Deliberately a major version that does NOT exist in this repository. If
  // COVEN_RELEASE_NOTES_ROOT ever stops taking effect, tag auto-detection finds
  // no v7.* tags and these cases fail loudly instead of quietly passing against
  // the real checkout's history.
  // Pre-CHANGELOG history, below the arch-split cutoff (patch < 54, minor 0).
  commitTag("v7.0.41", "fix: earliest fixture commit");
  commitTag("v7.0.42", "fix: teach the widget to widget");
  // Straddle the cutoff, then the versions that DO have CHANGELOG sections.
  commitTag("v7.0.50", "feat: fixture midpoint");
  commitTag("v7.0.54", "feat: arch-split DMGs");
  commitTag("v7.0.55", "feat: fixture head");

  // Only 7.0.55 and 7.0.50 get sections, so 7.0.42 must hit the git-log
  // fallback — the branch that needed live history in the first place.
  writeFileSync(
    path.join(dir, "CHANGELOG.md"),
    [
      "# Changelog",
      "",
      "## [7.0.55]",
      "",
      "- Loopback-tolerant referer check",
      "- A second bullet so the section is unambiguous",
      "",
      "## [7.0.50]",
      "",
      "- The midpoint entry",
      "",
    ].join("\n"),
  );
  return dir;
}

const REPO_DIR = seedRepo();
test.after(() => rmSync(REPO_DIR, { recursive: true, force: true }));

function render(version, previous, env) {
  const args = previous ? [version, previous] : [version];
  return execFileSync(SCRIPT, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      COVEN_RELEASE_NOTES_ROOT: REPO_DIR,
      COVEN_REPO_SLUG: SLUG,
      ...(env ?? {}),
    },
  });
}

test("a version with a CHANGELOG section renders it under the standard heading", () => {
  const body = render("v7.0.55");
  assert.match(body, /^## What's new in v7\.0\.55/m, "starts with the standard heading");
  assert.match(body, /Loopback-tolerant referer check/, "includes the section's bullet");
});

test("v7.0.54+ renders the arch-split install block and not the legacy DMG", () => {
  const body = render("v7.0.55");
  assert.match(body, /CovenCave-v7\.0\.55-aarch64\.dmg/, "lists the aarch64 DMG");
  assert.match(body, /CovenCave-v7\.0\.55-x86_64\.dmg/, "lists the x86_64 DMG");
  assert.doesNotMatch(
    body,
    /CovenCave-v7\.0\.55\.dmg(?!-)/,
    "must not also list the legacy un-suffixed DMG",
  );
});

test("pre-v7.0.54 versions render the legacy single-DMG install block", () => {
  const body = render("v7.0.42");
  assert.match(
    body,
    new RegExp(
      `download \\[\`CovenCave-v7\\.0\\.42\\.dmg\`\\]\\(https://github\\.com/${SLUG}/releases/download/v7\\.0\\.42/CovenCave-v7\\.0\\.42\\.dmg\\)`,
    ),
    "legacy install block lists the un-suffixed DMG",
  );
  assert.doesNotMatch(body, /aarch64\.dmg|x86_64\.dmg/, "legacy block mentions no arch DMGs");
});

test("versions without a CHANGELOG entry fall back to a git-log bullet list", () => {
  // 7.0.42 has no CHANGELOG section in the fixture, so this takes the fallback
  // branch — the one that reads real commits between two tags.
  const body = render("v7.0.42", "v7.0.41");
  assert.match(body, /Commits since \[`v7\.0\.41`\]/, "fallback cites the previous tag");
  assert.match(body, /^- /m, "fallback emits at least one bullet");
  assert.match(body, /teach the widget to widget/, "the bullet is a real commit subject");
});

test("the compare link uses the auto-detected previous tag", () => {
  assert.match(
    render("v7.0.55"),
    new RegExp(
      `\\*\\*Full changelog:\\*\\* https://github\\.com/${SLUG}/compare/v7\\.0\\.54\\.\\.\\.v7\\.0\\.55`,
    ),
    "auto-detection picks the immediately preceding tag",
  );
});

test("an explicit previous-tag argument overrides auto-detection", () => {
  assert.match(render("v7.0.55", "v7.0.50"), /compare\/v7\.0\.50\.\.\.v7\.0\.55/);
});

test("every rendered body ends with the checksum block and the compare link", () => {
  for (const v of ["v7.0.55", "v7.0.42"]) {
    const body = render(v);
    assert.match(body, /shasum -a 256 -c SHA256SUMS/, `${v} has the verify-checksums block`);
    assert.match(
      body.trimEnd().split("\n").at(-1) ?? "",
      /^\*\*Full changelog:\*\*/,
      `${v} ends with the compare link`,
    );
  }
});

// ── Build provenance when the registry guards were skipped (cave-yp21x) ─────
// v0.2.0 shipped through the emergency manual hatch with BOTH signed-registry
// gates skipped, and the only evidence was a `skipped` step in the Actions
// log — invisible to anyone reading the release. The body now says so.

test("the provenance block appears only when the guards were actually skipped", () => {
  const skipped = render("v7.0.55", undefined, { COVEN_RELEASE_REGISTRY_GUARDS_SKIPPED: "true" });
  assert.match(skipped, /^## Build provenance/m, "a skipped-guard build states its provenance");
  assert.match(skipped, /allow_unconfigured_registries/, "names the flag that caused it");
  assert.match(skipped, /built-in baseline schema parsers/, "says what it used instead");
  assert.match(skipped, /tag push cannot skip/, "says the normal path is still fail-closed");

  assert.doesNotMatch(render("v7.0.55"), /Build provenance/, "unset flag renders no block");
  assert.doesNotMatch(
    render("v7.0.55", undefined, { COVEN_RELEASE_REGISTRY_GUARDS_SKIPPED: "false" }),
    /Build provenance/,
    "an explicit false renders no block",
  );
  // Only the exact string "true" counts — a truthy-looking value must not arm it.
  assert.doesNotMatch(
    render("v7.0.55", undefined, { COVEN_RELEASE_REGISTRY_GUARDS_SKIPPED: "1" }),
    /Build provenance/,
    "a non-'true' value renders no block",
  );
});

test("the provenance block never displaces the compare link", () => {
  const body = render("v7.0.55", undefined, { COVEN_RELEASE_REGISTRY_GUARDS_SKIPPED: "true" });
  assert.match(body.trimEnd().split("\n").at(-1) ?? "", /^\*\*Full changelog:\*\*/);
});

test("the X recovery override is permanently disclosed in release provenance", () => {
  const skipped = render("v7.0.55", undefined, { COVEN_RELEASE_X_GUARD_SKIPPED: "true" });
  assert.match(skipped, /^## Build provenance/m);
  assert.match(skipped, /allow_unconfigured_x_app/);
  assert.match(skipped, /configuration check was explicitly bypassed/);
  assert.match(skipped, /incomplete X\s+integration remains disabled/);
  assert.doesNotMatch(skipped, /because no production public client ID was configured/);
  assert.match(skipped, /tag push cannot skip the X app configuration check/);
  assert.doesNotMatch(
    render("v7.0.55", undefined, { COVEN_RELEASE_X_GUARD_SKIPPED: "1" }),
    /allow_unconfigured_x_app/,
  );
});

test("the fixture is genuinely self-contained", () => {
  // The point of cave-5yyj1: no assertion above may depend on this checkout's
  // own tags, CHANGELOG, or slug. If the real slug leaks through, the script is
  // reading something other than the fixture and the wiring is a lie.
  const body = render("v7.0.55");
  assert.doesNotMatch(body, /OpenCoven\/coven-cave/, "renders against the fixture, not this repo");
  assert.match(body, new RegExp(SLUG.replace("/", "\\/")), "uses the fixture slug");
});
