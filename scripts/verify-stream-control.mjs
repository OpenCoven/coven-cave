import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  evaluateStreamPerformance, STREAM_PERFORMANCE_LIMIT_MS,
  STREAM_PERFORMANCE_PROFILE,
} from "../tests/fixtures/chat-stream-performance.ts";

function resultsIn(suites) {
  return suites.flatMap(suite => [
    ...(suite.specs ?? []).flatMap(spec => spec.tests.map(test => test.results)),
    ...resultsIn(suite.suites ?? []),
  ]);
}

export function verifyStreamControl(exitCode, reports, runner, expectedHead) {
  if (exitCode !== 1 || !Array.isArray(reports) || reports.length !== 2 ||
      typeof expectedHead !== "string" || !/^[a-f0-9]{40}$/.test(expectedHead) ||
      runner?.errors?.length !== 0 || runner?.stats?.unexpected !== 2 ||
      runner.stats.expected !== 0 || runner.stats.skipped !== 0 || runner.stats.flaky !== 0) {
    throw new Error("Expected exactly two failed control tests without runner errors or retries");
  }
  const results = resultsIn(runner.suites);
  if (results.length !== 2 || results.some(attempts =>
    attempts.length !== 1 || attempts[0].status !== "failed" || attempts[0].errors?.length !== 1)) {
    throw new Error("Control runner did not fail exactly once per pattern");
  }
  const invocationId = reports[0]?.invocation?.invocationId;
  if (typeof invocationId !== "string" || !invocationId) throw new Error("Missing control invocation");
  return STREAM_PERFORMANCE_PROFILE.patterns.map(pattern => {
    const report = reports.find(value => value?.pattern === pattern);
    const verdict = evaluateStreamPerformance(pattern, report?.samples);
    if (report?.control !== true || report.invocation?.control !== true ||
        report.invocation.head !== expectedHead || report.invocation.dirty !== false ||
        report.invocation.invocationId !== invocationId ||
        verdict.p95Ms === null || verdict.p95Ms <= STREAM_PERFORMANCE_LIMIT_MS ||
        verdict.failures.length !== 1 ||
        JSON.stringify(report.verdict) !== JSON.stringify(verdict) ||
        !report.samples.every(sample => sample.cleanup === true && !sample.error &&
          (sample.index >= 6 || sample.longestTaskMs > STREAM_PERFORMANCE_LIMIT_MS)) ||
        results.filter(attempts =>
          attempts[0].errors[0].message?.split("\n", 1)[0] ===
            `Error: ${JSON.stringify(verdict)}`).length !== 1) {
      throw new Error(`${pattern} control lacks complete, current-head latency-only failure evidence`);
    }
    return { pattern, ...verdict };
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) throw new Error("Usage: node scripts/verify-stream-control.mjs <exit-code>");
  const root = path.resolve("artifacts/stream-performance");
  const directories = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory());
  if (directories.length !== 1) throw new Error("Control verification requires exactly one fresh invocation");
  const artifactRoot = path.join(root, directories[0].name);
  const read = name => JSON.parse(readFileSync(path.join(artifactRoot, `${name}.json`), "utf8"));
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const patterns = verifyStreamControl(
    Number(process.argv[2]), STREAM_PERFORMANCE_PROFILE.patterns.map(read), read("playwright"), head,
  );
  const proof = { head, expectedFailureVerified: true, patterns };
  writeFileSync(path.join(artifactRoot, "control-verification.json"), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
}
