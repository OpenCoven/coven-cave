#!/usr/bin/env node
// cave-1poit: git merge driver for .beads/interactions.jsonl.
//
// THE PROBLEM THIS REPLACES. .gitattributes carried
// `.beads/interactions.jsonl merge=union`, added in #4184 to "preserve
// concurrent entries". Union does preserve them — by concatenating both sides
// of every conflicting hunk. When two branches carry the same appended block
// (routine, because bd re-exports the whole file), union keeps BOTH copies.
// That is exactly how main came to hold the same 6-record block twice at
// 4f3cb37c11, and 20 duplicate records by b9097e90ad. Union is not a union;
// it is a concatenation.
//
// WHAT THIS DOES INSTEAD. A real union, keyed by record id: concatenate both
// sides and keep the FIRST occurrence of each id. The result cannot contain a
// duplicate id by construction, and no record present on either side is lost.
//
// WHY FIRST-OCCURRENCE IS SAFE HERE, and why this driver is scoped to
// interactions.jsonl only: interaction records are an append-only audit log
// and immutable — a given id always denotes the same event, so choosing
// between two copies of it is not a choice at all. issues.jsonl is deliberately
// NOT routed here: its records are mutable, so first-occurrence-wins could
// silently keep a stale issue state. A loud conflict is the right outcome
// there.
//
// Invoked by git as:
//   node scripts/beads-jsonl-merge-driver.mjs "%O" "%A" "%B"
//   %O ancestor   %A ours (also the OUTPUT path)   %B theirs
// The placeholders are quoted in the git config as defence in depth. MEASURED
// behaviour (2026-08-03): git substitutes RELATIVE, space-free temp names in
// the repository root — argv came back as
//     [".merge_file_KoLys3", ".merge_file_49gj9e", ".merge_file_18nC3m"]
// even when the repository itself sat under a directory containing a space. So
// unquoted placeholders are not a live bug here, and a regression test for it
// cannot distinguish quoted from unquoted. Quoting is kept because it costs
// nothing if git ever passes a path instead; do not add a test that "proves"
// it, because it will pass either way.
//
// Exit codes: 0 = merged cleanly, 2 = called wrongly. This driver never
// reports a conflict (git's convention for that is a non-zero exit with
// markers left in %A) because a union keyed by an immutable record id has no
// conflicting case: every record from either side is kept exactly once.

import { readFileSync, writeFileSync } from "node:fs";

/** Split into records, tolerating a missing trailing newline and blank lines. */
function readLines(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // git passes an empty temp file for a side that does not have the file;
    // an unreadable path is treated as "contributed nothing" rather than fatal.
    return [];
  }
  return text.split("\n").filter((line) => line.trim() !== "");
}

/**
 * Union two sides by record id, first occurrence winning.
 *
 * Unkeyable lines — unparseable, or a record with no string id — cannot be
 * compared by identity, so they are deduplicated by exact text instead. That
 * keeps a malformed line rather than dropping it: this is an audit log, and
 * losing a line silently is worse than carrying an odd one.
 *
 * @param {string[]} ours
 * @param {string[]} theirs
 * @returns {{lines: string[], fromTheirs: number, droppedDuplicates: number}}
 */
export function unionByRecordId(ours, theirs) {
  const seenIds = new Set();
  const seenText = new Set();
  const lines = [];
  let fromTheirs = 0;
  let droppedDuplicates = 0;

  const take = (line, isTheirs) => {
    let id = null;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.id === "string" && parsed.id !== "") id = parsed.id;
    } catch {
      // unkeyable; fall through to text identity
    }
    if (id === null) {
      if (seenText.has(line)) {
        droppedDuplicates += 1;
        return;
      }
      seenText.add(line);
    } else {
      if (seenIds.has(id)) {
        droppedDuplicates += 1;
        return;
      }
      seenIds.add(id);
    }
    lines.push(line);
    if (isTheirs) fromTheirs += 1;
  };

  // "ours" first so the current branch's ordering is preserved; anything only
  // on the other side is appended in its own order.
  for (const line of ours) take(line, false);
  for (const line of theirs) take(line, true);
  return { lines, fromTheirs, droppedDuplicates };
}

function main(argv) {
  const [, ours, theirs] = argv; // %O is read for symmetry but not needed:
  // a union keyed by id needs no ancestor — every record on either side is
  // kept exactly once regardless of which side introduced it.
  if (!ours) {
    console.error("beads-jsonl-merge-driver: expected %O %A %B");
    return 2;
  }
  const merged = unionByRecordId(readLines(ours), readLines(theirs ?? ""));
  writeFileSync(ours, merged.lines.join("\n") + "\n");
  if (merged.droppedDuplicates > 0) {
    console.error(
      `beads-jsonl-merge-driver: merged ${merged.lines.length} records ` +
        `(${merged.fromTheirs} from the other side, ` +
        `${merged.droppedDuplicates} duplicate line(s) collapsed)`,
    );
  }
  return 0;
}

if (import.meta.url.startsWith("file:")) {
  const invoked = process.argv[1] ?? "";
  if (invoked.endsWith("beads-jsonl-merge-driver.mjs")) {
    process.exit(main(process.argv.slice(2)));
  }
}
