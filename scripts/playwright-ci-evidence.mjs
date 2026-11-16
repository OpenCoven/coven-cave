// A successful Playwright process may have an empty shard (#6392). Collect a
// plan before starting its server, then require matching, executed result
// evidence. Keep serial groups intact and retain generated reports on failure.
// Builtins only: validation can load this checker from its workflow revision
// while keeping the working directory and Playwright version of an older ref.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const outcomes = ["expected", "unexpected", "flaky", "skipped"];
const resultStatuses = new Set(["passed", "failed", "timedOut", "skipped", "interrupted"]);

function identitySha256(cases) {
  return createHash("sha256").update(JSON.stringify([...cases.keys()].sort())).digest("hex");
}

function reportCases(report) {
  if (!report || !Array.isArray(report.suites) || !Array.isArray(report.errors))
    throw new Error("Playwright report is missing its suites or errors array");
  if (report.errors.length) throw new Error("Playwright reported collection or run errors");
  const cases = new Map();
  const counts = Object.fromEntries(outcomes.map(name => [name, 0]));
  function visit(suite) {
    if (!suite || (suite.suites !== undefined && !Array.isArray(suite.suites))
      || (suite.specs !== undefined && !Array.isArray(suite.specs)))
      throw new Error("Invalid Playwright suite");
    for (const spec of suite.specs ?? []) {
      if (typeof spec.id !== "string" || !spec.id || !Array.isArray(spec.tests) || !spec.tests.length)
        throw new Error("Invalid Playwright spec identity or cases");
      for (const test of spec.tests) {
        const project = test.projectId ?? test.projectName;
        if (typeof project !== "string" || !outcomes.includes(test.status) || !Array.isArray(test.results))
          throw new Error("Invalid Playwright test identity, outcome or results");
        const key = JSON.stringify([project, spec.id]);
        if (cases.has(key)) throw new Error("Duplicate Playwright test identity");
        cases.set(key, test);
        counts[test.status]++;
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites) visit(suite);
  for (const name of outcomes) {
    if (!Number.isSafeInteger(report.stats?.[name]) || report.stats[name] < 0
      || report.stats[name] !== counts[name])
      throw new Error(`Playwright ${name} count does not match its test identities`);
  }
  return { cases, counts };
}

export function plannedPlaywrightCases(report) {
  const plan = reportCases(report);
  if (!plan.cases.size) throw new Error("Playwright selected zero tests; refusing an empty shard");
  return plan;
}

export function verifyPlaywrightEvidence(planReport, resultReport) {
  const plan = plannedPlaywrightCases(planReport);
  const actual = reportCases(resultReport);
  if (plan.cases.size !== actual.cases.size
    || [...plan.cases.keys()].some(key => !actual.cases.has(key)))
    throw new Error(`Playwright results do not match the declared test identities (planned ${plan.cases.size}, reported ${actual.cases.size})`);
  let executed = 0;
  let attempts = 0;
  let retries = 0;
  for (const test of actual.cases.values()) {
    let ran = false;
    for (const result of test.results) {
      if (!resultStatuses.has(result.status) || !Number.isSafeInteger(result.retry) || result.retry < 0)
        throw new Error("Invalid Playwright execution result");
      if (result.status === "interrupted") throw new Error("Playwright execution was interrupted");
      if (result.status !== "skipped") {
        ran = true;
        attempts++;
        if (result.retry > 0) retries++;
      }
    }
    if (test.status !== "skipped" && !ran)
      throw new Error("A non-skipped Playwright case has no execution result");
    if (ran) executed++;
  }
  const counts = { planned: plan.cases.size, executed, ...actual.counts, attempts, retries,
    identitySha256: identitySha256(actual.cases) };
  if (!executed) throw Object.assign(new Error("Playwright has zero executed tests; skipped or listed cases are not execution"), { counts });
  if (actual.counts.unexpected) throw Object.assign(new Error("Playwright has unexpected test outcomes"), { counts });
  return counts;
}

function readReport(filename) {
  try { return JSON.parse(readFileSync(filename, "utf8")); }
  catch { throw new Error(`Missing or invalid Playwright JSON report: ${path.basename(filename)}`); }
}

function defaultRunner(args, env, root) {
  return spawnSync("bash", ["scripts/playwright-ci-image.sh", "run", "pnpm", "exec", "playwright", "test", ...args], {
    cwd: root, env, stdio: "inherit",
  });
}

function failureStatus(result) {
  return Number.isInteger(result?.status) && result.status > 0 ? result.status : 1;
}

export function runPlaywrightWithEvidence(args, { root = process.cwd(), runner = defaultRunner, env = process.env } = {}) {
  if (args.some(arg => arg === "--list" || arg.startsWith("--list=")
    || arg === "--reporter" || arg.startsWith("--reporter=")))
    throw new Error("The evidence runner owns --list and --reporter");
  const evidenceRoot = path.join(root, "playwright-evidence");
  mkdirSync(evidenceRoot, { recursive: true });
  // A new directory prevents a missing report from reusing an earlier run's
  // JSON. It lives outside test-results, which Playwright clears on startup.
  const directory = mkdtempSync(path.join(evidenceRoot, "run-"));
  const planFile = path.join(directory, "plan.json");
  const resultFile = path.join(directory, "results.json");
  const summary = {
    version: 1, arguments: args, phase: "collection", passed: false,
    runId: env.GITHUB_RUN_ID ?? null, runAttempt: env.GITHUB_RUN_ATTEMPT ?? null,
    workflowSha: env.GITHUB_SHA ?? null,
    workflowDefinitionSha: env.GITHUB_WORKFLOW_SHA ?? null,
  };
  let status = 1;
  try {
    const collected = runner([...args, "--list", "--reporter=json"], {
      ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: planFile,
    }, root);
    summary.collectionExit = { status: collected.status, signal: collected.signal ?? null };
    if (collected.status !== 0) {
      status = failureStatus(collected);
      throw new Error("Playwright collection process failed");
    }
    const plan = readReport(planFile);
    const declared = reportCases(plan);
    summary.planned = declared.cases.size;
    summary.identitySha256 = identitySha256(declared.cases);
    if (!summary.planned) throw new Error("Playwright selected zero tests; refusing an empty shard");
    console.log(`[e2e-evidence] selected ${summary.planned} declared tests; identities=${summary.identitySha256}`);
    summary.phase = "execution";
    const executed = runner([...args, "--reporter=github,line,json"], {
      ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: resultFile,
    }, root);
    summary.executionExit = { status: executed.status, signal: executed.signal ?? null };
    status = failureStatus(executed);
    summary.phase = "verification";
    summary.counts = verifyPlaywrightEvidence(plan, readReport(resultFile));
    if (executed.status !== 0) throw new Error("Playwright execution process failed");
    summary.passed = true;
    summary.phase = "complete";
    status = 0;
    console.log(`[e2e-evidence] ${JSON.stringify(summary.counts)}`);
  } catch (error) {
    summary.error = error.message;
    if (error.counts) summary.counts = error.counts;
    console.error(`[e2e-evidence] ${summary.phase}: ${error.message}`);
    if (summary.counts) console.error(`[e2e-evidence] ${JSON.stringify(summary.counts)}`);
  } finally {
    writeFileSync(path.join(directory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`[e2e-evidence] reports: ${path.relative(root, directory)}`);
  }
  return { status, summary, directory };
}

if (process.argv[1] && existsSync(process.argv[1])
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try { process.exitCode = runPlaywrightWithEvidence(process.argv.slice(2)).status; }
  catch (error) { console.error(`[e2e-evidence] ${error.message}`); process.exitCode = 1; }
}
