import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeRelSegments, resolveWithinRoot } from "./home-browse.ts";

const ROOT = path.resolve("/home/alice");

// ── Pure segment sanitizer (no fs) ──────────────────────────────────────────
test("empty/absent request yields no segments (the root itself)", () => {
  assert.deepEqual(sanitizeRelSegments(ROOT, null), []);
  assert.deepEqual(sanitizeRelSegments(ROOT, ""), []);
  assert.deepEqual(sanitizeRelSegments(ROOT, "   "), []);
});

test("a relative subpath yields its clean segments", () => {
  assert.deepEqual(sanitizeRelSegments(ROOT, "code/my-app"), ["code", "my-app"]);
  assert.deepEqual(sanitizeRelSegments(ROOT, "code/./sub"), ["code", "sub"]);
});

test("an absolute path inside the root is accepted", () => {
  assert.deepEqual(sanitizeRelSegments(ROOT, path.join(ROOT, "code")), ["code"]);
});

test("escaping the root is rejected", () => {
  assert.equal(sanitizeRelSegments(ROOT, "../bob"), null);
  assert.equal(sanitizeRelSegments(ROOT, "code/../../etc"), null);
  assert.equal(sanitizeRelSegments(ROOT, "/etc/passwd"), null);
  assert.equal(sanitizeRelSegments(ROOT, "/home/bob"), null);
});

// ── resolveWithinRoot walks real directory entries ──────────────────────────
test("resolveWithinRoot only descends into directories that actually exist", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "home-browse-"));
  try {
    fs.mkdirSync(path.join(base, "code", "my-app"), { recursive: true });
    fs.writeFileSync(path.join(base, "code", "notes.txt"), "x");

    assert.equal(resolveWithinRoot(base, ""), path.resolve(base));
    assert.equal(resolveWithinRoot(base, "code/my-app"), path.join(base, "code", "my-app"));
    // A non-existent directory → null (nothing to descend into).
    assert.equal(resolveWithinRoot(base, "code/ghost"), null);
    // A file (not a directory) → null.
    assert.equal(resolveWithinRoot(base, "code/notes.txt"), null);
    // Escapes are rejected before any walk.
    assert.equal(resolveWithinRoot(base, "../.."), null);

    // The returned path is rooted at `base` (built from fs entry names).
    const out = resolveWithinRoot(base, "code");
    assert.ok(out && out.startsWith(path.resolve(base) + path.sep));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
