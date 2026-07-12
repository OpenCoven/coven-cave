#!/usr/bin/env node
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_COMPONENT_ROWS = 2_400;
export const MAX_RUNTIME_ARCHIVE_BYTES = 128 * 1024 * 1024;
export const MAX_RUNTIME_UNPACKED_BYTES = 700 * 1024 * 1024;
export const MAX_RUNTIME_FILES = 30_000;

const REQUIRED_NUMBER_PATHS = [
  ["msiBytes"],
  ["fileRows"],
  ["componentRows"],
  ["directoryRows"],
  ["createFolderRows"],
  ["administrativeFiles"],
  ["administrativeBytes"],
  ["expandedServerFiles"],
  ["runtimeArchive", "archiveBytes"],
  ["runtimeArchive", "unpackedBytes"],
  ["runtimeArchive", "fileCount"],
];

function valueAt(object, segments) {
  return segments.reduce((value, segment) => value?.[segment], object);
}

export function evaluateInstallerMetrics(metrics) {
  const errors = [];
  for (const segments of REQUIRED_NUMBER_PATHS) {
    const label = segments.join(".");
    const value = valueAt(metrics, segments);
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      errors.push(`${label} must be a non-negative integer; got ${JSON.stringify(value)}`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const checks = [
    [metrics.componentRows <= MAX_COMPONENT_ROWS, `componentRows ${metrics.componentRows} exceeds ${MAX_COMPONENT_ROWS}`],
    [metrics.expandedServerFiles === 0, `expandedServerFiles must be 0; got ${metrics.expandedServerFiles}`],
    [
      metrics.runtimeArchive.archiveBytes <= MAX_RUNTIME_ARCHIVE_BYTES,
      `runtimeArchive.archiveBytes ${metrics.runtimeArchive.archiveBytes} exceeds ${MAX_RUNTIME_ARCHIVE_BYTES}`,
    ],
    [
      metrics.runtimeArchive.unpackedBytes <= MAX_RUNTIME_UNPACKED_BYTES,
      `runtimeArchive.unpackedBytes ${metrics.runtimeArchive.unpackedBytes} exceeds ${MAX_RUNTIME_UNPACKED_BYTES}`,
    ],
    [
      metrics.runtimeArchive.fileCount <= MAX_RUNTIME_FILES,
      `runtimeArchive.fileCount ${metrics.runtimeArchive.fileCount} exceeds ${MAX_RUNTIME_FILES}`,
    ],
  ];
  for (const [ok, message] of checks) {
    if (!ok) errors.push(message);
  }
  return { ok: errors.length === 0, errors };
}

const METRIC_ROWS = [
  ["MSI bytes", (m) => m.msiBytes, "informational"],
  ["File rows", (m) => m.fileRows, "informational"],
  ["Component rows", (m) => m.componentRows, MAX_COMPONENT_ROWS],
  ["Directory rows", (m) => m.directoryRows, "informational"],
  ["CreateFolder rows", (m) => m.createFolderRows, "informational"],
  ["Administrative files", (m) => m.administrativeFiles, "informational"],
  ["Administrative bytes", (m) => m.administrativeBytes, "informational"],
  ["Expanded server files", (m) => m.expandedServerFiles, 0],
  ["Runtime archive bytes", (m) => m.runtimeArchive.archiveBytes, MAX_RUNTIME_ARCHIVE_BYTES],
  ["Runtime unpacked bytes", (m) => m.runtimeArchive.unpackedBytes, MAX_RUNTIME_UNPACKED_BYTES],
  ["Runtime files", (m) => m.runtimeArchive.fileCount, MAX_RUNTIME_FILES],
];

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error("usage: node scripts/windows-installer-budget.mjs <metrics.json>");
  const metricsPath = path.resolve(input);
  const metrics = JSON.parse(await readFile(metricsPath, "utf8"));
  const result = evaluateInstallerMetrics(metrics);

  console.log(`Windows installer metrics: ${metricsPath}`);
  for (const [label, read, budget] of METRIC_ROWS) {
    console.log(`${label}: ${read(metrics)} (budget: ${budget})`);
  }
  for (const error of result.errors) console.error(`ERROR: ${error}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = METRIC_ROWS.map(
      ([label, read, budget]) => `| ${label} | ${read(metrics)} | ${budget} |`,
    );
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "### Windows installer metrics",
        "",
        "| Metric | Actual | Budget |",
        "| --- | ---: | ---: |",
        ...rows,
        "",
        result.ok ? "✅ Installer metrics are within budget." : `❌ ${result.errors.join("<br>")}`,
        "",
      ].join("\n"),
    );
  }

  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
