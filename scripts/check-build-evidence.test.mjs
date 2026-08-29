import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  EVIDENCE_JOB_PREFIXES,
  evidenceSummaryLines,
  latestEvidenceJobs,
  staleEvidence,
} from "./check-build-evidence.mjs";
import { resolveRunBaseSnapshot } from "./capture-ci-base-snapshot.mjs";

const SCRIPT = fileURLToPath(new URL("./check-build-evidence.mjs", import.meta.url));
const EXPECTED_HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);
const RUN_BASE = "c".repeat(40);
const LIVE_BASE = "d".repeat(40);
const ATTEMPT_STARTED_AT = "2026-08-29T10:00:00Z";
const FRESH_STARTED_AT = "2026-08-29T10:01:00Z";
const EVIDENCE_JOB_NAMES = [
  "Select validation",
  "iOS build",
  "Frontend bundle",
  "Frontend validation (lint)",
  "Frontend validation (typecheck)",
  "Frontend validation (test wiring)",
  "Frontend validation (app tests)",
  "Frontend validation (API tests)",
  "Frontend validation (mobile tests)",
  "Frontend validation (protocol conformance)",
  ...Array.from({ length: 8 }, (_, index) => `Frontend E2E (${index + 1}/8)`),
  "Frontend E2E (agentic)",
];

function job(
  name,
  {
    headSha = EXPECTED_HEAD,
    attempt = 3,
    startedAt = FRESH_STARTED_AT,
    conclusion = "success",
    id = 1,
  } = {},
) {
  return {
    id,
    name,
    head_sha: headSha,
    run_attempt: attempt,
    started_at: startedAt,
    conclusion,
  };
}

function context(overrides = {}) {
  return {
    expectedHeadSha: EXPECTED_HEAD,
    attemptStartedAt: ATTEMPT_STARTED_AT,
    runBaseRef: "main",
    runBaseSha: RUN_BASE,
    liveBaseSha: RUN_BASE,
    ...overrides,
  };
}

function cli(input, overrides = {}) {
  const values = context(overrides);
  return spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--expected-head-sha",
      values.expectedHeadSha,
      "--attempt-started-at",
      values.attemptStartedAt,
      "--run-base-ref",
      values.runBaseRef,
      "--run-base-sha",
      values.runBaseSha,
      "--live-base-sha",
      values.liveBaseSha,
    ],
    { input: JSON.stringify(input), encoding: "utf8" },
  );
}

test("each validation and E2E leg is retained by its exact job name", () => {
  const jobs = EVIDENCE_JOB_NAMES.map((name, index) => job(name, {
    headSha: name === "Frontend E2E (agentic)" ? OTHER_HEAD : EXPECTED_HEAD,
    id: index + 1,
  }));
  const latest = latestEvidenceJobs(jobs);

  assert.equal(latest.size, 19);
  assert.deepEqual([...latest.keys()], EVIDENCE_JOB_NAMES);
  assert.deepEqual(staleEvidence(jobs, context()), [
    `Frontend E2E (agentic) reported head ${OTHER_HEAD}; expected workflow head ${EXPECTED_HEAD}`,
  ]);
});

test("a duplicate exact job name selects its newest record only", () => {
  const latest = latestEvidenceJobs([
    job("Frontend validation (app tests)", {
      headSha: OTHER_HEAD,
      attempt: 1,
      startedAt: "2026-08-29T08:00:00Z",
      id: 10,
    }),
    job("Frontend validation (app tests)", { attempt: 2, id: 20 }),
    job("Frontend validation (lint)", { attempt: 2, id: 21 }),
  ]);

  assert.equal(latest.size, 2);
  assert.equal(latest.get("Frontend validation (app tests)").id, 20);
  assert.equal(latest.get("Frontend validation (app tests)").head_sha, EXPECTED_HEAD);
});

test("skipped and unrelated jobs are not successful evidence", () => {
  const latest = latestEvidenceJobs([
    job("iOS build", { conclusion: "skipped" }),
    job("Frontend validation (lint)", { conclusion: "failure" }),
    job("unrelated job"),
    job("Select validation", { id: 4 }),
  ]);

  assert.deepEqual([...latest.keys()], ["Select validation"]);
});

test("a carried-forward job is stale even when GitHub relabels its attempt", () => {
  const jobs = [
    job("Frontend validation (app tests)", {
      attempt: 3,
      startedAt: "2026-08-29T09:00:00Z",
    }),
  ];

  assert.deepEqual(staleEvidence(jobs, context()), [
    "Frontend validation (app tests) started 2026-08-29T09:00:00Z before the current attempt started 2026-08-29T10:00:00Z",
  ]);
});

test("fresh PR-head evidence passes without comparing to the synthetic merge SHA", () => {
  const syntheticMergeSha = "e".repeat(40);
  assert.notEqual(syntheticMergeSha, EXPECTED_HEAD);
  assert.deepEqual(
    staleEvidence([job("Frontend validation (app tests)")], context()),
    [],
  );
});

test("the gate refuses when the run base differs from the live base ref", () => {
  assert.deepEqual(
    staleEvidence(
      [job("Select validation")],
      context({ liveBaseSha: LIVE_BASE }),
    ),
    [`base main moved: run recorded ${RUN_BASE}, live ref is ${LIVE_BASE}`],
  );
});

test("a recovery dispatch snapshots the live base ref instead of stale associated-PR SHA", () => {
  const staleAssociatedBase = "e".repeat(40);
  const liveDispatchBase = "f".repeat(40);
  const requestedRefs = [];
  const snapshot = resolveRunBaseSnapshot(
    {
      eventName: "workflow_dispatch",
      prNumber: "5097",
    },
    {
      getPullRequest: () => ({ base: { ref: "main", sha: staleAssociatedBase } }),
      getRef: (ref) => {
        requestedRefs.push(ref);
        return { object: { sha: liveDispatchBase } };
      },
    },
  );

  assert.deepEqual(requestedRefs, ["main"]);
  assert.deepEqual(snapshot, { ref: "main", sha: liveDispatchBase });
  assert.notEqual(snapshot.sha, staleAssociatedBase);
});

test("base snapshot acquisition fails closed on missing or malformed inputs", () => {
  assert.throws(
    () => resolveRunBaseSnapshot(
      { eventName: "pull_request", eventBaseRef: "main" },
      { getRef: () => ({ object: {} }) },
    ),
    /run base SHA is missing or malformed/,
  );
  assert.throws(
    () => resolveRunBaseSnapshot(
      { eventName: "workflow_dispatch", prNumber: "5097" },
      {
        getPullRequest: () => ({ base: { ref: "main" } }),
        getRef: () => ({ object: { sha: "not-a-sha" } }),
      },
    ),
    /run base SHA is missing or malformed/,
  );
  assert.throws(
    () => resolveRunBaseSnapshot({ eventName: "workflow_dispatch", prNumber: "" }),
    /recovery PR number is missing or malformed/,
  );
  let refRequested = false;
  assert.throws(
    () => resolveRunBaseSnapshot(
      { eventName: "workflow_dispatch", prNumber: "5097" },
      {
        getPullRequest: () => ({ base: { ref: "main\nforged=output" } }),
        getRef: () => {
          refRequested = true;
          return { object: { sha: RUN_BASE } };
        },
      },
    ),
    /run base ref is missing or malformed/,
  );
  assert.equal(refRequested, false, "a malformed base ref must be rejected before an API path is built");
});

test("pull request events ignore stale event base SHA and snapshot the live ref", () => {
  const staleEventBase = "e".repeat(40);
  const requestedRefs = [];
  const snapshot = resolveRunBaseSnapshot(
    {
      eventName: "pull_request",
      eventBaseRef: "main",
      eventBaseSha: staleEventBase,
    },
    {
      getRef: (ref) => {
        requestedRefs.push(ref);
        return { object: { sha: RUN_BASE } };
      },
    },
  );

  assert.deepEqual(requestedRefs, ["main"]);
  assert.deepEqual(snapshot, { ref: "main", sha: RUN_BASE });
  assert.notEqual(snapshot.sha, staleEventBase);
});

test("push events preserve their head snapshot", () => {
  assert.deepEqual(
    resolveRunBaseSnapshot({
      eventName: "push",
      expectedHeadSha: EXPECTED_HEAD,
      refName: "main",
    }),
    { ref: "main", sha: EXPECTED_HEAD },
  );
});

test("missing or malformed evidence timestamps fail closed", () => {
  assert.deepEqual(
    staleEvidence(
      [job("Frontend bundle", { startedAt: null })],
      context(),
    ),
    ["Frontend bundle has no valid started_at timestamp (unknown)"],
  );
  assert.deepEqual(
    staleEvidence(
      [job("Frontend bundle", { startedAt: "not-a-time" })],
      context(),
    ),
    ["Frontend bundle has no valid started_at timestamp (not-a-time)"],
  );
});

test("an empty successful evidence inventory fails closed", () => {
  assert.deepEqual(
    staleEvidence(
      [job("Frontend validation (lint)", { conclusion: "skipped" })],
      context(),
    ),
    ["no successful upstream evidence jobs were returned by the Actions API"],
  );
});

test("summary lines are deterministic and preserve exact matrix names", () => {
  assert.deepEqual(
    evidenceSummaryLines([
      job("Frontend E2E (agentic)", { id: 2 }),
      job("Frontend E2E (1/8)", { id: 1 }),
    ]),
    [
      `- Frontend E2E (1/8): ${EXPECTED_HEAD} (attempt 3, started ${FRESH_STARTED_AT})`,
      `- Frontend E2E (agentic): ${EXPECTED_HEAD} (attempt 3, started ${FRESH_STARTED_AT})`,
    ],
  );
});

test("the CLI refuses stale evidence and records head, attempt, and base metadata", () => {
  const result = cli([
    job("Select validation"),
    job("Frontend E2E (1/8)", { startedAt: "2026-08-29T09:00:00Z" }),
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing carried-forward or stale upstream evidence/);
  assert.match(result.stderr, /before the current attempt started/);
  assert.match(result.stdout, /Expected workflow head:/);
  assert.match(result.stdout, new RegExp(`Run base: main@${RUN_BASE}`));
  assert.match(result.stdout, /Frontend E2E \(1\/8\):/);
});

test("the CLI passes a fresh gh api jobs envelope", () => {
  const result = cli({
    total_count: 2,
    jobs: [
      job("Select validation", { id: 1 }),
      job("Frontend validation (lint)", { id: 2 }),
    ],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Live base: main@/);
  assert.match(result.stdout, /Frontend validation \(lint\):/);
});

test("missing or malformed required CLI metadata is a usage error", () => {
  const missing = spawnSync(process.execPath, [SCRIPT], {
    input: "[]",
    encoding: "utf8",
  });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--expected-head-sha must be a 40-hex SHA/);

  const malformedTime = cli([job("Select validation")], {
    attemptStartedAt: "not-a-time",
  });
  assert.equal(malformedTime.status, 2);
  assert.match(malformedTime.stderr, /--attempt-started-at must be a valid timestamp/);
});

test("evidence prefixes match every workflow family", () => {
  assert.deepEqual([...EVIDENCE_JOB_PREFIXES].sort(), [
    "Frontend E2E",
    "Frontend bundle",
    "Frontend validation",
    "iOS build",
    "Select validation",
  ].sort());
});

test("the workflow supplies same-domain head, timestamp, and exact base evidence", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const build = workflow.match(/^  build:\n[\s\S]*$/m)?.[0];
  assert.ok(build, "CI must retain the Frontend build job");

  assert.match(
    build,
    /EXPECTED_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| inputs\.expected_sha \|\| github\.sha \}\}/,
    "Actions job head_sha must be compared with the PR/workflow head, never the merge SHA",
  );
  assert.doesNotMatch(
    build,
    /CURRENT_SHA: \$\{\{ github\.sha \}\}/,
    "github.sha is a synthetic merge SHA on pull_request and is the wrong comparison domain",
  );
  assert.match(build, /actions\/runs\/\$RUN_ID" > \/tmp\/cave-build-evidence-run\.json/);
  assert.match(build, /\.run_started_at/);
  assert.match(build, /RUN_BASE_REF: \$\{\{ needs\.paths\.outputs\.run_base_ref \}\}/);
  assert.match(build, /RUN_BASE_SHA: \$\{\{ needs\.paths\.outputs\.run_base_sha \}\}/);
  assert.doesNotMatch(
    build,
    /\.pull_requests\[\]/,
    "the final gate must not reconstruct a dispatch base from stale Actions-run PR metadata",
  );
  assert.match(build, /git\/ref\/heads\/\$RUN_BASE_REF/);
  for (const flag of [
    "--expected-head-sha",
    "--attempt-started-at",
    "--run-base-ref",
    "--run-base-sha",
    "--live-base-sha",
  ]) {
    assert.match(build, new RegExp(flag), `${flag} must reach the evidence checker`);
  }
  assert.match(
    build,
    /< \/tmp\/cave-build-evidence-jobs\.json 2>&1 \| tee -a "\$GITHUB_STEP_SUMMARY"/,
    "both the evidence and refusal reasons must be retained in the job summary",
  );
});
