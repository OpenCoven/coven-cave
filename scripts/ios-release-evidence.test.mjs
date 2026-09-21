import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blankIOSReleaseEvidence, validateIOSReleaseEvidence } from "./ios-release-evidence.mjs";

const required = [
  "signing", "symbols", "assetsAndDependencies", "prerequisiteReconciliation",
  "incident", "physicalDevice", "populatedV040Upgrade", "recovery",
  "diagnosticDrill", "cohort", "releaseHolds", "maintainerDecision",
];

function completeRecord() {
  const candidate = {
    version: "0.5.0", build: "2026092001", sourceSHA: "a".repeat(40),
    archiveSHA256: "b".repeat(64), ipaSHA256: "c".repeat(64),
  };
  return {
    schemaVersion: 1,
    candidate,
    receipts: Object.fromEntries(required.map((kind) => [kind, {
      result: "pass", receiptId: `receipt-${kind}`, candidate: { ...candidate },
    }])),
  };
}

test("blank template preserves all outstanding requirements and never authorizes release", () => {
  const record = blankIOSReleaseEvidence();
  assert.deepEqual(Object.keys(record.receipts), required);
  for (const receipt of Object.values(record.receipts)) assert.equal(receipt.result, "pending");
  const result = validateIOSReleaseEvidence(record);
  assert.equal(result.status, "incomplete");
  assert.equal(result.releaseAuthorized, false);
  assert.ok(result.errors.length > 0);
});

test("matching receipts establish only record completeness", () => {
  const result = validateIOSReleaseEvidence(completeRecord());
  assert.deepEqual(result, { status: "record-complete", releaseAuthorized: false, errors: [] });
});

test("every required receipt is mandatory, including missing prerequisite reconciliation", () => {
  for (const kind of required) {
    const record = completeRecord();
    delete record.receipts[kind];
    const result = validateIOSReleaseEvidence(record);
    assert.equal(result.status, "incomplete", kind);
    assert.ok(result.errors.some((error) => error.includes(kind)), kind);
  }
});

test("receipts from a different build or artifact cannot qualify a rebuilt candidate", () => {
  for (const field of Object.keys(completeRecord().candidate)) {
    const record = completeRecord();
    record.receipts.physicalDevice.candidate[field] += "0";
    const result = validateIOSReleaseEvidence(record);
    assert.equal(result.status, "incomplete", field);
    assert.ok(result.errors.some((error) => error.includes(`physicalDevice.candidate.${field}`)));
  }
});

test("failed, blocked, pending and unknown results remain incomplete", () => {
  for (const state of ["fail", "blocked", "pending", "waived", true, null]) {
    const record = completeRecord();
    record.receipts.releaseHolds.result = state;
    const result = validateIOSReleaseEvidence(record);
    assert.equal(result.status, "incomplete");
    assert.equal(result.releaseAuthorized, false);
  }
});

test("malformed records never throw or count as complete", () => {
  for (const value of [null, [], true, "pass", 1, {}, { schemaVersion: 2 }]) {
    assert.equal(validateIOSReleaseEvidence(value).status, "incomplete");
  }
  for (const field of Object.keys(completeRecord().candidate)) {
    for (const value of [null, {}, "", "pending", "x\n", 123]) {
      const record = completeRecord();
      record.candidate[field] = value;
      assert.equal(validateIOSReleaseEvidence(record).status, "incomplete", field);
    }
  }
});

test("receipt references are opaque IDs, never raw diagnostics or private paths", () => {
  for (const value of ["", "pending", "https://example.test/?token=secret", "/Users/private/report", "a\nb", {}]) {
    const record = completeRecord();
    record.receipts.diagnosticDrill.receiptId = value;
    const result = validateIOSReleaseEvidence(record);
    assert.equal(result.status, "incomplete");
    assert.ok(result.errors.every((error) => !error.includes("secret") && !error.includes("/Users")));
  }
});

test("unknown fields are rejected without echoing private contents", () => {
  for (const select of [(r) => r, (r) => r.candidate, (r) => r.receipts,
    (r) => r.receipts.diagnosticDrill, (r) => r.receipts.diagnosticDrill.candidate]) {
    const record = completeRecord();
    select(record)["private-value"] = "private-value";
    const result = validateIOSReleaseEvidence(record);
    assert.equal(result.status, "incomplete");
    assert.ok(!JSON.stringify(result).includes("private-value"));
  }
});

test("CLI templates, validates, and fails closed on malformed files and arguments", () => {
  const script = fileURLToPath(new URL("./ios-release-evidence.mjs", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  const directory = mkdtempSync(path.join(tmpdir(), "ios-evidence-test-"));
  try {
    const file = path.join(directory, "record.json");
    const template = run("template");
    assert.equal(template.status, 0);
    assert.deepEqual(JSON.parse(template.stdout), blankIOSReleaseEvidence());
    writeFileSync(file, template.stdout);
    assert.equal(run("validate", file).status, 1);
    writeFileSync(file, JSON.stringify(completeRecord()));
    const complete = run("validate", file);
    assert.equal(complete.status, 0);
    assert.equal(JSON.parse(complete.stdout).releaseAuthorized, false);
    writeFileSync(file, '{"private-secret":');
    const malformed = run("validate", file);
    assert.equal(malformed.status, 2);
    assert.ok(!malformed.stderr.includes("private-secret"));
    assert.ok(!malformed.stderr.includes(directory));
    assert.equal(run("validate", path.join(directory, "absent.json")).status, 2);
    for (const args of [[], ["publish"], ["template", "extra"], ["validate"], ["validate", file, "extra"]]) {
      assert.equal(run(...args).status, 2);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
