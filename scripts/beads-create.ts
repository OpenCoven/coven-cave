#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { PLATFORM_SURFACE_LABELS, type PlatformSurface } from "../src/lib/beads-delivery.ts";

const PLATFORM_LABELS = new Set<string>(PLATFORM_SURFACE_LABELS);
const SURFACES = new Set<PlatformSurface>(PLATFORM_SURFACE_LABELS.map((label) => label.slice("surface:".length) as PlatformSurface));

class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function parseLabels(raw: string): string[] {
  return raw.split(",").map((label) => label.trim()).filter(Boolean);
}

function parseSurface(raw: string): PlatformSurface {
  if (SURFACES.has(raw as PlatformSurface)) return raw as PlatformSurface;
  throw new CliError(`beads-create: invalid --surface "${raw}" (expected ios, desktop, or shared)`);
}

function buildCreateArgs(argv: string[]): string[] {
  const passthrough: string[] = ["create"];
  const positional: string[] = [];
  const labels: string[] = [];
  const seenLabels = new Set<string>();
  let surface: PlatformSurface | null = null;
  let passthroughOnly = false;

  const addLabel = (label: string) => {
    if (PLATFORM_LABELS.has(label)) {
      throw new CliError("beads-create: Use --surface instead of passing surface ownership labels in --labels");
    }
    if (seenLabels.has(label)) return;
    seenLabels.add(label);
    labels.push(label);
  };

  const addSurface = (raw: string) => {
    if (surface !== null) throw new CliError("beads-create: --surface may be passed exactly once");
    surface = parseSurface(raw);
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (passthroughOnly) {
      positional.push(arg);
      continue;
    }
    if (arg === "--") {
      passthroughOnly = true;
      continue;
    }
    if (arg === "--surface") {
      const value = argv[index + 1];
      if (value === undefined) throw new CliError("beads-create: --surface requires ios, desktop, or shared");
      addSurface(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--surface=")) {
      addSurface(arg.slice("--surface=".length));
      continue;
    }
    if (arg === "--labels" || arg === "-l") {
      const value = argv[index + 1];
      if (value === undefined) throw new CliError(`beads-create: ${arg} requires a value`);
      for (const label of parseLabels(value)) addLabel(label);
      index += 1;
      continue;
    }
    if (arg.startsWith("--labels=")) {
      for (const label of parseLabels(arg.slice("--labels=".length))) addLabel(label);
      continue;
    }
    if (arg.startsWith("-l=")) {
      for (const label of parseLabels(arg.slice(3))) addLabel(label);
      continue;
    }
    passthrough.push(arg);
  }

  if (surface === null) {
    throw new CliError("beads-create: exactly one --surface ios|desktop|shared is required");
  }

  passthrough.push("--labels", [...labels, `surface:${surface}`].join(","));
  if (positional.length > 0) passthrough.push("--", ...positional);
  return passthrough;
}

try {
  const args = buildCreateArgs(process.argv.slice(2));
  const result = spawnSync("bd", args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`beads-create: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const exitCode = error instanceof CliError ? error.exitCode : 1;
  console.error(message);
  process.exit(exitCode);
}
