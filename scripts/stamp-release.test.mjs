// @ts-nocheck
// cave-ef6f — stamp-release script + partial updater manifest resilience.
// Pure tests exercise the exported stamp helpers; source pins hold the
// release.yml resilience and the verify script's --allow-partial contract.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  bumpVersion,
  STAMP_FILES,
  applyReplacement,
  stampContent,
  buildChangelogSection,
  insertChangelogSection,
  findOpenStampPr,
} from "./stamp-release.mjs";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const STAMP_RELEASE = fileURLToPath(new URL("./stamp-release.mjs", import.meta.url));
const expectedChangedFiles = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "apps/ios/CovenCave/project.yml",
];

// ── bumpVersion ───────────────────────────────────────────────────────────────
assert.equal(bumpVersion("0.0.159"), "0.0.160");
assert.equal(bumpVersion("0.0.159", "minor"), "0.1.0");
assert.equal(bumpVersion("0.4.9", "major"), "1.0.0");
assert.throws(() => bumpVersion("garbage"), /unparseable/);
assert.throws(() => bumpVersion("1.2.3", "mega"), /unknown bump level/);

// ── stampContent: each kind scoped so nothing unrelated rewrites ──────────────
{
  const { content, replaced } = stampContent(
    "json-version",
    `{\n  "name": "coven-cave",\n  "version": "0.0.159",\n  "dep": { "version": "0.0.159" }\n}`,
    "0.0.159",
    "0.0.160",
  );
  assert.equal(replaced, 1, "json stamps only the first version field");
  assert.match(content, /"version": "0\.0\.160"/);
  assert.match(content, /"dep": \{ "version": "0\.0\.159" \}/, "nested same-version field untouched");
}
{
  const lock = `[[package]]\nname = "aho-corasick"\nversion = "0.0.159"\n\n[[package]]\nname = "app"\nversion = "0.0.159"\n`;
  const { content, replaced } = stampContent("cargo-lock-app", lock, "0.0.159", "0.0.160");
  assert.equal(replaced, 1, "only the app package block is stamped");
  assert.match(content, /name = "aho-corasick"\nversion = "0\.0\.159"/, "same-version dependency untouched");
  assert.match(content, /name = "app"\nversion = "0\.0\.160"/);
}
{
  const { replaced } = stampContent("toml-version", `[package]\nname = "app"\nversion = "0.0.159"\n`, "0.0.159", "0.0.160");
  assert.equal(replaced, 1);
}
{
  assert.equal(
    applyReplacement(
      "yaml-marketing-version",
      [
        "name: CovenCave",
        "settings:",
        "  base:",
        '    MARKETING_VERSION: "0.2.1"',
        '    CURRENT_PROJECT_VERSION: "1"',
        "",
      ].join("\n"),
      "0.2.2",
      "apps/ios/CovenCave/project.yml",
    ),
    [
      "name: CovenCave",
      "settings:",
      "  base:",
      '    MARKETING_VERSION: "0.2.2"',
      '    CURRENT_PROJECT_VERSION: "1"',
      "",
    ].join("\n"),
    "the canonical scalar is replaced without changing quoting, indentation, or the build version",
  );
  for (const [label, source] of [
    [
      "literal block",
      ["settings:", "  base:", "    MARKETING_VERSION: |", "      0.2.1", ""].join("\n"),
    ],
    [
      "folded block",
      ["settings:", "  base:", "    MARKETING_VERSION: >", "      0.2.1", ""].join("\n"),
    ],
  ]) {
    assert.throws(
      () => applyReplacement("yaml-marketing-version", source, "0.2.2", "apps/ios/CovenCave/project.yml"),
      (err) => {
        const message = String(err?.message ?? err);
        assert.match(message, /apps\/ios\/CovenCave\/project\.yml/);
        assert.match(message, /\["settings","base","MARKETING_VERSION"\]/);
        assert.match(message, /single-line|plain or quoted/i);
        assert.doesNotMatch(message, /Unsupported default string type/);
        return true;
      },
      `${label} MARKETING_VERSION should be rejected with an actionable source label`,
    );
  }
  for (const [label, source] of [
    [
      "double-quoted",
      [
        "settings:",
        "  base:",
        '    MARKETING_VERSION: "0.2.\\',
        '      2"',
        "",
      ].join("\n"),
    ],
    [
      "single-quoted",
      [
        "settings:",
        "  base:",
        "    MARKETING_VERSION: '0.2.",
        "      2'",
        "",
      ].join("\n"),
    ],
    [
      "plain",
      ["settings:", "  base:", "    MARKETING_VERSION: 0.2.", "      2", ""].join("\n"),
    ],
  ]) {
    assert.throws(
      () =>
        applyReplacement(
          "yaml-marketing-version",
          source,
          "0.2.2",
          "apps/ios/CovenCave/project.yml",
        ),
      (err) => {
        const message = String(err?.message ?? err);
        assert.match(message, /apps\/ios\/CovenCave\/project\.yml/);
        assert.match(message, /\["settings","base","MARKETING_VERSION"\]/);
        assert.match(message, /single-line/i);
        return true;
      },
      `${label} multiline MARKETING_VERSION should be rejected with a single-line diagnostic`,
    );
  }
  {
    const depth = 11;
    const lines = [
      "settings:",
      "  base:",
      '    MARKETING_VERSION: "0.2.1"',
      "payloads:",
      "  level0: &level0",
      "    marker: true",
    ];
    for (let level = 1; level <= depth; level += 1) {
      lines.push(
        `  level${level}: &level${level}`,
        `    - *level${level - 1}`,
        `    - *level${level - 1}`,
      );
    }
    lines.push(`expanded: *level${depth}`, "");

    assert.throws(
      () =>
        applyReplacement(
          "yaml-marketing-version",
          lines.join("\n"),
          "0.2.2",
          "apps/ios/CovenCave/project.yml",
        ),
      (err) => {
        const message = String(err?.message ?? err);
        assert.match(message, /apps\/ios\/CovenCave\/project\.yml/);
        assert.match(message, /budget|complex/i);
        return true;
      },
      "an acyclic exponentially amplified alias DAG should exceed the YAML traversal budget",
    );
  }
  assert.throws(
    () =>
      applyReplacement(
        "yaml-marketing-version",
        [
          "name: Example",
          "targets:",
          "  Example:",
          "    settings:",
          "      base:",
          '        MARKETING_VERSION: "0.2.1"',
          "",
        ].join("\n"),
        "0.2.2",
        "apps/ios/CovenCave/project.yml",
      ),
    /must define MARKETING_VERSION exactly once.*\["settings","base","MARKETING_VERSION"\].*was also found at \["targets","Example","settings","base","MARKETING_VERSION"\]/,
    "a target-only setting is noncanonical and must not be stamped",
  );
  assert.throws(
    () =>
      applyReplacement(
        "yaml-marketing-version",
        [
          "name: Example",
          "settings:",
          "  base:",
          '    MARKETING_VERSION: "0.2.1"',
          "targets:",
          "  Example:",
          "    settings:",
          "      base:",
          '        MARKETING_VERSION: "9.9.9"',
          "",
        ].join("\n"),
        "0.2.2",
        "apps/ios/CovenCave/project.yml",
      ),
    /must define MARKETING_VERSION exactly once/,
    "a target-level override makes the release setting ambiguous",
  );
  assert.throws(
    () =>
      applyReplacement(
        "yaml-marketing-version",
        ["name: Example", "settings:", "  base:", '    CURRENT_PROJECT_VERSION: "1"', ""].join(
          "\n",
        ),
        "0.2.2",
        "apps/ios/CovenCave/project.yml",
      ),
    /must define MARKETING_VERSION exactly once.*was not found/,
  );
  assert.throws(
    () =>
      applyReplacement(
        "yaml-marketing-version",
        [
          "name: Example",
          "settings:",
          "  base:",
          '    MARKETING_VERSION: "0.2.1"',
          '    MARKETING_VERSION: "0.2.1"',
          "",
        ].join("\n"),
        "0.2.2",
        "apps/ios/CovenCave/project.yml",
      ),
    /Map keys must be unique|exactly once/,
  );
  assert.throws(
    () =>
      applyReplacement(
        "yaml-marketing-version",
        [
          "name: Example",
          "settings:",
          "  base:",
          '    MARKETING_VERSION: "0.2.1"',
          "    MARKETING_VERSION:",
          "",
        ].join("\n"),
        "0.2.2",
        "apps/ios/CovenCave/project.yml",
      ),
    /Map keys must be unique|exactly once/,
  );
  assert.equal(
    STAMP_FILES.find(
      (entry) => entry.path === "apps/ios/CovenCave/project.yml",
    )?.kind,
    "yaml-marketing-version",
  );
}
assert.equal(STAMP_FILES.length, 5, "exactly the five stamp locations");
assert.throws(() => stampContent("nope", "", "a", "b"), /unknown stamp kind/);

// ── dry-run contract ─────────────────────────────────────────────────────────
{
  const fixtures = {
    [path.join(REPO_ROOT, "package.json")]: '{"version":"0.0.159"}\n',
    [path.join(REPO_ROOT, "src-tauri/tauri.conf.json")]:
      '{"package":{"productVersion":"0.0.159"},"version":"0.0.159"}\n',
    [path.join(REPO_ROOT, "src-tauri/Cargo.toml")]: '[package]\nversion = "0.0.159"\n',
    [path.join(REPO_ROOT, "src-tauri/Cargo.lock")]:
      '[[package]]\nname = "app"\nversion = "0.0.159"\n\n[[package]]\nname = "shared"\nversion = "0.0.159"\n',
    [path.join(REPO_ROOT, "apps/ios/CovenCave/project.yml")]:
      'name: CovenCave\nsettings:\n  base:\n    MARKETING_VERSION: "0.0.159"\n    CURRENT_PROJECT_VERSION: "1"\n',
    [path.join(REPO_ROOT, "CHANGELOG.md")]: "# Changelog\n\n## [Unreleased]\n\n## [0.0.159] - 2026-07-08\n",
  };
  const dryRun = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
import { createRequire, syncBuiltinESMExports } from "node:module";
const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const fs = require("node:fs");
const originalReadFileSync = fs.readFileSync.bind(fs);
const fixtures = ${JSON.stringify(fixtures)};
const script = ${JSON.stringify(STAMP_RELEASE)};
childProcess.execFileSync = (cmd, args) => {
  if (cmd === "git" && args[0] === "status" && args[1] === "--porcelain") return "";
  if (cmd === "gh" && args[0] === "api" && String(args[1]).includes("/pulls")) return "[]";
  if (cmd === "git" && args[0] === "log") return "feat(release): polish dry run\\nfix(release): cover files\\n";
  throw new Error(\`unexpected execFileSync: \${cmd} \${args.join(" ")}\`);
};
fs.readFileSync = (file, encoding) => {
  if (encoding !== "utf8") return originalReadFileSync(file, encoding);
  if (Object.prototype.hasOwnProperty.call(fixtures, file)) return fixtures[file];
  if (String(file).includes("/node_modules/")) return originalReadFileSync(file, encoding);
  throw new Error(\`unexpected readFileSync: \${file}\`);
};
fs.writeFileSync = () => {
  throw new Error("dry run must not write");
};
syncBuiltinESMExports();
process.argv = [process.argv[0], script, "--dry-run"];
await import(new URL(script, "file://"));
`,
    ],
    { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  assert.equal(dryRun.status, 0, `dry run failed:\n${dryRun.stderr}\n${dryRun.stdout}`);
  const changedFiles = [...dryRun.stdout.matchAll(/^  would stamp (.+?) \(/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    changedFiles,
    expectedChangedFiles,
    `dry run should report exactly the five stamped manifests:\n${dryRun.stdout}`,
  );
  assert.match(dryRun.stdout, /\(dry run — nothing written\)/, "dry run banner is preserved");
}

// ── changelog ─────────────────────────────────────────────────────────────────
{
  const section = buildChangelogSection({
    version: "0.0.160",
    prevVersion: "0.0.159",
    dateIso: "2026-07-09",
    subjects: ["feat(a): thing (#1)", "chore(release): stamp v0.0.159 (#2797)", "fix(b): other (#2)"],
  });
  assert.match(section, /^## \[0\.0\.160\] - 2026-07-09/, "keep-a-changelog heading");
  assert.match(section, /- feat\(a\): thing \(#1\)/);
  assert.doesNotMatch(section, /stamp v0\.0\.159/, "prior stamp commits filtered from the draft");
  const inserted = insertChangelogSection("# Changelog\n\n## [Unreleased]\n\n## [0.0.159] - 2026-07-08\n", section);
  assert.ok(
    inserted.indexOf("## [Unreleased]") < inserted.indexOf("## [0.0.160]") &&
      inserted.indexOf("## [0.0.160]") < inserted.indexOf("## [0.0.159]"),
    "new section lands between Unreleased and the previous release",
  );
  assert.throws(() => insertChangelogSection("# no anchor here", section), /no "## \[Unreleased\]" anchor/);
}

// ── collision guard ───────────────────────────────────────────────────────────
assert.equal(findOpenStampPr([{ title: "feat: x" }]), null);
assert.equal(findOpenStampPr([{ title: "feat: x" }, { title: "chore(release): stamp v0.0.160", number: 9 }]).number, 9);

// ── release.yml resilience pins ───────────────────────────────────────────────
const yml = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

function workflowJob(source, jobName) {
  const marker = `\n  ${jobName}:\n`;
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${jobName} job must exist`);
  const startIndex = markerIndex + 1;
  const nextJob = /\n  [A-Za-z0-9_-]+:\n/g;
  nextJob.lastIndex = markerIndex + marker.length;
  const nextMatch = nextJob.exec(source);
  return source.slice(startIndex, nextMatch?.index ?? source.length);
}

assert.match(yml, /daemon-package:\s*\n\s+name: Verify matching Coven daemon package/, "release has a daemon package gate");
assert.match(yml, /npm view "@opencoven\/cli@latest" version/, "daemon gate verifies the package installed by the client");
assert.match(yml, /process\.argv\[2\], process\.argv\[3\]\) >= 0/, "daemon gate requires latest CLI to satisfy the Cave version");
assert.match(yml, /build:[\s\S]{0,100}needs: daemon-package/, "desktop builds wait for the daemon package gate");
const updaterManifestJob = workflowJob(yml, "updater-manifest");
const updaterManifestCondition = /^    if: (.+)$/m.exec(updaterManifestJob)?.[1];
assert.ok(updaterManifestCondition, "updater-manifest must have a job-level condition");
assert.match(updaterManifestCondition, /!cancelled\(\)/, "updater-manifest does not run after cancellation");
assert.match(
  updaterManifestCondition,
  /needs\.build\.result != 'cancelled'/,
  "updater-manifest rejects a cancelled build",
);
assert.match(
  updaterManifestCondition,
  /needs\.build\.result != 'skipped'/,
  "updater-manifest rejects a build that was skipped entirely",
);
assert.doesNotMatch(
  updaterManifestCondition,
  /success\(\)/,
  "updater-manifest still runs after a partial build failure",
);
assert.match(yml, /PLATFORM_COUNT=\$count.*GITHUB_ENV/, "platform count exported for the body note");
assert.match(yml, /Flag partial updater coverage in the release body/, "partial coverage is flagged on the release itself");
assert.match(yml, /sed '\/Partial updater coverage\/d'/, "the body note is idempotent (marker stripped before deciding)");
assert.match(yml, /latest\.json has 0 platforms/, "zero platforms stays fatal");

// ── verify-release-updater --allow-partial pins ───────────────────────────────
const verify = await readFile(new URL("./verify-release-updater.mjs", import.meta.url), "utf8");
assert.match(verify, /allowPartial = process\.argv\.includes\("--allow-partial"\)/, "flag exists");
assert.match(
  verify,
  /\(allowPartial \? warn : fail\)\(`missing platform/,
  "missing platform downgrades to a warning under --allow-partial",
);
assert.match(
  verify,
  /if \(!Object\.keys\(plats\)\.length\) fail\(/,
  "an EMPTY manifest fails even with --allow-partial",
);

console.log("stamp-release.test.mjs: ok");
