// The gate that proves the iOS XCTests ran must itself be provably able to
// fail. XCTest needs macOS, so nothing here can execute a Swift test — but the
// decision procedure is pure and lives in JS precisely so it can be exercised
// on any runner, including the Windows and Linux ones this repo actually uses.
//
// Each case below is a mutation of a passing run: zero tests, a truncated
// suite, a failing case, a source scan that found nothing. If any of them
// stopped being caught, the `iOS build` job would go back to reporting green
// over an unrun suite, which is exactly the state cave-ac372 exists to end.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  countXCTestMethods,
  countXCTestMethodsInDirectory,
  evaluateSuiteExecution,
  stripSwiftComments,
} from "./ios-xctest-summary.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unitTestsDir = path.join(root, "apps", "ios", "CovenCave", "CovenCaveTests");

const passingSummary = (overrides = {}) => ({
  result: "Passed",
  totalTestCount: 684,
  passedTests: 684,
  failedTests: 0,
  skippedTests: 0,
  expectedFailures: 0,
  testFailures: [],
  ...overrides,
});

test("a full passing run is accepted", () => {
  const verdict = evaluateSuiteExecution({ summary: passingSummary(), expectedMinimum: 684 });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.executed, 684);
  assert.deepEqual(verdict.problems, []);
});

// THE bug. `xcodebuild test-without-building` exits 0 when its selector
// matches nothing, so a run that executed not one assertion looks identical to
// a healthy one from the process's exit status alone.
test("a run that executed zero tests is rejected even though it 'passed'", () => {
  const verdict = evaluateSuiteExecution({
    summary: passingSummary({ totalTestCount: 0, passedTests: 0 }),
    expectedMinimum: 684,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.executed, 0);
  assert.ok(
    verdict.problems.some((problem) => /ZERO test cases executed/.test(problem)),
    `expected a zero-execution problem, got ${JSON.stringify(verdict.problems)}`,
  );
});

test("a truncated suite is rejected", () => {
  const verdict = evaluateSuiteExecution({
    summary: passingSummary({ totalTestCount: 300, passedTests: 300 }),
    expectedMinimum: 684,
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => /only 300 test case\(s\) executed/.test(problem)));
});

test("a failing case is rejected even when the bundle forgot to say so", () => {
  const verdict = evaluateSuiteExecution({
    summary: passingSummary({ passedTests: 683, failedTests: 1, result: "Passed" }),
    expectedMinimum: 684,
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => /1 test case\(s\) failed/.test(problem)));
});

test("a non-Passed result is rejected", () => {
  const verdict = evaluateSuiteExecution({
    summary: passingSummary({ result: "Failed" }),
    expectedMinimum: 684,
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => /result="Failed"/.test(problem)));
});

// Guarding the guard: a source scan that finds nothing makes every floor
// trivially satisfiable, which is the same shape of hole one layer up.
test("a source scan that found no test methods cannot certify anything", () => {
  const verdict = evaluateSuiteExecution({ summary: passingSummary(), expectedMinimum: 0 });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => /the floor cannot be derived/.test(problem)));
});

test("a missing summary is rejected rather than treated as empty success", () => {
  for (const summary of [null, undefined, "Passed"]) {
    const verdict = evaluateSuiteExecution({ summary, expectedMinimum: 684 });
    assert.equal(verdict.ok, false, `expected ${String(summary)} to be rejected`);
  }
});

// A bundle that reports no totalTestCount but does report per-outcome counts
// must not read as zero — that would fail a healthy run, and a gate that cries
// wolf gets disabled.
test("per-outcome counts are used when totalTestCount is absent", () => {
  const verdict = evaluateSuiteExecution({
    summary: { result: "Passed", passedTests: 680, failedTests: 0, skippedTests: 4 },
    expectedMinimum: 684,
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.executed, 684);
});

test("XCTest methods are counted, helpers and comments are not", () => {
  const source = `
import XCTest

final class ExampleTests: XCTestCase {
    func testOne() {}
    @MainActor
    func testTwo() async throws {}
    // func testCommentedOut() {}
    /*
    func testBlockCommented() {}
    */
    func testHelper(named: String) {}
    func helperTestish() {}
}
`;
  assert.equal(countXCTestMethods(source), 2);
});

test("nested block comments are stripped without eating the code after them", () => {
  const stripped = stripSwiftComments("/* a /* b */ c */ func testKept() {}");
  assert.match(stripped, /func testKept\(\)/);
  assert.equal(countXCTestMethods("/* a /* b */ c */ func testKept() {}"), 1);
});

// The floor is only meaningful if it is read off the real tree. This is the
// link between the pure logic above and the sources CI actually runs.
test("the real CovenCaveTests tree yields a substantial, source-derived floor", () => {
  const { total, perFile } = countXCTestMethodsInDirectory(unitTestsDir, { readDir: readdirSync, readFile: readFileSync });
  assert.ok(total > 100, `expected the iOS unit-test tree to declare many XCTest methods, found ${total}`);
  assert.ok(perFile.size > 10, `expected many Swift files under ${unitTestsDir}, found ${perFile.size}`);
  // The store shipped by #4946 is the concrete suite this bead was filed over;
  // if it ever stops contributing to the floor, the floor stops protecting it.
  const storeTests = [...perFile.entries()].find(([file]) => file.endsWith("FamiliarDashboardStoreTests.swift"));
  assert.ok(storeTests, "FamiliarDashboardStoreTests.swift must be part of the executed suite's floor");
  assert.ok(storeTests[1] > 0, "FamiliarDashboardStoreTests.swift must declare XCTest methods");
});

console.log("ios-xctest-summary.test.mjs: ok");
