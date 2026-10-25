// @ts-nocheck
// Behavioral tests for realpathOrResolve (cave-s2l8): allow-list containment
// compares candidates against realpathed roots, so nonexistent candidates must
// canonicalize through their nearest existing ancestor — not fall back to a
// lexical resolve that diverges under symlinked ancestors (macOS /var ->
// /private/var tmpdir being the CI-visible case). Symlinks are created
// explicitly so the behavior is deterministic on every platform ("junction"
// works unprivileged on Windows and is ignored on POSIX).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { realpathNativeOrResolve, realpathOrResolve } from "./canonical-path.ts";

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

  // realpathNativeOrResolve (#6216) walks the same way through the native
  // realpath, which reports on-disk letter case like the runtime cwd does.
  const nativeReal = realpathSync.native(real);
  assert.equal(realpathNativeOrResolve(link), nativeReal, "native: an existing symlink resolves to its target");
  assert.equal(
    realpathNativeOrResolve(path.join(link, "sub", "missing", "deeper")),
    path.join(nativeReal, "sub", "missing", "deeper"),
    "native: a missing tail under a symlinked ancestor keeps the ancestor's canonical prefix",
  );
  mkdirSync(path.join(tmp, "CaseProbe"));
  if (existsSync(path.join(tmp, "caseprobe"))) {
    mkdirSync(path.join(real, "OnDisk"));
    assert.equal(
      realpathNativeOrResolve(path.join(link, "ondisk", "missing")),
      path.join(nativeReal, "OnDisk", "missing"),
      "native: on a case-insensitive volume the existing part takes its on-disk case",
    );
    assert.equal(
      realpathOrResolve(path.join(link, "ondisk")),
      path.join(canonicalReal, "ondisk"),
      "the JS realpath keeps the spelled case, which is why runtime-cwd comparisons need the native form",
    );
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log("canonical-path.test.ts: ok");
