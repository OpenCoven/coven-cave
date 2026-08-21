// @ts-nocheck
// cave-udcn7 — acceptance evidence validation.
//
// The point of these tests is that "acceptance passed" stops being a sentence
// somebody wrote and becomes a claim with a shape: three operating systems,
// every journey step, real digests, and no credentials riding along.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCEPTANCE_OSES,
  ALL_STEPS,
  CLI_STEPS,
  JOURNEY_STEPS,
  REQUIRED_STEP_IDS,
  blankAcceptanceRecord,
  findSecrets,
  formatReport,
  runCli,
  summarizeAcceptance,
  validateAcceptanceRecord,
} from "./release-acceptance.mjs";

const COMMIT = "a".repeat(40);
const DIGEST = "b".repeat(64);

function passingSteps(overrides = {}) {
  const steps = {};
  for (const id of REQUIRED_STEP_IDS) steps[id] = { result: "pass", diagnosticId: "", notes: "" };
  return { ...steps, ...overrides };
}

function passingRecord(overrides = {}) {
  return {
    candidate: { version: "1.0.0", tag: "v1.0.0", commit: COMMIT },
    artifacts: [{ name: "CovenCave-v1.0.0-aarch64.dmg", sha256: DIGEST }],
    runs: ACCEPTANCE_OSES.map((os) => ({
      os,
      osVersion: "test",
      caveVersion: "0.3.6",
      chatVersion: "1.0.0",
      cliVersion: "1.0.0",
      steps: passingSteps(),
    })),
    ...overrides,
  };
}

test("the journey covers the desktop steps and the global CLI steps exactly once", () => {
  assert.equal(
    ALL_STEPS.length,
    JOURNEY_STEPS.length + CLI_STEPS.length,
    "ALL_STEPS is the concatenation, so a step added to either list must appear here",
  );
  assert.equal(
    new Set(REQUIRED_STEP_IDS).size,
    REQUIRED_STEP_IDS.length,
    "a duplicated step id would let one recorded result satisfy two obligations",
  );
  for (const id of ["pair-approve", "revoke-pairing", "update-migration", "cli-doctor", "cli-scaffold"]) {
    assert.ok(REQUIRED_STEP_IDS.includes(id), `${id} is named in the acceptance criteria and must be recorded`);
  }
});

test("a blank record is well formed but never counts as acceptance", () => {
  const record = blankAcceptanceRecord("1.2.3");
  assert.deepEqual(
    record.runs.map((run) => run.os),
    ACCEPTANCE_OSES,
    "the template pre-seeds one run per supported OS so an operator cannot forget one",
  );
  for (const run of record.runs) {
    assert.deepEqual(
      Object.keys(run.steps).sort(),
      [...REQUIRED_STEP_IDS].sort(),
      "every required step is present in the template, waiting to be filled in",
    );
  }
  const result = validateAcceptanceRecord(record);
  assert.equal(result.ok, false, "an unfilled template must not validate — that is the whole failure mode");
  assert.notEqual(result.status, "complete", "pending steps are not passes");
  assert.equal(
    result.errors.filter((error) => error.includes("diagnosticId")).length,
    0,
    "a step nobody has attempted owes no diagnostic; demanding one buries the real gaps in noise",
  );
});

test("a fully recorded run validates as complete", () => {
  const result = validateAcceptanceRecord(passingRecord());
  assert.deepEqual(result.errors, [], "a well-formed record should produce no errors");
  assert.equal(result.status, "complete", "three OSes with every step passing is what complete means");
  assert.equal(result.ok, true, "ok tracks status === complete with no errors");
});

test("a missing operating system blocks completion by name", () => {
  const record = passingRecord();
  record.runs = record.runs.filter((run) => run.os !== "windows");
  const result = validateAcceptanceRecord(record);
  assert.equal(result.status, "incomplete", "two of three OSes is not acceptance");
  assert.ok(
    result.errors.some((error) => error.includes("windows")),
    "the error names the missing OS so the operator knows which machine to go find",
  );
  assert.deepEqual(
    summarizeAcceptance(record).missingOses,
    ["windows"],
    "the rollout gate reads missingOses, so it must list the gap rather than merely fail",
  );
});

test("a recorded failure is louder than a recorded gap", () => {
  const record = passingRecord();
  record.runs[0].steps["restart-history"] = { result: "fail", diagnosticId: "diag-1" };
  const result = validateAcceptanceRecord(record);
  assert.equal(result.status, "failed", "a failed step is a different state from an unfinished one");
  assert.deepEqual(
    result.runs.find((run) => run.os === record.runs[0].os).failedSteps,
    ["restart-history"],
    "the failing step is named so the rollout gate can quote it",
  );
});

test("an observed failure without a diagnostic id is not evidence", () => {
  for (const result of ["blocked", "fail"]) {
    const record = passingRecord();
    record.runs[1].steps["attachment"] = { result, diagnosticId: "  " };
    const validated = validateAcceptanceRecord(record);
    assert.ok(
      validated.errors.some((error) => error.includes("attachment") && error.includes("diagnosticId")),
      `a '${result}' nobody can look up later is a note, not a diagnosis`,
    );
  }

  const pending = passingRecord();
  pending.runs[1].steps["attachment"] = { result: "pending", diagnosticId: "" };
  assert.deepEqual(
    validateAcceptanceRecord(pending).errors,
    [],
    "an unattempted step is a gap in coverage, not a defect needing a diagnosis",
  );
});

test("structural mistakes in the record are all reported together", () => {
  const record = passingRecord();
  record.candidate.tag = "v9.9.9";
  record.artifacts = [{ name: "installer.msi", sha256: "not-a-digest" }];
  record.runs[0].steps["unknown-step"] = { result: "pass" };
  record.runs.push({ ...record.runs[0], os: "macos" });

  const result = validateAcceptanceRecord(record);
  const joined = result.errors.join("\n");
  assert.match(joined, /does not match candidate.version/, "a tag that disagrees with the version fails");
  assert.match(joined, /sha256/, "an artifact digest that is not 64 hex characters fails");
  assert.match(joined, /unknown step 'unknown-step'/, "a step id nobody defined is a typo, not extra evidence");
  assert.match(joined, /repeats os 'macos'/, "two runs for one OS means one of them is unreviewed");
  assert.ok(result.errors.length >= 4, "every problem is collected so the file is repaired in one pass");
});

test("credential-shaped text in the evidence is refused", () => {
  const record = passingRecord();
  record.runs[0].steps["cli-pair"] = {
    result: "pass",
    notes: "paired with ghp_abcdefghijklmnopqrstuvwxyz0123456789",
  };
  const result = validateAcceptanceRecord(record);
  assert.ok(
    result.errors.some((error) => error.includes("github-pat")),
    "acceptance evidence is committed, so a token in it is a leak the validator has to catch",
  );

  const found = findSecrets({ notes: "-----BEGIN OPENSSH PRIVATE KEY-----" });
  assert.equal(found.length, 1, "a private key block is detected wherever it sits in the record");
  assert.equal(found[0].path, "record.notes", "the finding points at the field so it can be redacted");
});

test("the credential shapes this journey invites are caught", () => {
  // Assembled rather than written out: GitHub push protection scans this file
  // too, and it rejects a literal token-shaped string even when the token is
  // invented. A fixture that cannot be pushed is not a fixture.
  const slackLookalike = ["xoxb", "2381910230", "2384823281", "notarealslacktoken"].join("-");
  const bearerLookalike = `Bearer ${["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJub3QtYS1qd3QifQ"].join(".")}`;
  const cases = [
    ["slack-token", `posted to ${slackLookalike}`],
    ["bearer-credential", `curl -H 'Authorization: ${bearerLookalike}'`],
    ["credential-in-url", "callback hit http://127.0.0.1:7331/pair?token=s3cr3t-pairing-code-9f21"],
  ];
  for (const [id, note] of cases) {
    const record = passingRecord();
    record.runs[0].steps["cli-pair"] = { result: "pass", notes: note };
    assert.ok(
      validateAcceptanceRecord(record).errors.some((error) => error.includes(id)),
      `pairing is step four of the journey, so a ${id} is what an operator's own diagnostic paste looks like`,
    );
  }
});

test("a checksum is not mistaken for a secret", () => {
  // Asserted against findSecrets directly rather than through a passing record:
  // "the record validates clean" would also pass against a scanner that never
  // ran, which is the assertion this test exists to not make.
  assert.deepEqual(
    findSecrets({
      sha256: DIGEST,
      commit: COMMIT,
      artifact: `CovenCave-v1.0.0-aarch64.dmg  ${DIGEST}`,
      url: "https://github.com/OpenCoven/coven-cave/releases/download/v1.0.0/latest.json",
      prose: "the bearer token was rejected until the client re-paired",
    }),
    [],
    "digests and commit SHAs are long hex strings; an entropy heuristic would flag every one of them",
  );
});

test("a deeply nested record is reported on rather than overflowing the stack", () => {
  // JSON.parse accepts far deeper nesting than a recursive scan survives, so
  // the recursive form turned a malformed file into RangeError instead of the
  // error list validateAcceptanceRecord promises to always return.
  const deep = JSON.parse(`${"[".repeat(20000)}"ghp_abcdefghijklmnopqrstuvwxyz0123456789"${"]".repeat(20000)}`);
  const record = passingRecord({ artifacts: [{ name: "deep", sha256: DIGEST, notes: deep }] });
  const errors = validateAcceptanceRecord(record).errors;
  assert.ok(
    errors.some((error) => error.includes("github-pat")),
    "the scan still reaches a credential buried at the bottom of the nesting",
  );

  const cyclic = { notes: {} };
  cyclic.notes.parent = cyclic;
  assert.deepEqual(findSecrets(cyclic), [], "a cycle terminates the walk instead of running until the stack dies");
});

test("a run whose steps are not an object is a gap, not a pass", () => {
  for (const steps of [[], "install-cave: pass", null, 7]) {
    const record = passingRecord();
    record.runs[0].steps = steps;
    const result = validateAcceptanceRecord(record);
    assert.equal(
      result.status,
      "incomplete",
      `steps recorded as ${JSON.stringify(steps)} record nothing, and nothing is not twelve passes`,
    );
    assert.ok(
      result.errors.some((error) => error.includes("steps must be an object")),
      "the operator is told the shape their evidence has to take",
    );
    assert.deepEqual(
      result.runs.find((run) => run.os === "macos").pendingSteps,
      REQUIRED_STEP_IDS,
      "every required step is outstanding, so the report cannot read as partial coverage",
    );
  }
});

test("the CLI validates, templates, and reports exit codes", () => {
  const lines = [];
  const log = (line) => lines.push(line);

  assert.equal(
    runCli({ argv: ["validate", "record.json"], readFileImpl: () => JSON.stringify(passingRecord()), log }),
    0,
    "a complete record exits 0 so CI can gate on it",
  );

  const blank = blankAcceptanceRecord("1.0.0");
  assert.equal(
    runCli({ argv: ["validate", "record.json"], readFileImpl: () => JSON.stringify(blank), log }),
    1,
    "an incomplete record exits non-zero",
  );

  assert.equal(runCli({ argv: ["template", "1.0.0"], log }), 0, "template emits a starting point");
  assert.throws(
    () => runCli({ argv: ["validate"], log }),
    /usage/,
    "a missing path is a usage error rather than a confusing read failure",
  );
  assert.throws(() => runCli({ argv: ["nonsense"], log }), /usage/, "an unknown command prints usage");
  assert.throws(() => runCli({ argv: [], log }), /usage/, "no arguments at all prints usage rather than doing nothing");
  assert.throws(
    () => runCli({ argv: ["validate", "--strict", "record.json"], readFileImpl: () => "{}", log }),
    /unknown option '--strict'/,
    "an option this CLI does not have must not be dropped; the operator asked for behavior it will not get",
  );
  assert.throws(
    () => runCli({ argv: ["validate", "a.json", "b.json"], readFileImpl: () => "{}", log }),
    /unexpected argument 'b.json'/,
    "two record paths is ambiguous, and quietly validating the first one hides which was checked",
  );
});

test("the report names the state of every operating system", () => {
  const report = formatReport(validateAcceptanceRecord(passingRecord()));
  for (const os of ACCEPTANCE_OSES) {
    assert.ok(report.includes(os), `${os} appears in the report even when it passed, so coverage is visible`);
  }
});
