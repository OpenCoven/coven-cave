import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ENUMS = {
  source: ["github", "beads", "office_hours", "discord", "usability_test"],
  stage: [
    "download",
    "install",
    "first_launch",
    "system_check",
    "runtime_connection",
    "familiar",
    "project",
    "permissions",
    "first_task",
    "recovery",
    "continued_use",
  ],
  classification: [
    "documentation",
    "terminology",
    "automation",
    "product_bug",
    "platform_bug",
    "runtime_integration",
    "permission_confusion",
    "missing_feedback",
    "knowledge_gap",
    "unsupported",
  ],
  severity: ["blocker", "major", "minor"],
  platform: ["macos", "windows", "linux", "all", "unknown"],
};

const OPTIONAL_TEXT_LIMITS = {
  workaround: 500,
  proposedFix: 500,
  owner: 100,
  successMetric: 300,
};

const ALLOWED_KEYS = new Set([
  ...Object.keys(ENUMS),
  "observedAt",
  "issueKey",
  ...Object.keys(OPTIONAL_TEXT_LIMITS),
]);

const SEVERITY_RANK = {
  minor: 1,
  major: 2,
  blocker: 3,
};

function fail(index, message) {
  throw new Error(`feedback[${index}]: ${message}`);
}

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

export function validateFeedback(records) {
  if (!Array.isArray(records)) {
    throw new Error("feedback input must be a JSON array");
  }

  records.forEach((record, index) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      fail(index, "entry must be an object");
    }

    for (const key of Object.keys(record)) {
      if (!ALLOWED_KEYS.has(key)) fail(index, `unknown field "${key}"`);
    }

    for (const [field, values] of Object.entries(ENUMS)) {
      if (!values.includes(record[field])) {
        fail(index, `"${field}" must be one of: ${values.join(", ")}`);
      }
    }

    if (typeof record.observedAt !== "string" || !isCalendarDate(record.observedAt)) {
      fail(index, "\"observedAt\" must be a real YYYY-MM-DD date");
    }

    if (
      typeof record.issueKey !== "string"
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.issueKey)
    ) {
      fail(index, "\"issueKey\" must be lowercase kebab-case");
    }

    for (const [field, maximum] of Object.entries(OPTIONAL_TEXT_LIMITS)) {
      const value = record[field];
      if (value === undefined) continue;
      if (typeof value !== "string" || value.length > maximum) {
        fail(index, `"${field}" must be a string no longer than ${maximum} characters`);
      }
    }
  });

  return records;
}

function increment(target, key) {
  target[key] = (target[key] ?? 0) + 1;
}

function sortedCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function summarizeFeedback(input) {
  const records = validateFeedback(input);
  const byStage = {};
  const bySource = {};
  const byClassification = {};
  const bySeverity = {};
  const byPlatform = {};
  const issueMap = new Map();

  for (const record of records) {
    increment(byStage, record.stage);
    increment(bySource, record.source);
    increment(byClassification, record.classification);
    increment(bySeverity, record.severity);
    increment(byPlatform, record.platform);

    const current = issueMap.get(record.issueKey) ?? {
      count: 0,
      severity: record.severity,
      platforms: new Set(),
      stages: new Set(),
      classifications: new Set(),
      sources: new Set(),
    };
    current.count += 1;
    if (SEVERITY_RANK[record.severity] > SEVERITY_RANK[current.severity]) {
      current.severity = record.severity;
    }
    current.platforms.add(record.platform);
    current.stages.add(record.stage);
    current.classifications.add(record.classification);
    current.sources.add(record.source);
    issueMap.set(record.issueKey, current);
  }

  const byIssue = Object.fromEntries(
    [...issueMap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([issueKey, issue]) => [
        issueKey,
        {
          count: issue.count,
          severity: issue.severity,
          platforms: [...issue.platforms].sort(),
          stages: [...issue.stages].sort(),
          classifications: [...issue.classifications].sort(),
          sources: [...issue.sources].sort(),
        },
      ]),
  );

  return {
    schemaVersion: 1,
    total: records.length,
    byIssue,
    byStage: sortedCounts(byStage),
    bySource: sortedCounts(bySource),
    byClassification: sortedCounts(byClassification),
    bySeverity: sortedCounts(bySeverity),
    byPlatform: sortedCounts(byPlatform),
    privacy: {
      included: [
        "categorical source, stage, classification, severity, and platform counts",
        "normalized issue keys",
      ],
      excluded: [
        "names and account identifiers",
        "prompts, source code, file contents, and local paths",
        "credentials and environment values",
        "workarounds, proposed fixes, owner names, and freeform support text",
      ],
    },
  };
}

function runCli() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("usage: node scripts/onboarding-feedback-report.mjs <feedback.json>");
  }
  const resolved = path.resolve(inputPath);
  const input = JSON.parse(readFileSync(resolved, "utf8"));
  process.stdout.write(`${JSON.stringify(summarizeFeedback(input), null, 2)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (invokedPath === import.meta.url) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(
      `onboarding-feedback-report: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
