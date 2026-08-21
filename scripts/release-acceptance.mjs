#!/usr/bin/env node
// cave-udcn7 — three-OS release acceptance evidence (Chat v1 Phase 7, Task 12).
//
//   node scripts/release-acceptance.mjs template <version> > record.json
//   node scripts/release-acceptance.mjs validate docs/release-acceptance-results/<tag>.json
//
// The acceptance journey itself is run by a human operator, on real machines,
// against signed artifacts — nothing in this file executes it. What this module
// does is make the *evidence* machine-checkable, so "acceptance passed" becomes
// a claim the rollout gate can refuse rather than a sentence in a release
// issue:
//
//   - every supported OS appears exactly once,
//   - every journey step and every global-CLI step is recorded with a result,
//   - the candidate version/tag/commit and artifact digests are well formed,
//   - no credential-shaped text rides along in the committed evidence.
//
// `summarizeAcceptance()` is what scripts/release-rollout.mjs consumes: rollout
// may not begin until the summary reports `complete`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ACCEPTANCE_OSES = ["macos", "windows", "linux"];

// The twelve desktop steps of the acceptance journey, in the order an operator
// performs them. Order matters for the printed report and for the template.
export const JOURNEY_STEPS = [
  { id: "install-cave", title: "Install a supported Cave build" },
  { id: "install-chat", title: "Install Chat with no developer tools present" },
  { id: "discover-cave", title: "Discover and start Cave from Chat" },
  { id: "pair-approve", title: "Pair the client and approve it in Cave" },
  { id: "load-lists", title: "Load familiar and conversation lists" },
  { id: "create-send", title: "Create a conversation and send a message" },
  { id: "disconnect-resume", title: "Disconnect and resume without message loss" },
  { id: "restart-history", title: "Restart both sides and verify canonical history" },
  { id: "attachment", title: "Upload an attachment and reopen it" },
  { id: "safe-action", title: "Confirm one safe action in a test repository" },
  { id: "revoke-pairing", title: "Revoke the client and return to pairing" },
  { id: "update-migration", title: "Update Chat and verify preference/keychain/cache migration" },
];

// Global `opencoven` CLI acceptance, installed from the published package
// rather than a source checkout.
export const CLI_STEPS = [
  { id: "cli-install", title: "Install @opencoven/dev-cli globally" },
  { id: "cli-doctor", title: "Run opencoven doctor" },
  { id: "cli-pair", title: "Pair the CLI against Cave" },
  { id: "cli-session", title: "Inspect Coven sessions" },
  { id: "cli-send", title: "Send a test conversation message" },
  { id: "cli-tail", title: "Tail that conversation" },
  { id: "cli-scaffold", title: "Execute every scaffold" },
];

export const ALL_STEPS = [...JOURNEY_STEPS, ...CLI_STEPS];
export const REQUIRED_STEP_IDS = ALL_STEPS.map((step) => step.id);

// `pending` means nobody has attempted the step yet, which is what a fresh
// template is full of. `blocked` and `fail` are outcomes an operator observed,
// so both owe a diagnostic id; `pending` owes nothing.
export const STEP_RESULTS = ["pending", "pass", "fail", "blocked"];
export const DIAGNOSED_RESULTS = ["fail", "blocked"];

const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const TAG_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

// Evidence is committed to the repository, so it is exactly the wrong place
// for a token. These are the shapes that have actually leaked into release
// notes and issue bodies elsewhere; the list is deliberately short and literal
// rather than a general entropy heuristic, which would flag every checksum.
// Every pattern here is anchored on a literal prefix or delimiter a credential
// carries and a checksum does not, which is why a 64-hex digest and a 40-hex
// commit SHA — both all over a legitimate record — cannot trip any of them.
const SECRET_PATTERNS = [
  { id: "github-pat", pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/ },
  { id: "github-fine-grained-pat", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { id: "private-key", pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
  // The three below are the shapes this record in particular invites. The
  // journey pairs a client and pairs a CLI, so an operator pasting a `cli-pair`
  // or `pair-approve` diagnostic is pasting exactly an Authorization header, a
  // callback url, or a workspace token.
  { id: "slack-token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/ },
  { id: "bearer-credential", pattern: /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{20,}={0,2}/ },
  {
    id: "credential-in-url",
    pattern: /[?&](?:token|access_token|api_key|apikey|secret|password)=[^\s&"']{8,}/i,
  },
];

/** A blank record an operator fills in, with every required step present. */
export function blankAcceptanceRecord(version = "0.0.0") {
  const steps = {};
  for (const id of REQUIRED_STEP_IDS) {
    steps[id] = { result: "pending", diagnosticId: "", notes: "" };
  }
  return {
    candidate: { version, tag: `v${version}`, commit: "" },
    artifacts: [{ name: "", sha256: "" }],
    runs: ACCEPTANCE_OSES.map((os) => ({
      os,
      osVersion: "",
      caveVersion: "",
      chatVersion: version,
      cliVersion: version,
      steps: structuredClone(steps),
    })),
  };
}

/**
 * Validate an acceptance record.
 *
 * Returns every problem it finds rather than throwing on the first, so an
 * operator repairs the whole file in one pass. `status` is the field the
 * rollout gate reads:
 *   - `failed`     — at least one step is recorded as a failure.
 *   - `complete`   — all three OSes present and every required step passed.
 *   - `incomplete` — anything else (missing OS, missing step, still blocked).
 */
export function validateAcceptanceRecord(record) {
  const errors = [];
  const add = (message) => errors.push(message);

  if (!isPlainObject(record)) {
    return { ok: false, status: "incomplete", errors: ["record must be a JSON object"], runs: [] };
  }

  validateCandidate(record.candidate, add);
  validateArtifacts(record.artifacts, add);
  const runs = validateRuns(record.runs, add);

  for (const finding of findSecrets(record)) {
    add(`possible ${finding.id} committed at ${finding.path}`);
  }

  const failed = runs.some((run) => run.failedSteps.length > 0);
  const complete =
    errors.length === 0 &&
    ACCEPTANCE_OSES.every((os) => runs.some((run) => run.os === os && run.status === "pass"));
  const status = failed ? "failed" : complete ? "complete" : "incomplete";

  return { ok: errors.length === 0 && status === "complete", status, errors, runs };
}

/** The compact shape scripts/release-rollout.mjs consumes. */
export function summarizeAcceptance(record) {
  const result = validateAcceptanceRecord(record);
  return {
    status: result.status,
    errors: result.errors,
    oses: result.runs.map((run) => ({ os: run.os, status: run.status })),
    missingOses: ACCEPTANCE_OSES.filter((os) => !result.runs.some((run) => run.os === os)),
  };
}

function validateCandidate(candidate, add) {
  if (!isPlainObject(candidate)) {
    add("candidate must be an object with version, tag, and commit");
    return;
  }
  const version = readString(candidate.version);
  const tag = readString(candidate.tag);
  const commit = readString(candidate.commit);
  if (!VERSION_PATTERN.test(version)) {
    add(`candidate.version '${show(candidate.version)}' is not a release version`);
  }
  if (!TAG_PATTERN.test(tag)) {
    add(`candidate.tag '${show(candidate.tag)}' is not a release tag`);
  } else if (VERSION_PATTERN.test(version) && tag !== `v${version}`) {
    add(`candidate.tag ${tag} does not match candidate.version ${version}`);
  }
  if (!COMMIT_PATTERN.test(commit.toLowerCase())) {
    add("candidate.commit must be a 40-hex commit SHA");
  }
}

function validateArtifacts(artifacts, add) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    add("artifacts must be a non-empty array of {name, sha256}");
    return;
  }
  const seen = new Set();
  artifacts.forEach((artifact, index) => {
    if (!isPlainObject(artifact)) {
      add(`artifacts[${index}] must be an object`);
      return;
    }
    const name = readString(artifact.name);
    if (!name.trim()) add(`artifacts[${index}].name is required`);
    else if (seen.has(name)) add(`artifacts[${index}].name '${name}' is duplicated`);
    else seen.add(name);
    if (!SHA256_PATTERN.test(readString(artifact.sha256).toLowerCase())) {
      add(`artifacts[${index}].sha256 must be a 64-hex SHA-256 digest`);
    }
  });
}

function validateRuns(runs, add) {
  if (!Array.isArray(runs) || runs.length === 0) {
    add("runs must be a non-empty array, one entry per operating system");
    return [];
  }

  const summaries = [];
  const seen = new Set();

  runs.forEach((run, index) => {
    if (!isPlainObject(run)) {
      add(`runs[${index}] must be an object`);
      return;
    }
    const os = readString(run.os);
    if (!ACCEPTANCE_OSES.includes(os)) {
      add(`runs[${index}].os '${show(run.os)}' is not one of ${ACCEPTANCE_OSES.join(", ")}`);
      return;
    }
    if (seen.has(os)) {
      add(`runs[${index}] repeats os '${os}'; record one run per operating system`);
      return;
    }
    seen.add(os);

    for (const field of ["osVersion", "caveVersion", "chatVersion", "cliVersion"]) {
      if (!String(run[field] ?? "").trim()) add(`runs[${index}].${field} is required`);
    }

    summaries.push(validateSteps(run, index, os, add));
  });

  for (const os of ACCEPTANCE_OSES) {
    if (!seen.has(os)) add(`no acceptance run recorded for ${os}`);
  }

  return summaries;
}

function validateSteps(run, index, os, add) {
  const steps = isPlainObject(run.steps) ? run.steps : null;
  if (!steps) {
    add(`runs[${index}].steps must be an object keyed by step id`);
    return { os, status: "incomplete", failedSteps: [], pendingSteps: [...REQUIRED_STEP_IDS] };
  }

  for (const id of Object.keys(steps)) {
    if (!REQUIRED_STEP_IDS.includes(id)) add(`runs[${index}].steps has unknown step '${id}'`);
  }

  const failedSteps = [];
  const pendingSteps = [];

  for (const id of REQUIRED_STEP_IDS) {
    const step = steps[id];
    if (!isPlainObject(step)) {
      add(`runs[${index}].steps.${id} is missing`);
      pendingSteps.push(id);
      continue;
    }
    const result = readString(step.result);
    if (!STEP_RESULTS.includes(result)) {
      add(`runs[${index}].steps.${id}.result '${show(step.result)}' must be one of ${STEP_RESULTS.join(", ")}`);
      pendingSteps.push(id);
      continue;
    }
    // An observed failure is only actionable if it points at a diagnostic.
    // A step nobody has attempted yet owes nothing.
    if (DIAGNOSED_RESULTS.includes(result) && !String(step.diagnosticId ?? "").trim()) {
      add(`runs[${index}].steps.${id} is '${result}' and needs a diagnosticId`);
    }
    if (result === "fail") failedSteps.push(id);
    else if (result !== "pass") pendingSteps.push(id);
  }

  const status = failedSteps.length ? "fail" : pendingSteps.length ? "incomplete" : "pass";
  return { os, status, failedSteps, pendingSteps };
}

/**
 * Walk the record and report credential-shaped strings with their JSON path.
 *
 * Iterative on purpose. The recursive form overflowed the stack at about five
 * thousand levels of nesting, while `JSON.parse` accepts a hundred thousand
 * without complaint — so a pathological record made `validateAcceptanceRecord`
 * throw `RangeError: Maximum call stack size exceeded` instead of returning the
 * problems it documents itself as always returning. `seen` terminates on a
 * cyclic object too: `JSON.parse` cannot build one, but this is exported and
 * other callers are not bound by that.
 */
export function findSecrets(value, path = "record", found = []) {
  const seen = new Set();
  const stack = [[value, path]];
  while (stack.length > 0) {
    const [current, currentPath] = stack.pop();
    if (typeof current === "string") {
      for (const { id, pattern } of SECRET_PATTERNS) {
        if (pattern.test(current)) found.push({ id, path: currentPath });
      }
      continue;
    }
    if (current === null || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    // Pushed in reverse so the stack pops them in document order, which is the
    // order an operator reads their own file in.
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push([current[index], `${currentPath}[${index}]`]);
      }
      continue;
    }
    const entries = Object.entries(current);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      stack.push([entries[index][1], `${currentPath}.${entries[index][0]}`]);
    }
  }
  return found;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a field whose value has to match a pattern or a fixed vocabulary.
 *
 * `String(["pass"])` is `"pass"` and `String(["macos"])` is `"macos"`, so every
 * allow-list and every regex here accepted a one-element array holding the
 * right word: a step recorded as `["pass"]` counted as passed, and a record
 * whose `os`, `version`, `tag`, `commit` and `sha256` were all wrapped that way
 * validated `complete`. An evidence record is generated as often as it is
 * typed, and that is exactly the shape a templating mistake produces. A value
 * that is not a string states nothing, so it reads as the empty string and
 * fails the check it was pretending to pass.
 */
function readString(value) {
  return typeof value === "string" ? value : "";
}

/**
 * Show a value as it sits in the file, so an array does not print as its
 * contents. Total on purpose: `JSON.stringify` throws on a cycle or a BigInt,
 * and this feeds an error message inside a function that documents itself as
 * always returning its problems rather than throwing one.
 */
function show(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

export function formatReport(result) {
  const lines = [`acceptance: ${result.status}`];
  for (const os of ACCEPTANCE_OSES) {
    const run = result.runs.find((entry) => entry.os === os);
    if (!run) {
      lines.push(`  - ${os}: not recorded`);
      continue;
    }
    const detail =
      run.status === "pass"
        ? "all steps passed"
        : run.status === "fail"
          ? `failed: ${run.failedSteps.join(", ")}`
          : `pending: ${run.pendingSteps.join(", ")}`;
    lines.push(`  - ${os}: ${run.status} (${detail})`);
  }
  for (const error of result.errors) lines.push(`  ✗ ${error}`);
  return lines.join("\n");
}

const ACCEPTANCE_USAGE = "usage: release-acceptance.mjs <template|steps|validate> [argument]";

export function runCli({ argv = process.argv.slice(2), readFileImpl = readFileSync, log = console.log } = {}) {
  // No options exist, and no subcommand takes more than one argument. Saying so
  // beats accepting a misspelling and validating a file the operator did not
  // name.
  const flags = argv.filter((entry) => entry.startsWith("--"));
  if (flags.length > 0) throw new Error(`unknown option '${flags[0]}'; ${ACCEPTANCE_USAGE}`);
  const [command, argument, ...rest] = argv;
  if (rest.length > 0) throw new Error(`unexpected argument '${rest[0]}'; ${ACCEPTANCE_USAGE}`);

  if (command === "template") {
    log(JSON.stringify(blankAcceptanceRecord(argument || "0.0.0"), null, 2));
    return 0;
  }

  if (command === "steps") {
    for (const step of ALL_STEPS) log(`${step.id}\t${step.title}`);
    return 0;
  }

  if (command === "validate") {
    if (!argument) throw new Error("usage: release-acceptance.mjs validate <record.json>");
    let record;
    try {
      record = JSON.parse(readFileImpl(argument, "utf8"));
    } catch (error) {
      throw new Error(`could not read acceptance record ${argument}: ${error.message}`);
    }
    const result = validateAcceptanceRecord(record);
    log(formatReport(result));
    return result.ok ? 0 : 1;
  }

  throw new Error(ACCEPTANCE_USAGE);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(`release-acceptance: ${error.message}`);
    process.exitCode = 1;
  }
}
