#!/usr/bin/env node --experimental-strip-types
// CovenWiki v0 Phase 3 — regeneration hook CLI (Route B stages S1–S4).
//
// Thin I/O wrapper over src/lib/covenwiki-regen.ts. Stage semantics:
//   scan  (S1) hash every file under the source roots -> manifest JSON
//   diff  (S2) compare a fresh scan against the saved state; --check for hooks
//   plan  (S3) print the regeneration actions the diff implies
//   run   (S4) execute the plan (optional --generator), then persist new state
//
// The Phase 1/2 wiki generator plugs in via --generator: the plan is piped to
// its stdin as JSON. Without --generator, `run` is report-then-persist, which
// is enough to seed state and wire the hook before the generator lands.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildManifest,
  diffManifests,
  nextState,
  parseState,
  planRegeneration,
  serializeState,
  summarizePlan,
  type Manifest,
  type SourceEntry,
} from "../src/lib/covenwiki-regen.ts";

const STAGES = ["scan", "diff", "plan", "run"] as const;
type Stage = (typeof STAGES)[number];

type Options = {
  stage: Stage;
  sources: string[];
  state: string;
  fullRebuild: string[];
  generator: string | null;
  json: boolean;
  check: boolean;
  dryRun: boolean;
};

const SKIP_DIRS = new Set([".git", "node_modules", ".worktrees", ".next", "target"]);

function printHelp() {
  console.log(`Usage: node --experimental-strip-types scripts/covenwiki-regen.ts <stage> [options]

Stages (CovenWiki Route B Phase 3, S1-S4):
  scan   S1: hash all wiki sources and print the manifest
  diff   S2: compare a fresh scan with the saved state
  plan   S3: show the regeneration actions the current diff implies
  run    S4: execute the plan and persist the new state

Options:
  --source <path>        source root to scan (repeatable; default: docs)
  --state <file>         state file (default: .covenwiki/state.json)
  --full-rebuild <path>  path or dir/ prefix that forces a full rebuild (repeatable)
  --generator <cmd>      shell command for 'run'; receives the plan JSON on stdin
  --json                 emit machine-readable JSON instead of text
  --check                (diff/plan) exit 1 when regeneration is needed
  --dry-run              (run) skip the generator and state write
  -h, --help             show this help`);
}

function parseArgs(argv: string[]): Options {
  const first = argv[0];
  if (!first || first === "-h" || first === "--help") {
    printHelp();
    process.exit(first ? 0 : 1);
  }
  if (!STAGES.includes(first as Stage)) throw new Error(`unknown stage: ${first} (expected ${STAGES.join("|")})`);
  const stage = first as Stage;
  const opts: Options = {
    stage,
    sources: [],
    state: ".covenwiki/state.json",
    fullRebuild: [],
    generator: null,
    json: false,
    check: false,
    dryRun: false,
  };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--source":
        opts.sources.push(requireValue(argv, ++i, arg));
        break;
      case "--state":
        opts.state = requireValue(argv, ++i, arg);
        break;
      case "--full-rebuild":
        opts.fullRebuild.push(requireValue(argv, ++i, arg));
        break;
      case "--generator":
        opts.generator = requireValue(argv, ++i, arg);
        break;
      case "--json":
        opts.json = true;
        break;
      case "--check":
        opts.check = true;
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`unsupported argument: ${arg}`);
    }
  }
  if (opts.sources.length === 0) opts.sources.push("docs");
  return opts;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (value === undefined) throw new Error(`${flag} requires a value`);
  return value;
}

function walk(root: string, out: string[]) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
}

/** S1: scan the source roots into a manifest. */
function scan(opts: Options): Manifest {
  const files: string[] = [];
  for (const source of opts.sources) {
    if (!existsSync(source)) throw new Error(`source root not found: ${source}`);
    if (statSync(source).isFile()) files.push(source);
    else walk(source, files);
  }
  const entries: SourceEntry[] = files.map((file) => ({
    path: file.split(path.sep).join("/"),
    hash: createHash("sha256").update(readFileSync(file)).digest("hex"),
  }));
  return buildManifest(entries, new Date().toISOString());
}

function loadPreviousManifest(stateFile: string): Manifest | null {
  if (!existsSync(stateFile)) return null;
  return parseState(readFileSync(stateFile, "utf8")).manifest;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifest = scan(opts);

  if (opts.stage === "scan") {
    if (opts.json) console.log(JSON.stringify(manifest, null, 2));
    else {
      console.log(`scanned ${Object.keys(manifest.entries).length} source file(s) under: ${opts.sources.join(", ")}`);
      for (const file of Object.keys(manifest.entries)) console.log(`  ${file}`);
    }
    return;
  }

  const previous = loadPreviousManifest(opts.state);
  const diff = diffManifests(previous, manifest);
  const plan = planRegeneration(diff, { sourceRoots: opts.sources, fullRebuildPaths: opts.fullRebuild });

  if (opts.stage === "diff" || opts.stage === "plan") {
    if (opts.json) {
      console.log(JSON.stringify(opts.stage === "diff" ? { diff } : { diff, plan }, null, 2));
    } else {
      const lines = opts.stage === "diff" ? summarizePlan(diff, { dirty: diff.dirty, actions: [] }) : summarizePlan(diff, plan);
      for (const line of lines) console.log(line);
    }
    if (opts.check && diff.dirty) process.exit(1);
    return;
  }

  // run (S4)
  for (const line of summarizePlan(diff, plan)) console.log(line);
  if (!diff.dirty) return;
  if (opts.dryRun) {
    console.log("dry run — generator and state write skipped");
    return;
  }
  if (opts.generator) {
    const result = spawnSync(opts.generator, {
      shell: true,
      input: JSON.stringify({ diff, plan }, null, 2),
      stdio: ["pipe", "inherit", "inherit"],
    });
    if (result.status !== 0) {
      console.error(`generator failed (exit ${result.status ?? "signal"}); state not updated`);
      process.exit(result.status ?? 1);
    }
  } else {
    console.log("no --generator configured — recording state only");
  }
  mkdirSync(path.dirname(opts.state), { recursive: true });
  writeFileSync(opts.state, serializeState(nextState(manifest)));
  console.log(`state updated: ${opts.state}`);
}

try {
  main();
} catch (error) {
  console.error(`covenwiki-regen: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
