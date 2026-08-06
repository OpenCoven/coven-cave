#!/usr/bin/env node
// cave-ef6f: one-command release stamp.
//
//   node scripts/stamp-release.mjs [--level patch|minor|major] [--version X.Y.Z]
//                                  [--dry-run] [--no-pr]
//
// Hand-rolled stamps produced three PR collisions between concurrent sessions
// on 2026-07-08 alone, and every cut re-derives the same version
// locations by hand. This script:
//   1. REFUSES when another stamp PR is already open (the collision guard);
//   2. bumps the five version locations (package.json, tauri.conf.json,
//      Cargo.toml, Cargo.lock's `app` package, apps/ios/CovenCave/project.yml —
//      whose iOS entry carries BOTH the marketing version and the
//      CURRENT_PROJECT_VERSION build stamp, see nextIosBuildStamp);
//   3. drafts the CHANGELOG section from `git log v<prev>..HEAD` subjects —
//      a starting point to edit in the PR, not prose to trust blindly;
//   4. branches, commits SIGNED (-S), pushes, and opens the PR via the REST
//      API (survives exhausted GraphQL quota).
//
// `--dry-run` prints the plan (new version, per-file replacement counts, the
// changelog draft) and writes nothing. Pure helpers are exported for tests.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  readCanonicalYamlStringSetting,
  replaceCanonicalYamlStringSetting,
} from "./release-yaml-settings.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const IOS_MARKETING_VERSION_PATH = ["settings", "base", "MARKETING_VERSION"];
const IOS_BUILD_VERSION_PATH = ["settings", "base", "CURRENT_PROJECT_VERSION"];

// ── pure helpers (exported for scripts/stamp-release.test.mjs) ───────────────

export function bumpVersion(current, level = "patch") {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current.trim());
  if (!m) throw new Error(`unparseable current version: "${current}"`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  if (level === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`unknown bump level: "${level}"`);
}

/** The iOS CFBundleVersion stamp: a YYYYMMDDHH instant in UTC.
 *
 * App Store Connect requires CFBundleVersion to be unique and strictly
 * increasing per app, and a stamp left at its previous value rejects the
 * upload — which is exactly what happened to v0.2.3 on 2026-08-03, because the
 * release stamp bumped MARKETING_VERSION and left this one behind. The date
 * shape is monotonic without anyone tracking the last uploaded value; the
 * `current` guard covers the one case it isn't (two cuts in the same UTC hour,
 * or a clock that went backwards), by stepping one past what the file holds.
 */
export function nextIosBuildStamp(current, date = new Date()) {
  const format = (utcMs) => {
    const d = new Date(utcMs);
    const pad = (n, width) => String(n).padStart(width, "0");
    return (
      `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1, 2)}` +
      `${pad(d.getUTCDate(), 2)}${pad(d.getUTCHours(), 2)}`
    );
  };
  const nowMs = date.getTime();
  if (!Number.isFinite(nowMs)) throw new Error("iOS build stamp needs a valid date");
  const stamp = format(nowMs);
  if (!/^\d{10}$/.test(stamp)) {
    throw new Error(`unusable iOS build stamp for ${date.toISOString()}: "${stamp}"`);
  }
  // Same-hour re-cut (or a clock that stepped backwards): advance a whole UTC
  // hour off the recorded stamp rather than adding 1 to the integer, so the
  // result stays a well-formed YYYYMMDDHH instant instead of an hour "24".
  if (typeof current === "string" && /^\d{10}$/.test(current) && current >= stamp) {
    const [y, m, d, h] = [
      Number(current.slice(0, 4)),
      Number(current.slice(4, 6)),
      Number(current.slice(6, 8)),
      Number(current.slice(8, 10)),
    ];
    return format(Date.UTC(y, m - 1, d, h + 1));
  }
  return stamp;
}

/** The five stamp locations and how each encodes the version. */
export const STAMP_FILES = [
  { path: "package.json", kind: "json-version" },
  { path: "src-tauri/tauri.conf.json", kind: "json-version" },
  { path: "src-tauri/Cargo.toml", kind: "toml-version" },
  { path: "src-tauri/Cargo.lock", kind: "cargo-lock-app" },
  { path: "apps/ios/CovenCave/project.yml", kind: "yaml-ios-versions" },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace the version in one file's content; returns {content, replaced}.
 *  Every kind is scoped so an unrelated dependency at the same version can
 *  never be rewritten (the Cargo.lock hazard). */
export function stampContent(kind, content, oldVersion, newVersion) {
  const old = escapeRe(oldVersion);
  let replaced = 0;
  // The counting wrapper is a replacer FUNCTION, so `$1`-style strings would
  // be inserted literally — always rebuild from the captured groups.
  const sub = (re) => {
    content = content.replace(re, (_, before, after) => {
      replaced++;
      return `${before}${newVersion}${after}`;
    });
  };
  switch (kind) {
    case "json-version":
      sub(new RegExp(`("version":\\s*")${old}(")`));
      break;
    case "toml-version":
      sub(new RegExp(`(^version = ")${old}(")`, "m"));
      break;
    case "cargo-lock-app":
      sub(new RegExp(`(name = "app"\\nversion = ")${old}(")`));
      break;
    default:
      throw new Error(`unknown stamp kind: "${kind}"`);
  }
  return { content, replaced };
}

export function applyReplacement(
  kind,
  contents,
  nextVersion,
  relativePath = "<unknown>",
  now = new Date(),
) {
  if (kind === "yaml-ios-versions") {
    const stamped = replaceCanonicalYamlStringSetting(
      contents,
      IOS_MARKETING_VERSION_PATH,
      nextVersion,
      relativePath,
    );
    const currentBuild = readCanonicalYamlStringSetting(
      stamped,
      IOS_BUILD_VERSION_PATH,
      relativePath,
    );
    return replaceCanonicalYamlStringSetting(
      stamped,
      IOS_BUILD_VERSION_PATH,
      nextIosBuildStamp(currentBuild, now),
      relativePath,
    );
  }

  throw new Error(`unknown replacement kind: "${kind}"`);
}

/** Keep-a-Changelog section drafted from commit subjects since the last tag. */
export function buildChangelogSection({ version, prevVersion, dateIso, subjects }) {
  const bullets = subjects
    .filter((s) => s.trim() && !/^chore\(release\): stamp v/.test(s))
    .map((s) => `- ${s}`);
  return [
    `## [${version}] - ${dateIso}`,
    "",
    "> _One-line teaser — edit before merge._",
    "",
    `Patch release on top of v${prevVersion}.`,
    "",
    "### Changes",
    ...(bullets.length ? bullets : ["- _No commits since the previous tag?_"]),
    "",
  ].join("\n");
}

export function insertChangelogSection(changelog, section) {
  const anchor = "## [Unreleased]";
  const at = changelog.indexOf(anchor);
  if (at === -1) throw new Error(`CHANGELOG.md has no "${anchor}" anchor`);
  const after = at + anchor.length;
  return `${changelog.slice(0, after)}\n\n${section.trimEnd()}\n${changelog.slice(after)}`;
}

/** The collision guard: any open PR already stamping a release. */
export function findOpenStampPr(pulls) {
  return (
    pulls.find((p) => typeof p?.title === "string" && /^chore\(release\): stamp v/.test(p.title)) ??
    null
  );
}

// ── main ──────────────────────────────────────────────────────────────────────

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", ...opts }).trim();

function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => argv.includes(name);
  const value = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const dryRun = flag("--dry-run");
  const noPr = flag("--no-pr");
  const level = value("--level") ?? "patch";

  // Preflight: a dirty tree would fold unrelated edits into the stamp commit
  // (the exact failure mode that motivated per-session worktrees).
  const dirty = run("git", ["status", "--porcelain"]);
  if (dirty && !dryRun) {
    console.error("✗ working tree is dirty — stamp from a clean checkout:\n" + dirty);
    process.exit(1);
  }

  const current = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const next = value("--version") ?? bumpVersion(current, level);
  if (!/^\d+\.\d+\.\d+$/.test(next)) {
    console.error(`✗ refusing non-semver version "${next}"`);
    process.exit(1);
  }

  // Collision guard — three stamp PRs raced on 2026-07-08; never open a second.
  const repo = "OpenCoven/coven-cave";
  const pulls = JSON.parse(run("gh", ["api", `repos/${repo}/pulls?state=open&per_page=50`]));
  const openStamp = findOpenStampPr(pulls);
  if (openStamp) {
    console.error(
      `✗ stamp PR already open: #${openStamp.number} "${openStamp.title}" — land or close it first.`,
    );
    process.exit(1);
  }

  const prevTag = `v${current}`;
  const subjects = run("git", ["log", `${prevTag}..HEAD`, "--no-merges", "--pretty=%s"])
    .split("\n")
    .filter(Boolean);
  // One instant for the whole cut: the CHANGELOG date and the iOS build stamp
  // both derive from it, and two `new Date()` calls either side of a boundary
  // would date the release one day and stamp the build the next.
  const now = new Date();
  const dateIso = now.toISOString().slice(0, 10);
  const section = buildChangelogSection({ version: next, prevVersion: current, dateIso, subjects });

  console.log(`stamp: v${current} → v${next} (${subjects.length} commits since ${prevTag})`);

  const edits = [];
  for (const { path: relativePath, kind } of STAMP_FILES) {
    const abs = path.join(ROOT, relativePath);
    const before = readFileSync(abs, "utf8");
    let content;
    let replaced;
    if (kind === "yaml-ios-versions") {
      content = applyReplacement(kind, before, next, relativePath, now);
      // MARKETING_VERSION + CURRENT_PROJECT_VERSION — App Store Connect
      // rejects an upload whose build stamp did not move.
      replaced = 2;
    } else {
      ({ content, replaced } = stampContent(kind, before, current, next));
      if (replaced === 0) {
        console.error(
          `✗ ${relativePath}: found no "${current}" to stamp (${kind}) — aborting, nothing written`,
        );
        process.exit(1);
      }
    }
    edits.push({ abs, file: relativePath, content, replaced });
  }
  const changelogAbs = path.join(ROOT, "CHANGELOG.md");
  const changelog = insertChangelogSection(readFileSync(changelogAbs, "utf8"), section);

  if (dryRun) {
    for (const e of edits)
      console.log(`  would stamp ${e.file} (${e.replaced} occurrence${e.replaced === 1 ? "" : "s"})`);
    console.log("  would insert CHANGELOG section:\n");
    console.log(section.replace(/^/gm, "    "));
    console.log("\n(dry run — nothing written)");
    return;
  }

  for (const e of edits) writeFileSync(e.abs, e.content);
  writeFileSync(changelogAbs, changelog);
  console.log("✓ five locations stamped + CHANGELOG drafted");

  const branch = `release/stamp-v${next}`;
  run("git", ["checkout", "-b", branch]);
  run("git", ["add", "CHANGELOG.md", ...STAMP_FILES.map((f) => f.path)]);
  // -S: repo rule — every commit lands Verified.
  run("git", [
    "commit",
    "-S",
    "-m",
    `chore(release): stamp v${next}\n\nPatch release on top of v${current}. Bumps all five version locations and\ndrafts the v${next} CHANGELOG entry for the ${subjects.length} commits since ${prevTag}.`,
  ]);
  run("git", ["push", "-u", "origin", branch]);
  console.log(`✓ committed + pushed ${branch}`);

  if (noPr) {
    console.log("(--no-pr: open the PR yourself when ready)");
    return;
  }
  const pr = JSON.parse(
    run("gh", [
      "api",
      `repos/${repo}/pulls`,
      "-X",
      "POST",
      "-f",
      `head=${branch}`,
      "-f",
      "base=main",
      "-f",
      `title=chore(release): stamp v${next}`,
      "-f",
      `body=Stamped by \`scripts/stamp-release.mjs\`. Edit the CHANGELOG teaser/grouping before merge.\n\n\`\`\`\n${section}\n\`\`\``,
    ]),
  );
  console.log(`✓ PR opened: ${pr.html_url}`);
  console.log(`next: merge it, then tag — git tag -s v${next} <squash-sha> && git push origin v${next}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
