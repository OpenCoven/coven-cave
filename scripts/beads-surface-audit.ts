#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyPlatform } from "../src/lib/beads-delivery.ts";

type BaselineFile = { grandfathered: string[] };
type AuditOptions = {
  baselinePath: string;
  writeBaseline: boolean;
};

class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function defaultBaselinePath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../config/beads-surface-grandfather.json");
}

function parseArgs(argv: string[]): AuditOptions {
  const options: AuditOptions = {
    baselinePath: defaultBaselinePath(),
    writeBaseline: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    switch (arg) {
      case "--baseline": {
        const value = argv[index + 1];
        if (!value) throw new CliError("beads-surface-audit: --baseline requires a path");
        options.baselinePath = path.resolve(process.cwd(), value);
        index += 1;
        break;
      }
      case "--write-baseline":
        options.writeBaseline = true;
        break;
      case "-h":
      case "--help":
        console.log(
          "Usage: node --experimental-strip-types scripts/beads-surface-audit.ts [--baseline <path>] [--write-baseline]",
        );
        process.exit(0);
      default:
        throw new CliError(`beads-surface-audit: unsupported argument: ${arg}`);
    }
  }

  return options;
}

function runBdList() {
  const result = spawnSync("bd", ["list", "--all", "--json"], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new CliError(`beads-surface-audit: ${result.error.message}`);
  if ((result.status ?? 1) !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function parseRows(stdout: string): Array<{ id: string; labels?: readonly string[] | null }> {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) throw new Error("bd list JSON must be an array");
    return parsed.map((row) => {
      if (!row || typeof row !== "object") throw new Error("bd list JSON rows must be objects");
      const id = typeof row.id === "string" ? row.id : "";
      if (!id) throw new Error("bd list JSON rows must include an id");
      const labels = Array.isArray(row.labels) ? row.labels.filter((label): label is string => typeof label === "string") : row.labels === null || row.labels === undefined ? row.labels : null;
      return { id, labels };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`beads-surface-audit: failed to parse bd list JSON (${message})`);
  }
}

function readBaseline(file: string, allowMissing: boolean): Set<string> {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as NodeJS.ErrnoException).code) : "";
    if (allowMissing && code === "ENOENT") return new Set();
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`beads-surface-audit: failed to read baseline (${message})`);
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as BaselineFile).grandfathered)) {
      throw new Error('expected {"grandfathered":[...]}');
    }
    return new Set(
      (parsed as BaselineFile).grandfathered
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CliError(`beads-surface-audit: failed to parse baseline (${message})`);
  }
}

function findViolations(rows: Array<{ id: string; labels?: readonly string[] | null }>) {
  return rows
    .map((row) => ({ id: row.id, classification: classifyPlatform(row.labels) }))
    .filter((row) => row.classification === "missing" || row.classification === "conflicting");
}

function writeBaseline(file: string, ids: string[]) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ grandfathered: ids }, null, 2) + "\n", "utf8");
}

try {
  const options = parseArgs(process.argv.slice(2));
  const rows = parseRows(runBdList());
  const violations = findViolations(rows);

  if (options.writeBaseline) {
    writeBaseline(
      options.baselinePath,
      violations.map((row) => row.id).sort((left, right) => left.localeCompare(right)),
    );
    process.exit(0);
  }

  const grandfathered = readBaseline(options.baselinePath, false);
  const newViolations = violations.filter((row) => !grandfathered.has(row.id));
  if (newViolations.length > 0) {
    for (const row of newViolations) process.stderr.write(`${row.id}: ${row.classification}\n`);
    process.exit(1);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const exitCode = error instanceof CliError ? error.exitCode : 1;
  console.error(message);
  process.exit(exitCode);
}
