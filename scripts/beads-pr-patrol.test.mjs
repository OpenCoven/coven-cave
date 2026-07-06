// End-to-end patrol CLI test (cave-hlv.7): fake gh + bd on PATH (the
// beads-pr-bridge.test.mjs pattern), real script execution. Report-only must
// never touch bd; --apply mirrors linked beads; windows reorder the digest.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const temp = mkdtempSync(path.join(tmpdir(), "beads-pr-patrol-"));
const bin = path.join(temp, "bin");
const bdLog = path.join(temp, "bd.log");
await mkdir(bin);

const staleIso = new Date(Date.now() - 40 * 3_600_000).toISOString();
const freshIso = new Date(Date.now() - 2 * 3_600_000).toISOString();

const gh = path.join(bin, "gh");
writeFileSync(
  gh,
  `#!/usr/bin/env bash
if [[ "$1" == "pr" && "$2" == "list" ]]; then
  cat <<JSON
[
  {
    "number": 71,
    "title": "Fix flaky sync for cave-aa1",
    "url": "https://github.com/OpenCoven/coven-cave/pull/71",
    "isDraft": false,
    "headRefName": "fix/cave-aa1-flaky-sync",
    "baseRefName": "main",
    "mergeStateStatus": "CLEAN",
    "reviewDecision": "",
    "statusCheckRollup": [
      { "name": "Frontend build", "status": "COMPLETED", "conclusion": "FAILURE" }
    ],
    "updatedAt": "${staleIso}",
    "body": "",
    "labels": []
  },
  {
    "number": 72,
    "title": "Ship the widget (cave-bb2)",
    "url": "https://github.com/OpenCoven/coven-cave/pull/72",
    "isDraft": false,
    "headRefName": "feat/cave-bb2-widget",
    "baseRefName": "main",
    "mergeStateStatus": "CLEAN",
    "reviewDecision": "APPROVED",
    "statusCheckRollup": [
      { "name": "Frontend build", "status": "COMPLETED", "conclusion": "SUCCESS" }
    ],
    "updatedAt": "${freshIso}",
    "body": "",
    "labels": []
  },
  {
    "number": 73,
    "title": "Anonymous experiment",
    "url": "https://github.com/OpenCoven/coven-cave/pull/73",
    "isDraft": true,
    "headRefName": "spike/experiment",
    "baseRefName": "main",
    "mergeStateStatus": "UNKNOWN",
    "reviewDecision": "",
    "statusCheckRollup": [],
    "updatedAt": "${freshIso}",
    "body": "no bead here",
    "labels": []
  }
]
JSON
  exit 0
fi
echo "unexpected gh invocation: $@" >&2
exit 1
`,
);
chmodSync(gh, 0o755);

const bd = path.join(bin, "bd");
writeFileSync(
  bd,
  `#!/usr/bin/env bash
echo "$@" >> "${bdLog}"
exit 0
`,
);
chmodSync(bd, 0o755);

const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
const script = path.join(root, "scripts", "beads-pr-patrol.ts");
const runPatrol = (...args) =>
  execFileSync("node", ["--experimental-strip-types", script, "--repo", "OpenCoven/coven-cave", ...args], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

// ── Report-only: full digest, zero bd writes ──────────────────────────────────
{
  const out = runPatrol("--window", "morning");
  assert.match(out, /morning window · 3 open PRs · 2 actionable/, "headline");
  assert.match(out, /#71 checks-failing \[cave-aa1\] .* · STALE/, "failing PR is stale-flagged");
  assert.match(out, /#72 ready-to-merge \[cave-bb2\]/, "ready PR classified");
  assert.match(out, /Unlinked \(no bead — invisible to the queue\): #73/, "bead-less draft flagged");
  assert.match(out, /Mode: report-only/, "default is report-only");
  const fixIdx = out.indexOf("Fix first");
  const landIdx = out.indexOf("Ready to land");
  assert.ok(fixIdx >= 0 && landIdx > fixIdx, "morning: fix-first leads");
  assert.ok(!existsSync(bdLog), "report-only never invokes bd");
}

// ── Evening window reorders the digest ────────────────────────────────────────
{
  const out = runPatrol("--window", "evening");
  const fixIdx = out.indexOf("Fix first");
  const landIdx = out.indexOf("Ready to land");
  assert.ok(landIdx >= 0 && fixIdx > landIdx, "evening: land leads");
}

// ── JSON mode round-trips the digest ─────────────────────────────────────────
{
  const parsed = JSON.parse(runPatrol("--window", "morning", "--json"));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.window, "morning");
  assert.equal(parsed.digest.total, 3);
  assert.deepEqual(parsed.digest.unlinked, [73]);
  assert.equal(parsed.beadUpdates.every((u) => u.applied === false), true, "json report plans, never applies");
}

// ── Apply sweeps every linked bead through bd ────────────────────────────────
{
  const out = runPatrol("--window", "evening", "--apply");
  assert.match(out, /Mode: apply/, "apply mode is explicit");
  assert.match(out, /Mirrored 2 bead updates\./, "one update per linked bead");
  const log = readFileSync(bdLog, "utf8").trim().split("\n");
  assert.equal(log.length, 2, "bd called once per linked bead");
  assert.match(log[0], /update cave-aa1 --external-ref .*pull\/71 --append-notes GitHub PR #71: checks-failing/,
    "state note mirrors the lane");
  assert.match(log[1], /update cave-bb2 .*pull\/72 --append-notes GitHub PR #72: ready-to-merge/,
    "ready lane mirrored too");
}

// ── Guardrails: bad args fail loudly ─────────────────────────────────────────
{
  assert.throws(() => runPatrol("--window", "midnight"), /must be morning or evening/, "window is validated");
  assert.throws(() => runPatrol("--stale-hours", "-3"), /positive number/, "stale window is validated");
  assert.throws(
    () =>
      execFileSync("node", ["--experimental-strip-types", script], {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    /--repo OWNER\/REPO is required/,
    "repo is required",
  );
}

console.log("beads-pr-patrol.test.mjs: ok");
