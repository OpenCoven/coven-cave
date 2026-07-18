import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createSubdirWithinRoot,
  resolveWithinRoot,
  sanitizeRelSegments,
} from "./home-browse.ts";

const ROOT = path.resolve("/home/alice");
const TEST_ARTIFACTS_ROOT = path.join(process.cwd(), ".test-artifacts");

function withScratchDir(run: (base: string) => void) {
  fs.mkdirSync(TEST_ARTIFACTS_ROOT, { recursive: true });
  const base = fs.mkdtempSync(path.join(TEST_ARTIFACTS_ROOT, "home-browse-"));
  try {
    run(base);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

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
  withScratchDir((base) => {
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
  });
});

test("createSubdirWithinRoot creates one trimmed child directory beneath an existing parent", () => {
  withScratchDir((base) => {
    fs.mkdirSync(path.join(base, "projects"));

    const result = createSubdirWithinRoot(base, "projects", "  new-app  ");

    assert.deepEqual(result, { ok: true, path: path.join(base, "projects", "new-app") });
    assert.equal(fs.statSync(path.join(base, "projects", "new-app")).isDirectory(), true);
  });
});

test("createSubdirWithinRoot rejects empty, whitespace, dot, and dot-dot names", () => {
  withScratchDir((base) => {
    fs.mkdirSync(path.join(base, "projects"));

    for (const name of ["", "   ", ".", ".."]) {
      assert.deepEqual(createSubdirWithinRoot(base, "projects", name), {
        ok: false,
        reason: "invalid-name",
      });
    }
  });
});

test("createSubdirWithinRoot rejects names with either path separator", () => {
  withScratchDir((base) => {
    fs.mkdirSync(path.join(base, "projects"));

    assert.deepEqual(createSubdirWithinRoot(base, "projects", "nested/child"), {
      ok: false,
      reason: "invalid-name",
    });
    assert.deepEqual(createSubdirWithinRoot(base, "projects", "nested\\child"), {
      ok: false,
      reason: "invalid-name",
    });
  });
});

test("createSubdirWithinRoot rejects an existing child", () => {
  withScratchDir((base) => {
    fs.mkdirSync(path.join(base, "projects", "existing"), { recursive: true });

    assert.deepEqual(createSubdirWithinRoot(base, "projects", "existing"), {
      ok: false,
      reason: "exists",
    });
  });
});

test("createSubdirWithinRoot rejects parents outside or missing beneath the root", () => {
  withScratchDir((base) => {
    fs.mkdirSync(path.join(base, "projects"));

    assert.deepEqual(createSubdirWithinRoot(base, "../elsewhere", "child"), {
      ok: false,
      reason: "invalid-parent",
    });
    assert.deepEqual(createSubdirWithinRoot(base, "missing", "child"), {
      ok: false,
      reason: "invalid-parent",
    });
  });
});
