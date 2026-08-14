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
  compareVersions,
  nextIosBuildStamp,
  STAMP_FILES,
  applyReplacement,
  readStampedVersion,
  stampContent,
  buildChangelogSection,
  insertChangelogSection,
  writeReleaseEdits,
  findOpenStampPr,
  resolveGitExecutable,
} from "./stamp-release.mjs";
import {
  inspectReleaseSourceFiles,
  releaseSourceErrors,
} from "./check-release-version.mjs";
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
assert.equal(compareVersions("0.2.5", "0.2.4"), 1);
assert.equal(compareVersions("0.2.4", "0.2.4"), 0);
assert.equal(compareVersions("0.2.3", "0.2.4"), -1);
assert.equal(compareVersions("10.0.0", "2.99.99"), 1, "versions compare numerically");
assert.throws(() => compareVersions("v0.2.5", "0.2.4"), /unparseable left/);
assert.equal(
  resolveGitExecutable({
    platform: "linux",
    env: { WSL_INTEROP: "/run/WSL/interop" },
    gitPointer: "gitdir: C:/repo/.git/worktrees/release",
    pathExists: (candidate) => candidate === "/mnt/c/Program Files/Git/cmd/git.exe",
  }),
  "/mnt/c/Program Files/Git/cmd/git.exe",
  "WSL uses Windows Git when a managed worktree carries a Windows Git pointer",
);
assert.equal(
  resolveGitExecutable({
    platform: "linux",
    env: {},
    gitPointer: "gitdir: C:/repo/.git/worktrees/release",
  }),
  "git",
  "ordinary Linux keeps the native Git executable",
);
assert.equal(
  resolveGitExecutable({
    platform: "linux",
    env: { WSL_INTEROP: "/run/WSL/interop", COVEN_CAVE_GIT_EXECUTABLE: "/custom/git" },
    gitPointer: "gitdir: C:/repo/.git/worktrees/release",
  }),
  "/custom/git",
  "an explicit Git executable override wins",
);

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
  const source = `[workspace.package]\nversion = "0.0.159"\n\n[package]\nname = "app"\nversion = "0.0.159"\n`;
  const { content, replaced } = stampContent("toml-version", source, "0.0.159", "0.0.160");
  assert.equal(replaced, 1, "only the canonical package version is stamped");
  assert.match(content, /\[workspace\.package\]\nversion = "0\.0\.159"/);
  assert.match(content, /\[package\][\s\S]*version = "0\.0\.160"/);
}
{
  const source = '{"metadata":{"version":"0.0.159"},"version":"0.0.159"}\n';
  const { content, replaced } = stampContent("json-version", source, "0.0.159", "0.0.160");
  assert.equal(replaced, 1, "only the root JSON version is stamped");
  assert.match(content, /"metadata":\{"version":"0\.0\.159"\}/);
  assert.match(content, /,"version":"0\.0\.160"/);
}
assert.throws(
  () => readStampedVersion("json-version", '{"version":"0.2.4","version":"0.2.3"}', "package.json"),
  /duplicate keys/,
  "duplicate JSON version keys must not silently choose the last value",
);
assert.equal(
  readStampedVersion("json-version", '{"name":"coven-cave","version":"0.2.4"}', "package.json"),
  "0.2.4",
);
assert.equal(
  readStampedVersion(
    "cargo-lock-app",
    '[[package]]\nname = "dependency"\nversion = "9.9.9"\n\n[[package]]\nname = "app"\nversion = "0.2.4"\n',
    "src-tauri/Cargo.lock",
  ),
  "0.2.4",
);
assert.throws(
  () =>
    readStampedVersion(
      "cargo-lock-app",
      '[[package]]\nname = "app"\nversion = "0.2.4"\n\n[[package]]\nname = "app"\nversion = "9.9.9"\n',
      "src-tauri/Cargo.lock",
    ),
  /expected exactly one app package version in Cargo.lock/,
  "duplicate app package blocks must not silently choose the first version",
);
assert.throws(
  () => readStampedVersion("json-version", '{"name":"missing-version"}', "package.json"),
  /package\.json: could not read/,
);
// ── nextIosBuildStamp: the CFBundleVersion the App Store checks ──────────────
{
  assert.equal(
    nextIosBuildStamp("2026080322", new Date("2026-08-06T01:40:38Z")),
    "2026080601",
    "a fresh cut takes the current YYYYMMDDHH UTC instant",
  );
  assert.equal(
    nextIosBuildStamp("2026080322", new Date("2026-09-07T09:05:00Z")),
    "2026090709",
    "month/day/hour are zero-padded to keep the stamp ten digits",
  );
  assert.equal(
    nextIosBuildStamp(undefined, new Date("2026-08-06T01:40:38Z")),
    "2026080601",
    "an unreadable previous stamp still yields the current instant",
  );
  // The whole point: a stamp that did not move is what App Store Connect
  // rejects, so a same-hour re-cut must still advance.
  assert.equal(
    nextIosBuildStamp("2026080601", new Date("2026-08-06T01:59:00Z")),
    "2026080602",
    "a second cut in the same UTC hour advances an hour",
  );
  assert.equal(
    nextIosBuildStamp("2026080623", new Date("2026-08-06T23:10:00Z")),
    "2026080700",
    "advancing off hour 23 rolls the date rather than emitting hour 24",
  );
  assert.equal(
    nextIosBuildStamp("2026123123", new Date("2026-12-31T23:10:00Z")),
    "2027010100",
    "advancing off the last hour of the year rolls the year",
  );
  assert.equal(
    nextIosBuildStamp("2026090101", new Date("2026-08-06T01:40:38Z")),
    "2026090102",
    "a backwards clock never regresses the stamp",
  );
  for (const stamp of [
    nextIosBuildStamp("2026080601", new Date("2026-08-06T01:59:00Z")),
    nextIosBuildStamp("2026080623", new Date("2026-08-06T23:10:00Z")),
  ]) {
    assert.match(stamp, /^\d{10}$/, "every advanced stamp keeps the ten-digit shape");
    assert.ok(
      Number(stamp.slice(8, 10)) <= 23,
      "every advanced stamp keeps a real UTC hour (src/lib/app-version.test.ts pins this)",
    );
  }
  assert.throws(() => nextIosBuildStamp("1", new Date("nope")), /valid date/);
}

{
  const now = new Date("2026-08-06T01:40:38Z");
  assert.equal(
    applyReplacement(
      "yaml-ios-versions",
      [
        "name: CovenCave",
        "settings:",
        "  base:",
        '    MARKETING_VERSION: "0.2.1"',
        '    CURRENT_PROJECT_VERSION: "2026080322"',
        "",
      ].join("\n"),
      "0.2.2",
      "apps/ios/CovenCave/project.yml",
      now,
    ),
    [
      "name: CovenCave",
      "settings:",
      "  base:",
      '    MARKETING_VERSION: "0.2.2"',
      '    CURRENT_PROJECT_VERSION: "2026080601"',
      "",
    ].join("\n"),
    "both canonical scalars are replaced without changing quoting or indentation",
  );
  assert.throws(
    () =>
      applyReplacement(
        "yaml-ios-versions",
        ["name: Example", "settings:", "  base:", '    MARKETING_VERSION: "0.2.1"', ""].join("\n"),
        "0.2.2",
        "apps/ios/CovenCave/project.yml",
        now,
      ),
    /must define CURRENT_PROJECT_VERSION exactly once.*was not found/,
    "a project.yml with no build stamp fails loudly instead of shipping a stale CFBundleVersion",
  );
  assert.throws(
    () =>
      applyReplacement(
        "yaml-ios-versions",
        [
          "name: Example",
          "settings:",
          "  base:",
          '    MARKETING_VERSION: "0.2.1"',
          '    CURRENT_PROJECT_VERSION: "2026080322"',
          "targets:",
          "  Example:",
          "    settings:",
          "      base:",
          '        CURRENT_PROJECT_VERSION: "9"',
          "",
        ].join("\n"),
        "0.2.2",
        "apps/ios/CovenCave/project.yml",
        now,
      ),
    /must define CURRENT_PROJECT_VERSION exactly once/,
    "a target-level build-stamp override makes the release setting ambiguous",
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
      () => applyReplacement("yaml-ios-versions", source, "0.2.2", "apps/ios/CovenCave/project.yml"),
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
          "yaml-ios-versions",
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
          "yaml-ios-versions",
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
        "yaml-ios-versions",
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
        "yaml-ios-versions",
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
        "yaml-ios-versions",
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
        "yaml-ios-versions",
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
        "yaml-ios-versions",
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
    "yaml-ios-versions",
  );
}
assert.equal(STAMP_FILES.length, 5, "exactly the five stamp locations");
assert.throws(() => stampContent("nope", "", "a", "b"), /unknown stamp kind/);

{
  const storage = new Map([
    ["one", "old-one"],
    ["two", "old-two"],
    ["three", "old-three"],
  ]);
  let attempts = 0;
  assert.throws(
    () =>
      writeReleaseEdits(
        [
          { abs: "one", file: "one", before: "old-one", content: "new-one" },
          { abs: "two", file: "two", before: "old-two", content: "new-two" },
          { abs: "three", file: "three", before: "old-three", content: "new-three" },
        ],
        (file, content) => {
          attempts += 1;
          storage.set(file, content);
          if (attempts === 3) throw new Error("simulated disk failure after mutation");
        },
      ),
    /write failed; prior files restored/,
  );
  assert.deepEqual(
    Object.fromEntries(storage),
    { one: "old-one", two: "old-two", three: "old-three" },
    "a mid-write failure rolls every completed source back",
  );
}

// ── CLI safety ───────────────────────────────────────────────────────────────
{
  const help = spawnSync(process.execPath, [STAMP_RELEASE, "--help"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /pnpm release:preview/);
  assert.match(help.stdout, /never commits, pushes, tags/);

  const typo = spawnSync(process.execPath, [STAMP_RELEASE, "--dryrun"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(typo.status, 1, "an option typo must not fall through to publishing mode");
  assert.match(typo.stderr, /unknown option "--dryrun"/);

  const missingVersion = spawnSync(process.execPath, [STAMP_RELEASE, "--version"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  assert.equal(missingVersion.status, 1, "a missing target must not silently select a patch bump");
  assert.match(missingVersion.stderr, /--version requires a value/);
}

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
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const fs = require("node:fs");
const originalReadFileSync = fs.readFileSync.bind(fs);
const fixtures = ${JSON.stringify(fixtures)};
const script = ${JSON.stringify(STAMP_RELEASE)};
childProcess.execFileSync = (cmd, args) => {
  if (cmd === "git" && args[0] === "status" && args[1] === "--porcelain") return "";
  if (cmd === "gh" && args[0] === "api" && args.some((arg) => String(arg).includes("/pulls"))) return "[]";
  if (cmd === "git" && args[0] === "log") return "feat(release): polish dry run\\nfix(release): cover files\\n";
  throw new Error(\`unexpected execFileSync: \${cmd} \${args.join(" ")}\`);
};
fs.readFileSync = (file, encoding) => {
  if (encoding !== "utf8") return originalReadFileSync(file, encoding);
  if (Object.prototype.hasOwnProperty.call(fixtures, file)) return fixtures[file];
  if (/[\\\\/]node_modules[\\\\/]/.test(String(file))) {
    return originalReadFileSync(file, encoding);
  }
  throw new Error(\`unexpected readFileSync: \${file}\`);
};
fs.writeFileSync = () => {
  throw new Error("dry run must not write");
};
process.env.COVEN_CAVE_GIT_EXECUTABLE = "git";
syncBuiltinESMExports();
process.argv = [process.argv[0], script, "--dry-run"];
await import(pathToFileURL(script));
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
  assert.match(
    dryRun.stdout,
    /would stamp apps\/ios\/CovenCave\/project\.yml \(2 occurrences\)/,
    "the iOS manifest stamps both the marketing version and the build stamp",
  );
  assert.match(dryRun.stdout, /\(dry run — nothing written\)/, "dry run banner is preserved");
}

function stampFixtures(overrides = {}) {
  return {
    [path.join(REPO_ROOT, "package.json")]: '{"version":"0.0.159"}\n',
    [path.join(REPO_ROOT, "src-tauri/tauri.conf.json")]: '{"version":"0.0.159"}\n',
    [path.join(REPO_ROOT, "src-tauri/Cargo.toml")]:
      '[package]\nname = "app"\nversion = "0.0.159"\n',
    [path.join(REPO_ROOT, "src-tauri/Cargo.lock")]:
      '[[package]]\nname = "app"\nversion = "0.0.159"\n',
    [path.join(REPO_ROOT, "apps/ios/CovenCave/project.yml")]:
      'name: CovenCave\nsettings:\n  base:\n    MARKETING_VERSION: "0.0.159"\n    CURRENT_PROJECT_VERSION: "2026070801"\n',
    [path.join(REPO_ROOT, "CHANGELOG.md")]:
      "# Changelog\n\n## [Unreleased]\n\n## [0.0.159] - 2026-07-08\n",
    ...overrides,
  };
}

function releaseSourceFixture(overrides = {}) {
  const absolute = stampFixtures(overrides);
  return Object.fromEntries(
    Object.entries(absolute).map(([file, content]) => [
      path.relative(REPO_ROOT, file).replaceAll("\\", "/"),
      content,
    ]),
  );
}

{
  const files = releaseSourceFixture({
    [path.join(REPO_ROOT, "src-tauri/Cargo.lock")]:
      '[[package]]\nname = "dependency"\nversion = "9.9.9"\n\n[[package]]\nname = "app"\nversion = "0.0.159"\n',
  });
  assert.deepEqual(
    releaseSourceErrors({
      expectedVersion: "0.0.159",
      files,
      requireFinalChangelog: true,
    }),
    [],
    "the audited release checker accepts one coherent stable snapshot",
  );
  assert.deepEqual(
    inspectReleaseSourceFiles(files).versions.find(
      (entry) => entry.path === "src-tauri/Cargo.lock",
    )?.values,
    ["0.0.159"],
    "only Cargo.lock's app package is authoritative",
  );

  const mismatches = [
    ["package.json", '{"version":"0.0.158"}\n'],
    ["src-tauri/tauri.conf.json", '{"version":"0.0.158"}\n'],
    ["src-tauri/Cargo.toml", '[package]\nversion = "0.0.158"\n'],
    [
      "src-tauri/Cargo.lock",
      '[[package]]\nname = "app"\nversion = "0.0.158"\n',
    ],
    [
      "apps/ios/CovenCave/project.yml",
      'settings:\n  base:\n    MARKETING_VERSION: "0.0.158"\n    CURRENT_PROJECT_VERSION: "2026070801"\n',
    ],
  ];
  for (const [file, content] of mismatches) {
    const errors = releaseSourceErrors({
      expectedVersion: "0.0.159",
      files: { ...files, [file]: content },
    });
    assert.ok(
      errors.some((error) => error.includes(`${file}: expected 0.0.159`)),
      `${file} drift must fail the shared release checker: ${errors.join("; ")}`,
    );
  }

  {
    const errors = releaseSourceErrors({
      expectedVersion: "0.0.159",
      files: {
        ...files,
        "package.json": '{"version":"0.0.159","version":"0.0.158"}\n',
      },
    });
    assert.match(
      errors.join("\n"),
      /package\.json: JSON must not contain duplicate keys/,
      "duplicate JSON keys cannot silently substitute the release version",
    );
  }

  {
    const errors = releaseSourceErrors({
      expectedVersion: "0.0.159",
      files: {
        ...files,
        "src-tauri/Cargo.toml": '[metadata]\nversion = "0.0.159"\n',
        "apps/ios/CovenCave/project.yml":
          'targets:\n  Example:\n    settings:\n      base:\n        MARKETING_VERSION: "0.0.159"\n        CURRENT_PROJECT_VERSION: "2026070801"\n',
      },
    });
    assert.match(
      errors.join("\n"),
      /src-tauri\/Cargo\.toml: expected exactly one release version/,
      "a Cargo version outside [package] is not authoritative",
    );
    assert.match(
      errors.join("\n"),
      /must define MARKETING_VERSION exactly once at \["settings","base","MARKETING_VERSION"\]/,
      "target-only iOS settings cannot impersonate canonical release settings",
    );
  }

  {
    const errors = releaseSourceErrors({
      expectedVersion: "0.0.159",
      files: {
        ...files,
        "apps/ios/CovenCave/project.yml":
          'settings:\n  base:\n    MARKETING_VERSION: "0.0.159"\n    CURRENT_PROJECT_VERSION: "2026070801"\ntargets:\n  Example:\n    settings:\n      base:\n        MARKETING_VERSION: "9.9.9"\n',
      },
    });
    assert.match(
      errors.join("\n"),
      /must define MARKETING_VERSION exactly once.*\["targets","Example","settings","base","MARKETING_VERSION"\]/,
      "an iOS target override fails even when the canonical value matches",
    );
  }

  {
    const errors = releaseSourceErrors({
      expectedVersion: "0.0.159",
      files: {
        ...files,
        "apps/ios/CovenCave/project.yml":
          'settings:\n  base:\n    MARKETING_VERSION: "0.0.159"\n    CURRENT_PROJECT_VERSION: "2026070801"\ntargets:\n  Example:\n    settings:\n      base:\n        "MARKETING_VERSION": "9.9.9"\n        \'CURRENT_PROJECT_VERSION\': "1"\n',
      },
    });
    assert.match(
      errors.join("\n"),
      /must define MARKETING_VERSION exactly once.*\["targets","Example","settings","base","MARKETING_VERSION"\]/,
      "quoted iOS target keys are semantic overrides and must fail",
    );
    assert.match(
      errors.join("\n"),
      /must define CURRENT_PROJECT_VERSION exactly once.*\["targets","Example","settings","base","CURRENT_PROJECT_VERSION"\]/,
      "single-quoted iOS target keys cannot evade the build-number guard",
    );
  }

  assert.match(
    releaseSourceErrors({
      expectedVersion: "0.0.159-rc.1",
      files,
    }).join("\n"),
    /prereleases are not published by this workflow/,
  );
  assert.match(
    releaseSourceErrors({
      expectedVersion: "0.0.159",
      files: {
        ...files,
        "apps/ios/CovenCave/project.yml":
          'settings:\n  base:\n    MARKETING_VERSION: "0.0.159"\n    CURRENT_PROJECT_VERSION: "2026133224"\n',
      },
    }).join("\n"),
    /expected one valid YYYYMMDDHH CURRENT_PROJECT_VERSION/,
    "a numeric but impossible iOS build timestamp must not pass release verification",
  );
  assert.match(
    releaseSourceErrors({
      expectedVersion: "0.0.159",
      files: {
        ...files,
        "CHANGELOG.md":
          "# Changelog\n\n## [0.0.159] - 2026-07-08\n\n> _One-line teaser — edit before merge._\n",
      },
      requireFinalChangelog: true,
    }).join("\n"),
    /still contains the generated teaser placeholder/,
  );
}

function runStampHarness({
  args,
  branch = "release/stamp-v0.0.160",
  fixtures = stampFixtures(),
  checkoutFails = false,
  forbidWrites = false,
  headOid = "1111111111111111111111111111111111111111",
  remoteMainOid = "1111111111111111111111111111111111111111",
}) {
  return spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
import { createRequire, syncBuiltinESMExports } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const fs = require("node:fs");
const originalReadFileSync = fs.readFileSync.bind(fs);
const fixtures = ${JSON.stringify(fixtures)};
const options = ${JSON.stringify({
  branch,
  checkoutFails,
  forbidWrites,
  headOid,
  remoteMainOid,
})};
const script = ${JSON.stringify(STAMP_RELEASE)};
const calls = [];
const writes = {};
childProcess.execFileSync = (cmd, args) => {
  calls.push([cmd, ...args]);
  if (cmd === "git" && args[0] === "status" && args[1] === "--porcelain") return "";
  if (cmd === "git" && args[0] === "branch" && args[1] === "--show-current") return options.branch;
  if (cmd === "git" && args[0] === "rev-parse") return options.headOid;
  if (cmd === "git" && args[0] === "ls-remote") {
    return options.remoteMainOid + "\\trefs/heads/main\\n";
  }
  if (cmd === "git" && args[0] === "log") return "feat(release): prepared change\\n";
  if (cmd === "git" && args[0] === "checkout") {
    if (options.checkoutFails) throw new Error("CHECKOUT_FAILED_BEFORE_WRITE");
    return "";
  }
  if (cmd === "git" && ["add", "commit", "push"].includes(args[0])) return "";
  if (cmd === "gh" && args[0] === "api" && !args.includes("POST")) return "[]";
  if (cmd === "gh" && args[0] === "api" && args.includes("POST")) {
    return JSON.stringify({ html_url: "https://example.test/pull/1" });
  }
  throw new Error("unexpected execFileSync: " + cmd + " " + args.join(" "));
};
fs.readFileSync = (file, encoding) => {
  if (encoding !== "utf8") return originalReadFileSync(file, encoding);
  if (Object.prototype.hasOwnProperty.call(fixtures, file)) return fixtures[file];
  if (/[\\\\/]node_modules[\\\\/]/.test(String(file))) {
    return originalReadFileSync(file, encoding);
  }
  throw new Error("unexpected readFileSync: " + file);
};
fs.writeFileSync = (file, content) => {
  if (options.forbidWrites) throw new Error("WRITE_WAS_CALLED");
  writes[file] = String(content);
};
process.env.COVEN_CAVE_GIT_EXECUTABLE = "git";
syncBuiltinESMExports();
process.argv = [process.argv[0], script, ...${JSON.stringify(args)}];
await import(pathToFileURL(script));
console.log("__STAMP_HARNESS__" + JSON.stringify({ calls, writes }));
`,
    ],
    { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function stampHarnessState(result) {
  const line = result.stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith("__STAMP_HARNESS__"));
  assert.ok(line, `missing stamp harness state:\n${result.stderr}\n${result.stdout}`);
  return JSON.parse(line.slice("__STAMP_HARNESS__".length));
}

// --prepare-only owns every source edit while leaving Git and GitHub untouched.
{
  const result = runStampHarness({
    args: ["--prepare-only", "--version", "0.0.160"],
  });
  assert.equal(result.status, 0, `prepare-only failed:\n${result.stderr}\n${result.stdout}`);
  const state = stampHarnessState(result);
  const writtenFiles = Object.keys(state.writes)
    .map((file) => path.relative(REPO_ROOT, file).replaceAll("\\", "/"))
    .sort();
  assert.deepEqual(
    writtenFiles,
    [...expectedChangedFiles, "CHANGELOG.md"].sort(),
    "prepare-only writes exactly the five manifests and changelog",
  );
  for (const file of expectedChangedFiles.slice(0, 4)) {
    assert.match(state.writes[path.join(REPO_ROOT, file)], /0\.0\.160/);
  }
  assert.match(
    state.writes[path.join(REPO_ROOT, "apps/ios/CovenCave/project.yml")],
    /MARKETING_VERSION: "0\.0\.160"/,
  );
  assert.match(state.writes[path.join(REPO_ROOT, "CHANGELOG.md")], /## \[0\.0\.160\]/);
  const mutations = state.calls.filter(
    ([cmd, action, ...rest]) =>
      (cmd === "git" && ["checkout", "add", "commit", "push"].includes(action)) ||
      (cmd === "gh" && rest.includes("POST")),
  );
  assert.deepEqual(mutations, [], "prepare-only performs no Git or GitHub mutation");
  assert.match(result.stdout, /no branch, commit, push, tag, release, or PR action was run/);
}

{
  const result = runStampHarness({
    args: ["--prepare-only", "--version", "0.0.160"],
    branch: "main",
    forbidWrites: true,
  });
  assert.equal(result.status, 1, "prepare-only rejects a non-release branch");
  assert.match(result.stderr, /must run in the managed release\/stamp-v0\.0\.160 worktree/);
  assert.doesNotMatch(result.stderr, /WRITE_WAS_CALLED/);
}

{
  const result = runStampHarness({
    args: ["--prepare-only", "--version", "0.0.160"],
    remoteMainOid: "2222222222222222222222222222222222222222",
    forbidWrites: true,
  });
  assert.equal(result.status, 1, "a stale release branch cannot prepare");
  assert.match(result.stderr, /must start at live origin\/main 2222222/);
  assert.doesNotMatch(result.stderr, /WRITE_WAS_CALLED/);
}

{
  const result = runStampHarness({
    args: ["--prepare-only", "--version", "0.0.160"],
    fixtures: stampFixtures({
      [path.join(REPO_ROOT, "src-tauri/Cargo.lock")]:
        '[[package]]\nname = "app"\nversion = "0.0.158"\n',
    }),
    forbidWrites: true,
  });
  assert.equal(result.status, 1, "manifest drift fails preparation");
  assert.match(result.stderr, /version drift: src-tauri\/Cargo\.lock has 0\.0\.158/);
  assert.doesNotMatch(result.stderr, /WRITE_WAS_CALLED/);
}

{
  const result = runStampHarness({
    args: ["--prepare-only", "--version", "0.0.160"],
    fixtures: stampFixtures({
      [path.join(REPO_ROOT, "src-tauri/Cargo.lock")]:
        '[[package]]\nname = "app"\nversion = "0.0.159"\n\n[[package]]\nname = "app"\nversion = "9.9.9"\n',
    }),
    forbidWrites: true,
  });
  assert.equal(result.status, 1, "ambiguous app package blocks fail preparation");
  assert.match(result.stderr, /expected exactly one app package version in Cargo.lock/);
  assert.doesNotMatch(result.stderr, /WRITE_WAS_CALLED/);
}

for (const target of ["0.0.159", "0.0.158"]) {
  const result = runStampHarness({
    args: ["--prepare-only", "--version", target],
    branch: `release/stamp-v${target}`,
    forbidWrites: true,
  });
  assert.equal(result.status, 1, `${target} must not be accepted as an advancing release`);
  assert.match(result.stderr, /release version must advance/);
  assert.doesNotMatch(result.stderr, /WRITE_WAS_CALLED/);
}

{
  const result = runStampHarness({
    args: ["--prepare-only", "--version", "0.0.160"],
    fixtures: stampFixtures({
      [path.join(REPO_ROOT, "CHANGELOG.md")]:
        "# Changelog\n\n## [Unreleased]\n\n## [0.0.160] - 2026-07-09\n",
    }),
    forbidWrites: true,
  });
  assert.equal(result.status, 1, "a duplicate changelog section fails preparation");
  assert.match(result.stderr, /CHANGELOG\.md already contains a v0\.0\.160 section/);
  assert.doesNotMatch(result.stderr, /WRITE_WAS_CALLED/);
}

{
  const result = runStampHarness({
    args: ["--version", "0.0.160"],
    branch: "release/stamp-v0.0.160",
  });
  assert.equal(result.status, 0, `legacy transport failed:\n${result.stderr}\n${result.stdout}`);
  const state = stampHarnessState(result);
  assert.equal(
    state.calls.some(([cmd, action]) => cmd === "git" && action === "checkout"),
    false,
    "legacy transport reuses an already-managed release branch",
  );
  assert.ok(
    state.calls.some(([cmd, action]) => cmd === "git" && action === "commit"),
    "legacy transport still creates the signed stamp commit",
  );
  assert.ok(
    state.calls.some(([cmd, action, ...rest]) => cmd === "gh" && rest.includes("POST")),
    "legacy transport still opens the stamp PR",
  );
}

{
  const result = runStampHarness({
    args: ["--version", "0.0.160"],
    branch: "main",
    checkoutFails: true,
    forbidWrites: true,
  });
  assert.notEqual(result.status, 0, "a branch-creation failure remains fatal");
  assert.match(result.stderr, /CHECKOUT_FAILED_BEFORE_WRITE/);
  assert.doesNotMatch(result.stderr, /WRITE_WAS_CALLED/);
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
assert.match(
  await readFile(new URL("./stamp-release.mjs", import.meta.url), "utf8"),
  /"--paginate",\s*"--jq",\s*"\.\[\] \| \{ number, title \} \| @json",\s*`repos\/\$\{repo\}\/pulls\?state=open&per_page=100`/,
  "the stamp collision guard must inspect every page of open pull requests",
);

// ── release.yml resilience pins ───────────────────────────────────────────────
const yml = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

assert.equal(
  packageJson.scripts["release:preview"],
  "node scripts/stamp-release.mjs --dry-run",
  "release preview is a discoverable package command",
);
assert.equal(
  packageJson.scripts["release:prepare"],
  "node scripts/stamp-release.mjs --prepare-only",
  "release preparation is a discoverable non-publishing package command",
);
assert.equal(
  packageJson.scripts["release:verify"],
  "node scripts/check-release-version.mjs --root . --require-final-changelog",
  "release verification is a discoverable package command shared with CI",
);

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

assert.match(yml, /daemon-package:\s*\n\s+name: Verify available Coven daemon package/, "release has a daemon package gate");
const daemonPackageJob = workflowJob(yml, "daemon-package");
assert.match(
  daemonPackageJob,
  /if ! LATEST=\$\(npm view "@opencoven\/cli@latest" version\); then/,
  "daemon gate requires the package installed by the client to resolve",
);
assert.match(
  daemonPackageJob,
  /const strictSemver = \/\^.+\$\//,
  "daemon gate validates the registry response as strict SemVer",
);
const strictSemverLiteral = daemonPackageJob.match(
  /const strictSemver = (\/\^.+\$\/);/,
)?.[1];
assert.ok(strictSemverLiteral, "daemon gate exposes its strict SemVer contract");
const strictSemver = new RegExp(strictSemverLiteral.slice(1, -1));
for (const version of ["0.2.4", "1.2.3-rc.1", "1.2.3+build.7", "1.2.3-rc.1+build.7"]) {
  assert.match(version, strictSemver, `daemon gate accepts published SemVer ${version}`);
}
for (const version of ["", "v1.2.3", "01.2.3", "1.2.3-01", "1.2.3-", "1.2.3\n2.0.0"]) {
  assert.doesNotMatch(version, strictSemver, `daemon gate rejects invalid registry response ${JSON.stringify(version)}`);
}
assert.match(
  daemonPackageJob,
  /version\.includes\("\\n"\)/,
  "daemon gate rejects a multi-version registry response",
);
assert.doesNotMatch(
  daemonPackageJob,
  /RAW_RELEASE_TAG|VERSION="\$\{TAG#v\}"|process\.argv\[3\]|requires an @opencoven\/cli release >=/,
  "daemon and Cave releases have independent version lines",
);
const sourceVersionJob = workflowJob(yml, "source-version");
assert.match(
  yml,
  /\npermissions:\s*\n\s+contents: read/,
  "the release workflow defaults to read-only repository contents",
);
assert.ok(
  sourceVersionJob.includes("^v[0-9]+\\.[0-9]+\\.[0-9]+$"),
  "the current publisher accepts stable tags only",
);
assert.match(
  sourceVersionJob,
  /EVENT_NAME" = "workflow_dispatch"[\s\S]*WORKFLOW_REF" != "refs\/heads\/\$DEFAULT_BRANCH"/,
  "manual recovery can load checker tooling only from the default branch",
);
assert.match(
  sourceVersionJob,
  /ref: \$\{\{ steps\.release\.outputs\.ref \}\}[\s\S]*fetch-depth: 0[\s\S]*persist-credentials: false/,
  "source-version checks out the explicit full tag ref with history and no write credential",
);
assert.match(
  sourceVersionJob,
  /git cat-file -t "refs\/tags\/\$RELEASE_TAG"[\s\S]*\.verification\.verified[\s\S]*git merge-base --is-ancestor "\$TAGGED_COMMIT" origin\/main/,
  "source-version requires an annotated GitHub-verified tag contained in main",
);
const tagVerificationIndex = sourceVersionJob.indexOf("- name: Require a verified signed tag on main");
assert.notEqual(tagVerificationIndex, -1, "tag verification step must exist");
const dependencyInstallIndex = sourceVersionJob.indexOf("- name: Install release checker runtime dependency");
assert.notEqual(dependencyInstallIndex, -1, "release checker dependency install step must exist");
assert.ok(
  tagVerificationIndex < dependencyInstallIndex,
  "source-version verifies tag provenance before installing tag-controlled dependencies",
);
assert.match(
  sourceVersionJob,
  /pnpm install --frozen-lockfile --prod --ignore-scripts --ignore-pnpmfile/,
  "the release checker install disables lifecycle scripts and pnpmfile hooks",
);
assert.match(
  sourceVersionJob,
  /scripts\/check-release-version\.mjs scripts\/release-yaml-settings\.mjs[\s\S]*git show "\$\{WORKFLOW_TOOLING_SHA\}:\$\{tooling_path\}"[\s\S]*expected_blob[\s\S]*actual_blob/,
  "manual recovery loads and blob-verifies the checker and semantic YAML helper from the reviewed workflow commit",
);
assert.match(
  sourceVersionJob,
  /git merge-base --is-ancestor "\$WORKFLOW_TOOLING_SHA" origin\/main/,
  "the checker tooling commit must be contained in live main",
);
assert.match(
  sourceVersionJob,
  /node "\$CHECKER_PATH"[\s\\]*--root "\$GITHUB_WORKSPACE"[\s\\]*--version "\$RELEASE_VERSION"[\s\\]*--require-final-changelog/,
  "the audited checker validates every stamped manifest and the finalized changelog",
);
assert.doesNotMatch(sourceVersionJob, /allow_unconfigured_/, "no recovery bypass weakens source integrity");
const buildJob = workflowJob(yml, "build");
assert.match(buildJob, /needs:\s*\n\s+- daemon-package\s*\n\s+- source-version/, "desktop builds wait for both release gates");
assert.match(
  sourceVersionJob,
  /outputs:\s*\n\s+release-commit: \$\{\{ steps\.tag\.outputs\.commit \}\}/,
  "the source gate exposes the immutable commit verified from the signed tag",
);
assert.match(
  buildJob,
  /ref: \$\{\{ needs\.source-version\.outputs\.release-commit \}\}\s*\n\s+persist-credentials: false/,
  "desktop builds check out the immutable commit verified by the source gate",
);
const checksumsJob = workflowJob(yml, "checksums");
assert.match(
  checksumsJob,
  /needs:\s*\n\s+- build\s*\n\s+- source-version[\s\S]*ref: \$\{\{ needs\.source-version\.outputs\.release-commit \}\}[\s\S]*persist-credentials: false/,
  "checksum publication uses the immutable commit verified by the source gate",
);
const updaterManifestJob = workflowJob(yml, "updater-manifest");
assert.match(
  updaterManifestJob,
  /needs:\s*\n\s+- build\s*\n\s+- source-version\s*\n\s+permissions:\s*\n\s+contents: write[\s\S]*ref: \$\{\{ needs\.source-version\.outputs\.release-commit \}\}\s*\n\s+persist-credentials: false/,
  "updater publication uses the immutable commit verified by the source gate",
);
assert.doesNotMatch(buildJob, /matrix\.os/, "release summaries use the declared matrix platform key");
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
