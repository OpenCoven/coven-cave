import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const temp = mkdtempSync(path.join(tmpdir(), "beads-pr-bridge-"));
const bin = path.join(temp, "bin");
const bdLog = path.join(temp, "bd.log");
await import("node:fs/promises").then((fs) => fs.mkdir(bin));

const gh = path.join(bin, "gh");
writeFileSync(
  gh,
  `#!/usr/bin/env bash
if [[ "$1" == "pr" && "$2" == "list" ]]; then
  cat <<'JSON'
[
  {
    "number": 42,
    "title": "Implement PR bridge for cave-hlv.5",
    "url": "https://github.com/OpenCoven/coven-cave/pull/42",
    "isDraft": false,
    "headRefName": "feat/cave-hlv.5-pr-bridge",
    "baseRefName": "main",
    "mergeStateStatus": "CLEAN",
    "reviewDecision": "APPROVED",
    "statusCheckRollup": [
      { "name": "Frontend build", "status": "COMPLETED", "conclusion": "SUCCESS" }
    ],
    "updatedAt": "2026-07-04T12:30:00Z",
    "body": "Bead: cave-hlv.5",
    "labels": []
  },
  {
    "number": 43,
    "title": "Unrelated PR for cave-w9o",
    "url": "https://github.com/OpenCoven/coven-cave/pull/43",
    "isDraft": false,
    "headRefName": "fix/cave-w9o-unrelated",
    "baseRefName": "main",
    "mergeStateStatus": "BLOCKED",
    "reviewDecision": "",
    "statusCheckRollup": [
      { "name": "Frontend build", "status": "IN_PROGRESS", "conclusion": null }
    ],
    "updatedAt": "2026-07-04T12:31:00Z",
    "body": "Bead: cave-w9o",
    "labels": []
  }
]
JSON
  exit 0
fi
echo "unexpected gh args: $*" >&2
exit 2
`,
);
chmodSync(gh, 0o755);

const bd = path.join(bin, "bd");
writeFileSync(
  bd,
  `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$BD_ARG_LOG"
printf '{"ok":true}\\n'
`,
);
chmodSync(bd, 0o755);

function run(args) {
  return execFileSync(process.execPath, ["--experimental-strip-types", "scripts/beads-pr-bridge.ts", ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      BD_ARG_LOG: bdLog,
    },
  });
}

const dryRun = JSON.parse(run(["--repo", "OpenCoven/coven-cave", "--json"]));
assert.equal(dryRun.ok, true, "dry-run bridge should succeed");
assert.equal(dryRun.apply, false, "bridge should default to report-only mode");
assert.equal(dryRun.summaries[0].lane, "ready-to-merge", "bridge should classify the PR lane");
assert.deepEqual(dryRun.summaries[0].beadIds, ["cave-hlv.5"], "bridge should discover linked bead IDs");
assert.equal(dryRun.beadUpdates.length, 2, "bridge should plan linked bead updates for all open PRs by default");
assert.throws(() => readFileSync(bdLog, "utf8"), /ENOENT/, "dry-run mode must not call bd");

const filtered = JSON.parse(run(["--repo", "OpenCoven/coven-cave", "--json", "--", "--pr", "42"]));
assert.equal(filtered.summaries.length, 1, "PR filter should narrow the report to one PR");
assert.equal(filtered.beadUpdates[0].id, "cave-hlv.5", "PR filter should plan only the selected PR's bead update");

const applied = JSON.parse(run(["--repo", "OpenCoven/coven-cave", "--pr", "42", "--apply", "--json"]));
assert.equal(applied.apply, true, "apply mode should be explicit in output");
assert.equal(applied.beadUpdates[0].id, "cave-hlv.5", "apply mode should report the updated bead");

const bdArgs = readFileSync(bdLog, "utf8");
assert.match(bdArgs, /update cave-hlv\.5/, "apply mode should update the linked bead");
assert.doesNotMatch(bdArgs, /cave-w9o/, "filtered apply mode must not update unrelated PR beads");
assert.match(bdArgs, /--external-ref https:\/\/github\.com\/OpenCoven\/coven-cave\/pull\/42/, "apply mode should attach the PR URL");
assert.match(bdArgs, /--append-notes GitHub PR #42: ready-to-merge/, "apply mode should append concise PR state");

console.log("beads-pr-bridge.test.mjs: ok");
