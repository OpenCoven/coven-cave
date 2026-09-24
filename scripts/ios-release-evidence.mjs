// Local record lint only. Receipt contents, authenticity, device acceptance and
// publication authority must still be reviewed through the iOS rollout runbook.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const IOS_EVIDENCE_KINDS = Object.freeze([
  "signing", "symbols", "assetsAndDependencies", "prerequisiteReconciliation",
  "incident", "physicalDevice", "populatedV040Upgrade", "recovery",
  "diagnosticDrill", "cohort", "releaseHolds", "maintainerDecision",
]);

const CANDIDATE_PATTERNS = {
  version: /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/,
  build: /^[0-9]+(?:\.[0-9]+){0,2}$/,
  sourceSHA: /^[0-9a-f]{40}$/,
  archiveSHA256: /^[0-9a-f]{64}$/,
  ipaSHA256: /^[0-9a-f]{64}$/,
};
const CANDIDATE_FIELDS = Object.keys(CANDIDATE_PATTERNS);

export function blankIOSReleaseEvidence() {
  const candidate = Object.fromEntries(CANDIDATE_FIELDS.map((key) => [key, ""]));
  return {
    schemaVersion: 1,
    candidate,
    receipts: Object.fromEntries(IOS_EVIDENCE_KINDS.map((kind) => [kind, {
      result: "pending", receiptId: "", candidate: { ...candidate },
    }])),
  };
}

export function validateIOSReleaseEvidence(record) {
  const errors = [];
  // Error paths are from fixed schema keys only; never echo user-supplied data.
  function object(value, keys, location) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${location} must be an object`);
      return false;
    }
    if (Object.keys(value).some((key) => !keys.includes(key))) {
      errors.push(`${location} contains unsupported fields`);
    }
    return true;
  }
  function candidate(value, location, expected) {
    if (!object(value, CANDIDATE_FIELDS, location)) return;
    for (const [key, pattern] of Object.entries(CANDIDATE_PATTERNS)) {
      if (typeof value[key] !== "string" || value[key].length > 128 ||
          value[key].trim() !== value[key] || !pattern.test(value[key])) {
        errors.push(`${location}.${key} is missing or invalid`);
      } else if (expected && value[key] !== expected[key]) {
        errors.push(`${location}.${key} does not match the candidate`);
      }
    }
  }
  if (object(record, ["schemaVersion", "candidate", "receipts"], "record")) {
    if (record.schemaVersion !== 1) errors.push("schemaVersion must be 1");
    candidate(record.candidate, "candidate");
    if (object(record.receipts, IOS_EVIDENCE_KINDS, "receipts")) {
      for (const kind of IOS_EVIDENCE_KINDS) {
        const receipt = record.receipts[kind];
        const location = `receipts.${kind}`;
        if (!object(receipt, ["result", "receiptId", "candidate"], location)) continue;
        if (receipt.result !== "pass") errors.push(`${location}.result must be pass`);
        if (typeof receipt.receiptId !== "string" ||
            !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(receipt.receiptId) ||
            /\s/.test(receipt.receiptId) ||
            /^(pending|unknown|none|todo|tbd)$/i.test(receipt.receiptId)) {
          errors.push(`${location}.receiptId must be a non-placeholder opaque ID`);
        }
        candidate(receipt.candidate, `${location}.candidate`, record.candidate);
      }
    }
  }
  return {
    status: errors.length ? "incomplete" : "record-complete",
    releaseAuthorized: false,
    errors,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, file, ...extra] = process.argv.slice(2);
  if (command === "template" && !file) {
    console.log(JSON.stringify(blankIOSReleaseEvidence(), null, 2));
  } else if (command === "validate" && file && extra.length === 0) {
    try {
      const result = validateIOSReleaseEvidence(JSON.parse(readFileSync(file, "utf8")));
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.status === "record-complete" ? 0 : 1;
    } catch {
      // Parsing and filesystem errors can contain private paths or input data.
      console.error("Unable to read an iOS evidence JSON record.");
      process.exitCode = 2;
    }
  } else {
    console.error("Usage: node scripts/ios-release-evidence.mjs template | validate <record.json>");
    process.exitCode = 2;
  }
}
