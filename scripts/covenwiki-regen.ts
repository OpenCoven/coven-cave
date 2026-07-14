#!/usr/bin/env node --experimental-strip-types
// CovenWiki v0 Phase 3 — regeneration hook CLI (Route B).
//
// Thin I/O wrapper over src/lib/covenwiki-regen.ts.
//
// Plan-semantics commands (phase3 regen-hook step plan, S1–S4):
//   status <slug>       (S1+S2) pure read: fresh|stale|unknown + fingerprints;
//                       zero side effects, cheap enough for the daemon/UI to poll
//   regenerate <slug>   (S3+S4) if stale (or --force) re-run the generator into
//                       <wiki>.tmp, validate fail-closed, atomically swap over
//                       the live wiki dir. Fresh => no-op, exit 0.
//
// Incremental stages (S6 groundwork; content-hash based):
//   scan   hash every file under the source roots -> manifest JSON
//   diff   compare a fresh scan against the saved state; --check for hooks
//   plan   print the regeneration actions the diff implies
//   run    execute the plan (optional --generator), then persist new state
//
// Wikis resolve as <wikis-dir>/<slug>/manifest.json (default ~/.coven/wikis),
// per the CovenWiki manifest contract. The regenerate generator command is a
// template: {repo}, {out}, {slug} are substituted before shell execution.
import { createHash } from "node:crypto";
import {
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildManifest,
  buildWikiStatus,
  computeSourceFingerprint,
  diffManifests,
  formatWikiStatus,
  nextState,
  parseState,
  parseWikiManifest,
  planRegeneration,
  serializeState,
  summarizePlan,
  validateWikiManifest,
  type Manifest,
  type SourceEntry,
  type StatEntry,
  type WikiManifest,
} from "../src/lib/covenwiki-regen.ts";

const STAGES = ["scan", "diff", "plan", "run"] as const;
const WIKI_COMMANDS = ["status", "regenerate"] as const;
type Stage = (typeof STAGES)[number];
type WikiCommand = (typeof WIKI_COMMANDS)[number];
type Command = Stage | WikiCommand;

type Options = {
  command: Command;
  slug: string | null;
  wikisDir: string;
  force: boolean;
  sources: string[];
  state: string;
  fullRebuild: string[];
  generator: string | null;
  json: boolean;
  check: boolean;
  dryRun: boolean;
};

const SKIP_DIRS = new Set([".git", "node_modules", ".worktrees", ".next", "target"]);
const DEFAULT_WIKIS_DIR = path.join(homedir(), ".coven", "wikis");
const DEFAULT_GENERATOR = "covenwiki generate --repo {repo} --out {out}";

function printHelp() {
  console.log(`Usage: node --experimental-strip-types scripts/covenwiki-regen.ts <command> [options]

Wiki commands (plan S1-S4; wikis resolve as <wikis-dir>/<slug>/manifest.json):
  status <slug>      S1+S2: report fresh|stale|unknown vs manifest.source.fingerprint (pure read)
  regenerate <slug>  S3+S4: if stale (or --force) re-run the generator into <wiki>.tmp,
                     validate fail-closed, then atomically swap over the live wiki

Incremental stages (S6 groundwork, content-hash based):
  scan   hash all wiki sources and print the manifest
  diff   compare a fresh scan with the saved state
  plan   show the regeneration actions the current diff implies
  run    execute the plan and persist the new state

Options:
  --wikis-dir <dir>      wiki store root (default: ~/.coven/wikis)
  --force                (regenerate) regenerate even when fresh
  --generator <cmd>      regenerate: command template, {repo}/{out}/{slug} substituted
                           (default: "${DEFAULT_GENERATOR}")
                         run: shell command; receives the plan JSON on stdin
  --source <path>        (stages) source root to scan (repeatable; default: docs)
  --state <file>         (stages) state file (default: .covenwiki/state.json)
  --full-rebuild <path>  (stages) path or dir/ prefix that forces a full rebuild (repeatable)
  --json                 emit machine-readable JSON instead of text
  --check                (diff/plan) exit 1 when regeneration is needed
  --dry-run              (regenerate/run) report without running the generator or writing
  -h, --help             show this help`);
}

function parseArgs(argv: string[]): Options {
  const first = argv[0];
  if (!first || first === "-h" || first === "--help") {
    printHelp();
    process.exit(first ? 0 : 1);
  }
  const known = [...STAGES, ...WIKI_COMMANDS] as string[];
  if (!known.includes(first)) throw new Error(`unknown command: ${first} (expected ${known.join("|")})`);
  const command = first as Command;
  const opts: Options = {
    command,
    slug: null,
    wikisDir: DEFAULT_WIKIS_DIR,
    force: false,
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
      case "--wikis-dir":
        opts.wikisDir = requireValue(argv, ++i, arg);
        break;
      case "--force":
        opts.force = true;
        break;
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
        if (!arg.startsWith("-") && opts.slug === null && isWikiCommand(command)) {
          opts.slug = arg;
          break;
        }
        throw new Error(`unsupported argument: ${arg}`);
    }
  }
  if (isWikiCommand(command) && !opts.slug) throw new Error(`${command} requires a wiki <slug>`);
  if (opts.sources.length === 0) opts.sources.push("docs");
  return opts;
}

function isWikiCommand(command: Command): command is WikiCommand {
  return (WIKI_COMMANDS as readonly string[]).includes(command);
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

/** scan: hash the source roots into a content manifest. */
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

// ─── Wiki commands (plan S1–S4) ─────────────────────────────────────────────

/** Stat-only inventory of a repo root, mirroring the fingerprint contract. */
function statInventory(repoRoot: string): StatEntry[] {
  const files: string[] = [];
  walk(repoRoot, files);
  return files.map((file) => {
    const st = statSync(file);
    return {
      path: path.relative(repoRoot, file).split(path.sep).join("/"),
      size: st.size,
      mtimeMs: st.mtimeMs,
    };
  });
}

type LiveSource = { fingerprint: string | null; fileCount: number | null };

function computeLiveSource(manifest: WikiManifest): LiveSource {
  const repoRoot = manifest.source.repoRoot;
  if (manifest.source.kind !== "local" || !repoRoot) return { fingerprint: null, fileCount: null };
  if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) return { fingerprint: null, fileCount: null };
  const inventory = statInventory(repoRoot);
  return { fingerprint: computeSourceFingerprint(inventory), fileCount: inventory.length };
}

function resolveWiki(opts: Options): { wikiDir: string; manifest: WikiManifest } {
  const slug = opts.slug!;
  if (slug.includes("/") || slug.includes("\\") || slug === "." || slug === "..") {
    throw new Error(`invalid slug: ${slug}`);
  }
  const wikiDir = path.join(opts.wikisDir, slug);
  const manifestPath = path.join(wikiDir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`wiki not found: ${manifestPath}`);
  const manifest = parseWikiManifest(readFileSync(manifestPath, "utf8"));
  if (manifest.slug !== slug) {
    throw new Error(`manifest slug "${manifest.slug}" does not match wiki directory "${slug}"`);
  }
  return { wikiDir, manifest };
}

/** S2 — status <slug>: pure read, exit 0 whenever a report was produced. */
function runStatus(opts: Options) {
  const { manifest } = resolveWiki(opts);
  const live = computeLiveSource(manifest);
  const status = buildWikiStatus(manifest, live.fingerprint, live.fileCount);
  if (opts.json) console.log(JSON.stringify(status, null, 2));
  else for (const line of formatWikiStatus(status)) console.log(line);
}

/**
 * S4 — fail-closed validation of a freshly generated wiki dir: the manifest
 * must parse clean, keep the slug, and every page/meta file it lists must
 * exist. Any error leaves the live wiki untouched.
 */
function validateGeneratedWiki(tmpDir: string, slug: string): string[] {
  const manifestPath = path.join(tmpDir, "manifest.json");
  if (!existsSync(manifestPath)) return [`generated wiki has no manifest.json (${manifestPath})`];
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    return ["generated manifest.json is not valid JSON"];
  }
  const errors = validateWikiManifest(data);
  if (errors.length > 0) return errors;
  const manifest = data as WikiManifest;
  if (manifest.slug !== slug) errors.push(`generated manifest slug "${manifest.slug}" does not match wiki "${slug}"`);
  for (const page of manifest.pages) {
    for (const rel of [page.path, page.meta]) {
      if (!existsSync(path.join(tmpDir, rel))) errors.push(`generated wiki is missing ${rel}`);
    }
  }
  return errors;
}

/** S3+S4 — regenerate <slug>: re-run the pipeline when stale, swap atomically. */
function runRegenerate(opts: Options) {
  const slug = opts.slug!;
  const { wikiDir, manifest } = resolveWiki(opts);
  const live = computeLiveSource(manifest);
  const status = buildWikiStatus(manifest, live.fingerprint, live.fileCount);
  const report = (extra: Record<string, unknown>) => {
    if (opts.json) console.log(JSON.stringify({ ...status, ...extra }, null, 2));
    else for (const line of formatWikiStatus(status)) console.log(line);
  };

  if (status.freshness === "fresh" && !opts.force) {
    report({ action: "none" });
    if (!opts.json) console.log("fresh — nothing to regenerate (use --force to override)");
    return;
  }
  if (status.freshness === "unknown") {
    // "unknown" never auto-regenerates; --force only helps when a local repo
    // root actually exists to regenerate from.
    const repoRoot = manifest.source.repoRoot;
    const forceable = opts.force && manifest.source.kind === "local" && repoRoot && existsSync(repoRoot);
    if (!forceable) {
      report({ action: "refused" });
      console.error(`refusing to regenerate: ${status.reason}`);
      process.exit(1);
    }
  }

  const repoRoot = manifest.source.repoRoot!;
  const tmpDir = `${wikiDir}.tmp`;
  const template = opts.generator ?? DEFAULT_GENERATOR;
  const command = template
    .replaceAll("{repo}", repoRoot)
    .replaceAll("{out}", tmpDir)
    .replaceAll("{slug}", slug);

  if (opts.dryRun) {
    report({ action: "would-regenerate", command });
    if (!opts.json) console.log(`dry run — would execute: ${command}`);
    return;
  }

  rmSync(tmpDir, { recursive: true, force: true });
  const result = spawnSync(command, { shell: true, stdio: ["ignore", "inherit", "inherit"] });
  if (result.status !== 0) {
    rmSync(tmpDir, { recursive: true, force: true });
    console.error(`generator failed (exit ${result.status ?? "signal"}); live wiki untouched`);
    process.exit(result.status ?? 1);
  }

  const errors = validateGeneratedWiki(tmpDir, slug);
  if (errors.length > 0) {
    for (const error of errors) console.error(`validation: ${error}`);
    console.error(`regenerated wiki failed validation; live wiki untouched (inspect ${tmpDir})`);
    process.exit(1);
  }

  // Swap: retire the live dir, promote the validated tmp dir, drop the backup.
  const backupDir = `${wikiDir}.old-${process.pid}`;
  rmSync(backupDir, { recursive: true, force: true });
  renameSync(wikiDir, backupDir);
  try {
    renameSync(tmpDir, wikiDir);
  } catch (error) {
    renameSync(backupDir, wikiDir);
    throw error;
  }
  rmSync(backupDir, { recursive: true, force: true });

  const refreshed = parseWikiManifest(readFileSync(path.join(wikiDir, "manifest.json"), "utf8"));
  const after = computeLiveSource(refreshed);
  const final = buildWikiStatus(refreshed, after.fingerprint, after.fileCount);
  if (opts.json) console.log(JSON.stringify({ ...final, action: "regenerated", command }, null, 2));
  else {
    for (const line of formatWikiStatus(final)) console.log(line);
    console.log(`regenerated ${slug} → ${wikiDir}`);
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.command === "status") {
    runStatus(opts);
    return;
  }
  if (opts.command === "regenerate") {
    runRegenerate(opts);
    return;
  }

  const manifest = scan(opts);

  if (opts.command === "scan") {
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

  if (opts.command === "diff" || opts.command === "plan") {
    if (opts.json) {
      console.log(JSON.stringify(opts.command === "diff" ? { diff } : { diff, plan }, null, 2));
    } else {
      const lines = opts.command === "diff" ? summarizePlan(diff, { dirty: diff.dirty, actions: [] }) : summarizePlan(diff, plan);
      for (const line of lines) console.log(line);
    }
    if (opts.check && diff.dirty) process.exit(1);
    return;
  }

  // run
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
