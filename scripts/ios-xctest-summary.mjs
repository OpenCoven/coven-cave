#!/usr/bin/env node
// Assert that the iOS XCTest suite ACTUALLY EXECUTED, and that CI would have
// noticed if it had not.
//
// Why this file exists (cave-ac372). Until now the `iOS build` job ran:
//
//     xcodebuild ... build               # the app target compiles
//     xcodebuild ... build-for-testing   # the test bundles compile
//
// Neither runs a single assertion. `build-for-testing` needs no booted
// simulator, which is exactly what made it cheap enough for routine PR CI —
// and exactly why it cannot execute anything. So every XCTest under
// CovenCaveTests/ was unrun: 684 test methods whose green check certified that
// they PARSE, not that they PASS. PR #4946 shipped ~1,900 lines of Swift for
// the Familiar hub store — single-flight dedup, cancellation on Familiar
// switch, nonce/epoch relevance, LRU eviction — with XCTest coverage for
// exactly those behaviours, none of which had ever been asked a question.
//
// The job now boots a simulator and runs the suite, so `xcodebuild`'s own exit
// status is the primary gate. This script exists because that exit status is
// NOT sufficient on its own:
//
//   * `xcodebuild test-without-building` exits 0 when it runs ZERO tests. An
//     `-only-testing:` selector that stops matching (a renamed target, a
//     retired bundle) turns the whole gate off and reports success. That is
//     the precise failure this bead is about, re-armed one layer up.
//   * A suite can also truncate — run 300 of 684 and exit 0 — which reads
//     identical to a healthy run in the log.
//
// So the assertion here is on a PROPERTY, not on a spelling in the log: the
// number of test cases the result bundle says ran must be at least the number
// of XCTest methods that exist in the source tree. A grep for "Test Suite
// ... passed" would be satisfied by a run of one test; this is not.
//
// The floor is derived from the sources rather than hardcoded, so adding tests
// never needs a number bumped here, and DELETING the wiring that runs them
// fails loudly.
//
// Usage:
//   node scripts/ios-xctest-summary.mjs \
//     --result-bundle /path/to/CovenCaveTests.xcresult \
//     --tests-dir apps/ios/CovenCave/CovenCaveTests

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Strip Swift comments so a commented-out `func testFoo()` is not counted. */
export function stripSwiftComments(source) {
  let out = "";
  let i = 0;
  let blockDepth = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (blockDepth > 0) {
      if (two === "/*") {
        blockDepth += 1;
        i += 2;
        continue;
      }
      if (two === "*/") {
        blockDepth -= 1;
        i += 2;
        continue;
      }
      // Preserve newlines so line-oriented reasoning downstream stays sane.
      out += source[i] === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }
    if (two === "/*") {
      blockDepth = 1;
      i += 2;
      continue;
    }
    if (two === "//") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

// XCTest only discovers instance methods named `test…` that take no arguments.
// `async`/`throws` may follow the parameter list, so the pattern deliberately
// stops at the closing paren.
const XCTEST_METHOD = /\bfunc\s+test[A-Za-z0-9_]*\s*\(\s*\)/g;

/** Count the XCTest methods declared in one Swift source. */
export function countXCTestMethods(source) {
  return (stripSwiftComments(source).match(XCTEST_METHOD) ?? []).length;
}

/**
 * Count the XCTest methods across a directory of Swift sources.
 * Returns `{ total, perFile }` so a truncation can name the files it expected.
 */
export function countXCTestMethodsInDirectory(dir, { readDir = readdirSync, readFile = readFileSync } = {}) {
  const perFile = new Map();
  let total = 0;
  for (const entry of readDir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const nested = countXCTestMethodsInDirectory(path.join(dir, entry.name), { readDir, readFile });
      for (const [file, count] of nested.perFile) perFile.set(file, count);
      total += nested.total;
      continue;
    }
    if (!entry.name.endsWith(".swift")) continue;
    const full = path.join(dir, entry.name);
    const count = countXCTestMethods(readFile(full, "utf8"));
    perFile.set(full, count);
    total += count;
  }
  return { total, perFile };
}

/**
 * Decide whether an xcresult summary proves the suite executed and passed.
 *
 * `summary` is the object `xcrun xcresulttool get test-results summary` emits.
 * Returns `{ ok, executed, problems }`; `problems` is empty iff `ok`.
 */
export function evaluateSuiteExecution({ summary, expectedMinimum }) {
  const problems = [];
  const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

  if (!summary || typeof summary !== "object") {
    return { ok: false, executed: 0, problems: ["the result bundle summary is missing or not an object"] };
  }

  const passed = num(summary.passedTests);
  const failed = num(summary.failedTests);
  const skipped = num(summary.skippedTests);
  const expectedFailures = num(summary.expectedFailures);
  const reportedTotal = num(summary.totalTestCount);
  // Prefer the reported total, but never let a missing/zero total hide a run
  // that plainly executed cases.
  const executed = Math.max(reportedTotal, passed + failed + skipped + expectedFailures);

  // The guard needs a guard: a source scan that finds nothing would make every
  // floor trivially satisfiable, which is the same class of hole as the one
  // this file closes.
  if (!Number.isFinite(expectedMinimum) || expectedMinimum <= 0) {
    problems.push(
      `expected at least one XCTest method in the source tree but the scan found ${expectedMinimum} — ` +
        "the floor cannot be derived, so this run proves nothing",
    );
  }

  if (executed === 0) {
    problems.push(
      "ZERO test cases executed. xcodebuild exits 0 when its test selector matches nothing, " +
        "so a green step here would certify only that the bundles compiled (cave-ac372).",
    );
  } else if (Number.isFinite(expectedMinimum) && executed < expectedMinimum) {
    problems.push(
      `only ${executed} test case(s) executed but ${expectedMinimum} XCTest method(s) exist in the source tree — ` +
        "the suite truncated or part of it was never wired in",
    );
  }

  if (failed > 0) {
    problems.push(`${failed} test case(s) failed`);
  }

  if (typeof summary.result === "string" && summary.result !== "Passed") {
    problems.push(`the result bundle reports result="${summary.result}"`);
  }

  return { ok: problems.length === 0, executed, problems };
}

export function readResultBundleSummary(resultBundlePath, { run = execFileSync } = {}) {
  const raw = run(
    "xcrun",
    ["xcresulttool", "get", "test-results", "summary", "--path", resultBundlePath, "--format", "json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(raw);
}

function parseArgs(argv) {
  const args = { resultBundle: "", testsDir: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--result-bundle") args.resultBundle = argv[i + 1] ?? "";
    if (argv[i] === "--tests-dir") args.testsDir = argv[i + 1] ?? "";
  }
  return args;
}

function main() {
  const { resultBundle, testsDir } = parseArgs(process.argv.slice(2));
  if (!resultBundle || !testsDir) {
    console.error("usage: ios-xctest-summary.mjs --result-bundle <path.xcresult> --tests-dir <dir>");
    process.exit(2);
  }

  const { total: expectedMinimum, perFile } = countXCTestMethodsInDirectory(testsDir);

  let summary;
  try {
    summary = readResultBundleSummary(resultBundle);
  } catch (error) {
    console.error(`✗ could not read the xcresult bundle at ${resultBundle}`);
    console.error(String(error?.stderr || error?.message || error));
    process.exit(1);
    return;
  }

  const { ok, executed, problems } = evaluateSuiteExecution({ summary, expectedMinimum });

  const line = (label, value) => console.log(`  ${label.padEnd(22)} ${value}`);
  console.log("iOS XCTest execution report");
  line("source test methods", expectedMinimum);
  line("executed", executed);
  line("passed", summary.passedTests ?? 0);
  line("failed", summary.failedTests ?? 0);
  line("skipped", summary.skippedTests ?? 0);
  line("expected failures", summary.expectedFailures ?? 0);
  line("result", summary.result ?? "(unreported)");

  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = [
      "### iOS XCTest execution",
      "",
      "| metric | value |",
      "| --- | --- |",
      `| source test methods | ${expectedMinimum} |`,
      `| executed | ${executed} |`,
      `| passed | ${summary.passedTests ?? 0} |`,
      `| failed | ${summary.failedTests ?? 0} |`,
      `| skipped | ${summary.skippedTests ?? 0} |`,
      `| result | ${summary.result ?? "(unreported)"} |`,
      "",
    ].join("\n");
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${rows}\n`);
    } catch {
      /* a summary we cannot write is never a reason to fail the gate */
    }
  }

  if (!ok) {
    console.error("");
    for (const problem of problems) console.error(`✗ ${problem}`);
    if (executed > 0 && executed < expectedMinimum) {
      console.error("");
      console.error("Per-file XCTest method counts the floor was derived from:");
      for (const [file, count] of perFile) {
        if (count > 0) console.error(`    ${count.toString().padStart(4)}  ${file}`);
      }
    }
    for (const failure of summary.testFailures ?? []) {
      console.error(`    ${failure.testName ?? "(unnamed)"}: ${failure.failureText ?? ""}`);
    }
    process.exit(1);
  }

  console.log(`✓ ${executed} iOS XCTest case(s) executed and passed (floor ${expectedMinimum})`);
}

// Windows paths make `file://${process.argv[1]}` an unreliable identity check,
// so compare basenames instead. The test module has a different basename, so
// importing this file never runs the CLI.
if (process.argv[1] && path.basename(process.argv[1]) === "ios-xctest-summary.mjs") {
  main();
}
