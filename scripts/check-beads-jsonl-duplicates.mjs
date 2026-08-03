#!/usr/bin/env node
// cave-1poit: refuse a `.beads/*.jsonl` file that carries the same record `id`
// twice.
//
// These files are append-only audit logs, not regenerable exports. Duplicates
// do not lose data, but a log that reports the same event twice cannot be used
// as evidence of what happened — and the obvious way to land pending records
// ("append the local file") silently propagates them.
//
// They arise from git TEXTUALLY merging an append-only JSONL: two sides append
// overlapping blocks and the merge keeps both. On main they were born at
// 4f3cb37c11, a plain "Merge branch main" (6 duplicates), and reached 20 via
// PR #4227, which appended records the base had regained through a different
// merge. Repaired in #4229; this exists so the condition cannot come back
// unnoticed.
//
// IMPORTANT — where this must run. `git merge` does NOT invoke the pre-commit
// hook, so a commit-time check alone would have missed the exact event that
// caused this. The authoritative gate is CI: main is protected, everything
// arrives via a PR, and the wired test calls this. The pre-commit hook is fast
// local feedback, not the guarantee.

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Scan JSONL text for repeated `id` values and unparseable lines.
 * Pure so it can be tested without touching the repo's real logs.
 *
 * @param {string} text
 * @returns {{duplicates: Array<{id: string, lines: number[], identical: boolean}>, malformed: Array<{line: number, error: string}>, records: number}}
 */
export function findDuplicateIds(text) {
  /** @type {Map<string, {lines: number[], texts: Set<string>}>} */
  const byId = new Map();
  const malformed = [];
  let records = 0;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      malformed.push({ line: i + 1, error: String(error?.message ?? error) });
      continue;
    }
    records += 1;
    // A record without an id cannot be deduplicated by id; that is a different
    // defect, so leave it alone rather than inventing a key for it.
    const id = parsed?.id;
    if (typeof id !== "string" || id === "") continue;
    const entry = byId.get(id) ?? { lines: [], texts: new Set() };
    entry.lines.push(i + 1);
    // Record the RAW line, not the trimmed one. `identical` is the signal that
    // a copy is safe to drop, and it claims byte-identity — comparing trimmed
    // text would call two lines identical when they differ by leading or
    // trailing whitespace, which is precisely the claim it must not overstate.
    entry.texts.add(raw);
    byId.set(id, entry);
  }

  const duplicates = [];
  for (const [id, entry] of byId) {
    if (entry.lines.length < 2) continue;
    // Worth distinguishing: byte-identical copies are safe to drop
    // (first-occurrence-wins). Differing copies sharing an id mean the log
    // disagrees with itself about one event, which a script must not resolve
    // on its own.
    duplicates.push({ id, lines: entry.lines, identical: entry.texts.size === 1 });
  }
  duplicates.sort((a, b) => a.lines[0] - b.lines[0]);
  return { duplicates, malformed, records };
}

/** Every tracked `.beads/*.jsonl` under `root`. */
export function beadsJsonlFiles(root) {
  const dir = join(root, ".beads");
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => join(dir, name))
    .filter((path) => {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * @param {string[]} files
 * @returns {{path: string, duplicates: any[], malformed: any[], records: number}[]}
 */
export function checkFiles(files) {
  return files.map((path) => ({
    path,
    ...findDuplicateIds(readFileSync(path, "utf8")),
  }));
}

function main(argv) {
  const root = process.cwd();
  const explicit = argv.filter((a) => !a.startsWith("-"));
  const files = explicit.length > 0 ? explicit : beadsJsonlFiles(root);
  if (files.length === 0) {
    console.log("check-beads-jsonl-duplicates: no .beads/*.jsonl files — nothing to check");
    return 0;
  }

  let failed = false;
  for (const result of checkFiles(files)) {
    const rel = result.path.startsWith(root) ? result.path.slice(root.length + 1) : result.path;
    if (result.malformed.length > 0) {
      failed = true;
      console.error(`✗ ${rel}: ${result.malformed.length} unparseable line(s)`);
      for (const m of result.malformed.slice(0, 5)) {
        console.error(`    line ${m.line}: ${m.error}`);
      }
    }
    if (result.duplicates.length > 0) {
      failed = true;
      const dupLines = result.duplicates.reduce((n, d) => n + d.lines.length - 1, 0);
      console.error(
        `✗ ${rel}: ${result.duplicates.length} duplicated id(s) across ${dupLines} extra line(s)`,
      );
      for (const d of result.duplicates.slice(0, 10)) {
        const how = d.identical ? "identical copies" : "DIFFERING copies — resolve by hand";
        console.error(`    ${d.id} at lines ${d.lines.join(", ")} (${how})`);
      }
      if (result.duplicates.length > 10) {
        console.error(`    … and ${result.duplicates.length - 10} more`);
      }
    }
    if (result.malformed.length === 0 && result.duplicates.length === 0) {
      console.log(`✓ ${rel}: ${result.records} records, no duplicate ids`);
    }
  }

  if (failed) {
    console.error("");
    console.error("These files are append-only audit logs. Duplicates usually mean a git merge");
    console.error("concatenated two divergent tails — see cave-1poit. Drop the later copy of each");
    console.error("id (first occurrence wins) ONLY when the copies are byte-identical.");
    return 1;
  }
  return 0;
}

// "Am I being run directly?" — compared as REAL paths, not as URL strings.
//
// Two ways the naive `import.meta.url === \`file://${process.argv[1]}\`` goes
// wrong, and both make main() silently never run, which is the worst failure
// mode for a checker:
//   1. no percent-encoding — a checkout under a path containing a space gives
//      `file:///tmp/a b/x.mjs` where import.meta.url is `file:///tmp/a%20b/x.mjs`;
//   2. symlinks — on macOS `/var` is a symlink to `/private/var`, so argv[1]
//      can be `/var/folders/...` while import.meta.url resolves to
//      `/private/var/folders/...`. pathToFileURL alone does NOT fix this.
// realpathSync on both sides collapses both cases. Verified by an executable
// test that runs this file from a temp directory whose name contains a space.
function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  process.exit(main(process.argv.slice(2)));
}
