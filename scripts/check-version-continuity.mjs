#!/usr/bin/env node
// Refuse a release version that skips past one nobody received.
//
// WHY THIS EXISTS. Between v0.4.1 and 2026-09-14 this repository stamped and
// tagged v0.4.2, v0.4.3 and v0.4.4. None of them published: the first two had
// their release runs cancelled, the third failed its authorization gate. The
// source said 0.4.4, the newest GitHub release said 0.4.1, and every stamp in
// between looked correct because each one only ever compared itself to the
// previous TAG. Three versions existed in the repository that no user could
// install, and the changelog described all three as shipped.
//
// So the comparison here is against PUBLISHED RELEASES, deliberately. A
// tag-based check is the check that already failed — it would have passed on
// all three. A tag records an intention; a release is the only evidence a
// version reached anyone.
//
// The rule: the next version must be exactly one step from the latest
// published release, under semver's own ordering.
//
//   0.4.1 -> 0.4.2   patch + 1
//   0.4.1 -> 0.5.0   minor + 1, patch reset to 0
//   0.4.1 -> 1.0.0   major + 1, minor and patch reset to 0
//
// Anything else is refused, including a version that moves BACKWARDS or
// repeats one already published — re-releasing a number changes what an
// installed copy means, which is worse than skipping one.
//
// Usage:
//   node scripts/check-version-continuity.mjs --version 0.4.2
//   node scripts/check-version-continuity.mjs                  (reads package.json)
//   node scripts/check-version-continuity.mjs --published 0.4.1  (offline)
//
// Without --published it asks `gh` for the newest non-draft, non-prerelease
// release. If `gh` is unavailable it says so and exits non-zero rather than
// guessing: a continuity check that silently skips when it cannot see the
// evidence is the same hole in a different shape.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(raw) {
  const match = SEMVER.exec(String(raw ?? "").trim());
  if (!match) throw new Error(`not a plain semver version: ${JSON.stringify(raw)}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** The three versions that may legally follow `from`. */
export function successorsOf(from) {
  return [
    { major: from.major, minor: from.minor, patch: from.patch + 1 },
    { major: from.major, minor: from.minor + 1, patch: 0 },
    { major: from.major + 1, minor: 0, patch: 0 },
  ];
}

const show = (v) => `${v.major}.${v.minor}.${v.patch}`;

export function continuityFailure(published, next) {
  const from = parseVersion(published);
  const to = parseVersion(next);
  const allowed = successorsOf(from);
  if (allowed.some((candidate) => show(candidate) === show(to))) return null;

  const forward =
    to.major > from.major ||
    (to.major === from.major && to.minor > from.minor) ||
    (to.major === from.major && to.minor === from.minor && to.patch > from.patch);

  if (show(to) === show(from)) {
    return (
      `${show(to)} is already published. Re-releasing a version changes what an ` +
      `installed copy of it means; pick the next one instead.`
    );
  }
  if (!forward) {
    return `${show(to)} is older than the published ${show(from)}. Releases only move forward.`;
  }
  return (
    `${show(to)} skips past the latest published release ${show(from)}. ` +
    `Allowed next versions are ${allowed.map(show).join(", ")}. ` +
    `If a version in between was tagged but never published, release the next ` +
    `number after ${show(from)} rather than inheriting the unpublished stamp — ` +
    `a tag records an intention, a release is what someone received.`
  );
}

export function latestPublishedRelease() {
  let raw;
  try {
    raw = execFileSync(
      "gh",
      ["release", "list", "--limit", "50", "--json", "tagName,isDraft,isPrerelease,publishedAt"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    throw new Error(
      `could not list published releases via gh (${error.message.split("\n")[0]}). ` +
        `Pass --published <version> to check offline; this check will not assume a ` +
        `value it cannot see.`,
    );
  }
  const releases = JSON.parse(raw)
    .filter((entry) => !entry.isDraft && !entry.isPrerelease && entry.publishedAt)
    .map((entry) => ({ ...entry, version: String(entry.tagName).replace(/^v/, "") }))
    .filter((entry) => SEMVER.test(entry.version));
  if (!releases.length) throw new Error("no published semver releases found");

  releases.sort((a, b) => {
    const x = parseVersion(a.version);
    const y = parseVersion(b.version);
    return y.major - x.major || y.minor - x.minor || y.patch - x.patch;
  });
  return releases[0].version;
}

function main(argv) {
  const flag = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const root = flag("--root") ?? process.cwd();
  const next =
    flag("--version") ??
    JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  const published = flag("--published") ?? latestPublishedRelease();

  const failure = continuityFailure(published, next);
  if (failure) {
    console.error(`✗ version continuity: ${failure}`);
    process.exit(1);
  }
  console.log(
    `Verified version continuity: ${published} → ${next} (latest published release → this stamp).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`✗ version continuity: ${error.message}`);
    process.exit(1);
  }
}
