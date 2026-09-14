// The version-continuity rule, pinned against the incident that produced it.
//
// On 2026-09-14 the repository was stamped 0.4.4 while the newest published
// release was 0.4.1: v0.4.2 and v0.4.3 had been tagged, had their release runs
// cancelled, and were never published. Each stamp looked right because it only
// compared itself to the previous TAG. The first test below is that exact
// state, and it must fail.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import { continuityFailure, parseVersion, successorsOf } from "./check-version-continuity.mjs";

test("the incident state is refused", () => {
  const failure = continuityFailure("0.4.1", "0.4.4");
  assert.ok(failure, "0.4.1 published with a 0.4.4 stamp must not pass");
  assert.match(failure, /skips past/);
  // The message has to name the way out, or it just blocks the release.
  assert.match(failure, /0\.4\.2, 0\.5\.0, 1\.0\.0/, "it names the allowed next versions");
  assert.match(failure, /tag records an intention/, "and why a tag is not evidence of a release");
});

test("the correction passes", () => {
  assert.equal(continuityFailure("0.4.1", "0.4.2"), null);
});

test("each of the three legal steps is allowed, and nothing else", () => {
  for (const next of ["0.4.2", "0.5.0", "1.0.0"]) {
    assert.equal(continuityFailure("0.4.1", next), null, `${next} follows 0.4.1`);
  }
  for (const next of ["0.4.3", "0.6.0", "2.0.0", "1.1.0", "0.5.1"]) {
    assert.ok(continuityFailure("0.4.1", next), `${next} does not follow 0.4.1`);
  }
});

test("a minor or major bump must reset what is below it", () => {
  assert.ok(continuityFailure("0.4.1", "0.5.1"), "0.5.1 keeps a patch it should have reset");
  assert.ok(continuityFailure("0.4.1", "1.0.1"), "1.0.1 keeps a patch it should have reset");
  assert.ok(continuityFailure("0.4.1", "1.4.0"), "1.4.0 keeps a minor it should have reset");
  assert.equal(continuityFailure("0.4.1", "0.5.0"), null);
  assert.equal(continuityFailure("0.4.1", "1.0.0"), null);
});

test("re-releasing a published version is refused, and says why", () => {
  const failure = continuityFailure("0.4.1", "0.4.1");
  assert.ok(failure);
  assert.match(failure, /already published/);
  // Re-releasing is worse than skipping: it changes what an already-installed
  // copy of that number means.
  assert.match(failure, /installed copy/);
});

test("going backwards is refused", () => {
  const failure = continuityFailure("0.4.1", "0.3.9");
  assert.ok(failure);
  assert.match(failure, /older than/);
});

test("a version that is not plain semver is rejected rather than guessed at", () => {
  for (const bad of ["v0.4.2", "0.4", "0.4.2-rc.1", "", "next", "0.4.2.1"]) {
    assert.throws(() => parseVersion(bad), /not a plain semver/, `rejects ${JSON.stringify(bad)}`);
  }
  // A candidate tag is deliberately not a release version: rc tags never
  // publish, so admitting one here would reopen the hole this check closes.
  assert.throws(() => continuityFailure("0.4.1", "0.4.2-rc.1"), /not a plain semver/);
});

test("successorsOf is exactly three options", () => {
  const next = successorsOf(parseVersion("2.7.3"));
  assert.deepEqual(
    next.map((v) => `${v.major}.${v.minor}.${v.patch}`),
    ["2.7.4", "2.8.0", "3.0.0"],
  );
});

test("the check refuses to guess when it cannot see published releases", () => {
  // A continuity check that silently passes when `gh` is unavailable is the
  // same hole in a different shape, so the failure path must exit non-zero.
  const source = readFileSync(new URL("./check-version-continuity.mjs", import.meta.url), "utf8");
  assert.match(
    source,
    /will not assume a\s+\/\/?\s*value it cannot see|not assume a[\s\S]{0,40}value it cannot see/,
    "the gh failure path explains that it will not assume a value",
  );
  assert.doesNotMatch(
    source,
    /catch\s*\([^)]*\)\s*\{\s*(return|process\.exit\(0\))/,
    "no swallow-and-pass path",
  );
});

test("it compares against published releases, not tags", () => {
  const source = readFileSync(new URL("./check-version-continuity.mjs", import.meta.url), "utf8");
  // The whole point: `gh release list`, filtered to real releases.
  assert.match(source, /gh".*release".*list|"release", "list"/s, "asks gh for releases");
  assert.match(source, /isDraft/, "excludes drafts");
  assert.match(source, /isPrerelease/, "excludes prereleases — rc tags never published");
  assert.doesNotMatch(source, /git.*tag.*--list|for-each-ref/, "never derives the floor from tags");
});

console.log("check-version-continuity.test.mjs OK");
