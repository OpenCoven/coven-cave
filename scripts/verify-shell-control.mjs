// Verifies `pnpm performance:shell --control`: the deliberate stall must fail
// both boot modes on the latency assertion alone, with complete samples from
// the expected clean head and no runner errors, retries or skips.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  evaluateShellBootPerformance, shellBootLimitMs,
  SHELL_BOOT_PERFORMANCE_PROFILE,
} from "../tests/fixtures/shell-boot-performance.ts";

function resultsIn(suites) {
  return suites.flatMap(suite => [
    ...(suite.specs ?? []).flatMap(spec => spec.tests.map(test => test.results)),
    ...resultsIn(suite.suites ?? []),
  ]);
}

export function verifyShellControl(exitCode, reports, runner, expectedHead) {
  const modes = SHELL_BOOT_PERFORMANCE_PROFILE.modes;
  if (exitCode !== 1 || !Array.isArray(reports) || reports.length !== modes.length ||
      typeof expectedHead !== "string" || !/^[a-f0-9]{40}$/.test(expectedHead) ||
      runner?.errors?.length !== 0 || runner?.stats?.unexpected !== modes.length ||
      runner.stats.expected !== 0 || runner.stats.skipped !== 0 || runner.stats.flaky !== 0) {
    throw new Error("Expected exactly one failed control test per boot mode without runner errors or retries");
  }
  const results = resultsIn(runner.suites);
  if (results.length !== modes.length || results.some(attempts =>
    attempts.length !== 1 || attempts[0].status !== "failed" || attempts[0].errors?.length !== 1)) {
    throw new Error("Control runner did not fail exactly once per boot mode");
  }
  const invocationId = reports[0]?.invocation?.invocationId;
  if (typeof invocationId !== "string" || !invocationId) throw new Error("Missing control invocation");
  return modes.map(mode => {
    const report = reports.find(value => value?.mode === mode);
    const verdict = evaluateShellBootPerformance(mode, report?.samples);
    const limit = shellBootLimitMs(mode);
    if (report?.control !== true || report.invocation?.control !== true ||
        report.invocation.head !== expectedHead || report.invocation.dirty !== false ||
        report.invocation.invocationId !== invocationId ||
        verdict.p95Ms === null || verdict.p95Ms <= limit ||
        verdict.failures.length !== 1 ||
        JSON.stringify(report.verdict) !== JSON.stringify(verdict) ||
        !report.samples.every(sample => sample.cleanup === true && !sample.error &&
          (sample.index >= SHELL_BOOT_PERFORMANCE_PROFILE.controlTrials || sample.interactiveMs > limit)) ||
        results.filter(attempts =>
          attempts[0].errors[0].message?.split("\n", 1)[0] ===
            `Error: ${JSON.stringify(verdict)}`).length !== 1) {
      throw new Error(`${mode} control lacks complete, current-head latency-only failure evidence`);
    }
    return { mode, ...verdict };
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3) throw new Error("Usage: node scripts/verify-shell-control.mjs <exit-code>");
  const root = path.resolve("artifacts/shell-performance");
  const directories = readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory());
  if (directories.length !== 1) throw new Error("Control verification requires exactly one fresh invocation");
  const artifactRoot = path.join(root, directories[0].name);
  const read = name => JSON.parse(readFileSync(path.join(artifactRoot, `${name}.json`), "utf8"));
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const modes = verifyShellControl(
    Number(process.argv[2]), SHELL_BOOT_PERFORMANCE_PROFILE.modes.map(read), read("playwright"), head,
  );
  const verification = { verifiedAt: new Date().toISOString(), head, exitCode: Number(process.argv[2]), modes };
  writeFileSync(path.join(artifactRoot, "control-verification.json"), JSON.stringify(verification, null, 2));
  console.log(`Shell boot control verified: ${JSON.stringify(modes)}`);
}
