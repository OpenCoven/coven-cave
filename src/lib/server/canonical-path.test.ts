// @ts-nocheck
// Behavioral tests for realpathOrResolve (cave-s2l8): allow-list containment
// compares candidates against realpathed roots, so nonexistent candidates must
// canonicalize through their nearest existing ancestor — not fall back to a
// lexical resolve that diverges under symlinked ancestors (macOS /var ->
// /private/var tmpdir being the CI-visible case). Symlinks are created
// explicitly so the behavior is deterministic on every platform ("junction"
// works unprivileged on Windows and is ignored on POSIX).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { realpathOrResolve } from "./canonical-path.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "canonical-path-"));

try {
  const real = path.join(tmp, "real");
  const outside = path.join(tmp, "outside");
  mkdirSync(path.join(real, "sub"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  const link = path.join(tmp, "link");
  symlinkSync(real, link, "junction");
  const canonicalReal = realpathSync(real);
  const canonicalOutside = realpathSync(outside);

  // Existing path through a symlink: plain realpath behavior.
  assert.equal(
    realpathOrResolve(path.join(link, "sub")),
    path.join(canonicalReal, "sub"),
    "existing path canonicalizes through the symlinked ancestor",
  );

  // THE bug: a nonexistent tail under an existing (symlinked) directory must
  // land in the same canonical namespace as a realpathed allow-list root.
  assert.equal(
    realpathOrResolve(path.join(link, "sub", "missing")),
    path.join(canonicalReal, "sub", "missing"),
    "one missing segment canonicalizes the ancestor and re-appends the tail",
  );
  assert.equal(
    realpathOrResolve(path.join(link, "nope", "deeper", "still")),
    path.join(canonicalReal, "nope", "deeper", "still"),
    "multiple missing segments are preserved in order",
  );

  // Lexical `..` collapse happens before canonicalization (path.resolve
  // semantics, matching the previous fallback).
  assert.equal(
    realpathOrResolve(path.join(link, "sub", "..", "missing")),
    path.join(canonicalReal, "missing"),
    "dot-dot segments collapse lexically before ancestor resolution",
  );

  // Security tightening: a missing tail under a symlink that ESCAPES the root
  // must surface the escape (the old lexical fallback kept the candidate
  // looking contained).
  symlinkSync(outside, path.join(real, "escape"), "junction");
  assert.equal(
    realpathOrResolve(path.join(real, "escape", "missing")),
    path.join(canonicalOutside, "missing"),
    "missing tail under an escaping symlink canonicalizes out of the root",
  );

  // Nothing beneath an existing, non-symlinked dir changes shape.
  assert.equal(
    realpathOrResolve(path.join(canonicalReal, "plain-missing")),
    path.join(canonicalReal, "plain-missing"),
    "already-canonical prefixes are stable",
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("canonical-path.test.ts: ok");
