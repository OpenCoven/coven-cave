#!/usr/bin/env node
// Repo-wide guard against committed merge-conflict markers.
//
// 23316da3 committed two unresolved conflict blocks into
// src/components/sidebar-minimal.tsx. The file stopped parsing, so every route
// 500'd — including /api/app/build-info — and main stayed broken until
// 4ea88862 (cave-tbdnt / cave-2hh5q). Nothing in the PR gate saw it.
//
// The per-file guards that exist are worth keeping: they name the defect
// precisely for the file they cover. But they only ever protect a file someone
// already thought to protect, which by definition excludes the next file this
// happens to. This is the repo-wide half.

import { execFileSync } from "node:child_process";

/**
 * Only `<<<<<<<` and `>>>>>>>` trigger a failure, never a bare `=======`.
 *
 * Seven `<` or `>` at the start of a line is not something any language,
 * markup, or comment style produces. Seven `=` at the start of a line is: it is
 * a Markdown setext H1 underline, and it also shows up in ASCII rules and
 * banner comments. A real conflict always carries an opening and a closing
 * marker, so dropping the ambiguous one costs no detection while removing the
 * whole false-positive class the bead warned about.
 *
 * Anchoring matters for the same reason — `=======` and `>>>>>>>` both appear
 * mid-line in legitimate code, so an unanchored search is unusable.
 */
const MARKER_PATTERN = "^(<{7}|>{7})( |$)";

/** Human-readable, so a failure explains itself without reading this file. */
const MARKER_DESCRIPTION = "a line beginning with <<<<<<< or >>>>>>>";

/**
 * Parses `git grep -nz` output.
 *
 * `-z` replaces the `:` field separators with NUL; records stay newline
 * terminated. It is worth the extra parsing because a path may legitimately
 * contain a colon, and colon-splitting would silently mis-attribute the hit.
 *
 * An unparseable record throws rather than being skipped. A guard that quietly
 * drops what it cannot read reports a clean tree for a dirty one, which is
 * exactly how the first version of this file passed a fixture full of markers.
 */
export function parseMarkerHits(output) {
  const hits = [];
  for (const record of output.split("\n")) {
    if (!record) continue;
    const fields = record.split("\0");
    if (fields.length < 3) {
      throw new Error(`unparseable git grep record: ${JSON.stringify(record)}`);
    }
    const [file, rawLine, ...rest] = fields;
    const line = Number.parseInt(rawLine, 10);
    if (!Number.isInteger(line)) {
      throw new Error(`unparseable git grep line number: ${JSON.stringify(record)}`);
    }
    hits.push({ file, line, text: rest.join("\0") });
  }
  return hits;
}

export function findConflictMarkers(cwd = process.cwd()) {
  let output = "";
  try {
    output = execFileSync(
      "git",
      // -I skips binaries, so a stray byte sequence in an image cannot fail the
      // build. -z keeps paths with spaces or newlines parseable.
      ["grep", "-nIzE", MARKER_PATTERN, "--", "."],
      { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (error) {
    // git grep exits 1 for "no matches", which is the healthy case. Anything
    // else — not a repository, a bad pattern — must fail loudly rather than be
    // read as a clean tree.
    if (error && error.status === 1 && !error.stderr?.toString().trim()) return [];
    throw error;
  }
  return parseMarkerHits(output);
}

function main() {
  const hits = findConflictMarkers();
  if (hits.length === 0) {
    console.log("✓ no committed conflict markers");
    return;
  }
  console.error(
    `✗ committed merge-conflict markers in ${new Set(hits.map((hit) => hit.file)).size} file(s):`,
  );
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}: ${hit.text.trimEnd()}`);
  }
  console.error("");
  console.error(`This check fails on ${MARKER_DESCRIPTION}.`);
  console.error("Finish the merge, or remove the markers, then commit again.");
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
