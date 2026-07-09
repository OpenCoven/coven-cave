#!/usr/bin/env node
// cave-ef6f: one-command release stamp.
//
//   node scripts/stamp-release.mjs [--level patch|minor|major] [--version X.Y.Z]
//                                  [--dry-run] [--no-pr]
//
// Hand-rolled stamps produced three PR collisions between concurrent sessions
// on 2026-07-08 alone, and every cut re-derives the same six version
// locations by hand. This script:
//   1. REFUSES when another stamp PR is already open (the collision guard);
//   2. bumps the six version locations (package.json, tauri.conf.json,
//      Cargo.toml, Cargo.lock's `app` package, both iOS Info.plists);
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

const ROOT = path.resolve(import.meta.dirname, "..");

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

/** The six stamp locations and how each encodes the version. */
export const STAMP_FILES = [
  { file: "package.json", kind: "json-version" },
  { file: "src-tauri/tauri.conf.json", kind: "json-version" },
  { file: "src-tauri/Cargo.toml", kind: "toml-version" },
  { file: "src-tauri/Cargo.lock", kind: "cargo-lock-app" },
  { file: "src-tauri/Info.ios.plist", kind: "plist-string" },
  { file: "src-tauri/gen/apple/app_iOS/Info.plist", kind: "plist-string" },
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
    case "plist-string":
      sub(new RegExp(`(<string>)${old}(</string>)`, "g"));
      break;
    default:
      throw new Error(`unknown stamp kind: "${kind}"`);
  }
  return { content, replaced };
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
  const dateIso = new Date().toISOString().slice(0, 10);
  const section = buildChangelogSection({ version: next, prevVersion: current, dateIso, subjects });

  console.log(`stamp: v${current} → v${next} (${subjects.length} commits since ${prevTag})`);

  const edits = [];
  for (const { file, kind } of STAMP_FILES) {
    const abs = path.join(ROOT, file);
    const before = readFileSync(abs, "utf8");
    const { content, replaced } = stampContent(kind, before, current, next);
    if (replaced === 0) {
      console.error(`✗ ${file}: found no "${current}" to stamp (${kind}) — aborting, nothing written`);
      process.exit(1);
    }
    edits.push({ abs, file, content, replaced });
  }
  const changelogAbs = path.join(ROOT, "CHANGELOG.md");
  const changelog = insertChangelogSection(readFileSync(changelogAbs, "utf8"), section);

  if (dryRun) {
    for (const e of edits) console.log(`  would stamp ${e.file} (${e.replaced} occurrence${e.replaced === 1 ? "" : "s"})`);
    console.log("  would insert CHANGELOG section:\n");
    console.log(section.replace(/^/gm, "    "));
    console.log("\n(dry run — nothing written)");
    return;
  }

  for (const e of edits) writeFileSync(e.abs, e.content);
  writeFileSync(changelogAbs, changelog);
  console.log("✓ six locations stamped + CHANGELOG drafted");

  const branch = `release/stamp-v${next}`;
  run("git", ["checkout", "-b", branch]);
  run("git", ["add", "CHANGELOG.md", ...STAMP_FILES.map((f) => f.file)]);
  // -S: repo rule — every commit lands Verified.
  run("git", ["commit", "-S", "-m", `chore(release): stamp v${next}\n\nPatch release on top of v${current}. Bumps all six version locations and\ndrafts the v${next} CHANGELOG entry for the ${subjects.length} commits since ${prevTag}.`]);
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
