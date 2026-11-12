// Shared verification for a browser performance gate's positive control
// (`pnpm performance:stream --control`, `pnpm performance:shell --control`).
// The deliberate failure must fail each unit (stream pattern, shell boot mode)
// on its latency assertion alone, with complete samples from the expected
// clean head and no runner errors, retries or skips. The gates describe
// themselves through `options`; the checks live here once.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function resultsIn(suites) {
  return suites.flatMap(suite => [
    ...(suite.specs ?? []).flatMap(spec => spec.tests.map(test => test.results)),
    ...resultsIn(suite.suites ?? []),
  ]);
}

/**
 * @param {object} options
 * @param {readonly string[]} options.units      the pattern/mode names, in order
 * @param {string} options.unitKey                the report field naming the unit
 * @param {(unit: string, samples: unknown) => {p95Ms: number|null, failures: string[]}} options.evaluate
 * @param {(unit: string) => number} options.limitFor
 * @param {string} options.sampleMetric           the per-sample field the control inflates
 * @param {number} options.controlTrials          how many leading trials the control stalls
 */
export function verifyBrowserControl(exitCode, reports, runner, expectedHead, options) {
  const { units, unitKey, evaluate, limitFor, sampleMetric, controlTrials } = options;
  if (exitCode !== 1 || !Array.isArray(reports) || reports.length !== units.length ||
      typeof expectedHead !== "string" || !/^[a-f0-9]{40}$/.test(expectedHead) ||
      runner?.errors?.length !== 0 || runner?.stats?.unexpected !== units.length ||
      runner.stats.expected !== 0 || runner.stats.skipped !== 0 || runner.stats.flaky !== 0) {
    throw new Error(`Expected exactly ${units.length} failed control tests without runner errors or retries`);
  }
  const results = resultsIn(runner.suites);
  if (results.length !== units.length || results.some(attempts =>
    attempts.length !== 1 || attempts[0].status !== "failed" || attempts[0].errors?.length !== 1)) {
    throw new Error("Control runner did not fail exactly once per unit");
  }
  const invocationId = reports[0]?.invocation?.invocationId;
  if (typeof invocationId !== "string" || !invocationId) throw new Error("Missing control invocation");
  return units.map(unit => {
    const report = reports.find(value => value?.[unitKey] === unit);
    const verdict = evaluate(unit, report?.samples);
    const limit = limitFor(unit);
    if (report?.control !== true || report.invocation?.control !== true ||
        report.invocation.head !== expectedHead || report.invocation.dirty !== false ||
        report.invocation.invocationId !== invocationId ||
        verdict.p95Ms === null || verdict.p95Ms <= limit ||
        verdict.failures.length !== 1 ||
        JSON.stringify(report.verdict) !== JSON.stringify(verdict) ||
        !report.samples.every(sample => sample.cleanup === true && !sample.error &&
          (sample.index >= controlTrials || sample[sampleMetric] > limit)) ||
        results.filter(attempts =>
          attempts[0].errors[0].message?.split("\n", 1)[0] ===
            `Error: ${JSON.stringify(verdict)}`).length !== 1) {
      throw new Error(`${unit} control lacks complete, current-head latency-only failure evidence`);
    }
    return { [unitKey]: unit, ...verdict };
  });
}

/**
 * CLI body shared by both verifiers: exactly one fresh invocation under
 * `artifacts/<gate>/`, the reports read by unit name, the head from git, and
 * `control-verification.json` written beside the evidence.
 */
export function runControlVerification({ gate, exitCode, options }) {
  const root = path.resolve("artifacts", gate);
  const directories = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory());
  if (directories.length !== 1) throw new Error("Control verification requires exactly one fresh invocation");
  const artifactRoot = path.join(root, directories[0].name);
  const read = name => JSON.parse(readFileSync(path.join(artifactRoot, `${name}.json`), "utf8"));
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const verified = verifyBrowserControl(exitCode, options.units.map(read), read("playwright"), head, options);
  const proof = { head, exitCode, expectedFailureVerified: true, [`${options.unitKey}s`]: verified };
  writeFileSync(path.join(artifactRoot, "control-verification.json"), JSON.stringify(proof, null, 2));
  return proof;
}
