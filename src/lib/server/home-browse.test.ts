import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DRIVES_LOCATION,
  createSubdirInBrowsableDir,
  createSubdirWithinRoot,
  homeRoot,
  listSystemRoots,
  resolveBrowsableDir,
  resolveWithinRoot,
  sanitizeRelSegments,
} from "./home-browse.ts";

const ROOT = path.resolve("/home/alice");
const TEST_ARTIFACTS_ROOT = path.join(process.cwd(), ".test-artifacts");

const source = fs.readFileSync(new URL("./home-browse.ts", import.meta.url), "utf8");
assert.match(
  source,
  /path\.join\(\/\* turbopackIgnore: true \*\/ parent, name\)/,
  "dynamic user-home creation paths must not trace the entire checkout into the standalone bundle",
);
// CodeQL js/path-injection: the walk's anchor must be the allowlist's own
// element (server-derived), with the request-derived root used only in an
// equality check. PR #3728 alerts 88/135 regressed exactly this.
assert.match(
  source,
  /for \(const root of listSystemRoots\(\)\) \{\s*if \(root === wanted\) return root;/,
  "absolute walks must anchor on the listSystemRoots() allowlist element, never request-derived text",
);
assert.doesNotMatch(
  source,
  /resolveWithinRoot\(path\.parse\(/,
  "never anchor the trusted walk on a root parsed straight out of the request",
);

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

// ── Browsing above $HOME (volume roots / drives) ────────────────────────────
test("resolveBrowsableDir defaults to $HOME and keeps relative requests home-anchored", () => {
  assert.equal(resolveBrowsableDir(null), homeRoot());
  assert.equal(resolveBrowsableDir("   "), homeRoot());
  // Relative escapes above $HOME are still rejected — going higher requires
  // naming an absolute path, which then walks from its own volume root.
  assert.equal(resolveBrowsableDir("../../.."), null);
});

test("resolveBrowsableDir walks absolute paths from their own volume root", () => {
  withScratchDir((base) => {
    fs.mkdirSync(path.join(base, "repos", "app"), { recursive: true });

    assert.equal(resolveBrowsableDir(path.join(base, "repos", "app")), path.join(base, "repos", "app"));
    // The volume root itself is browsable (the picker just disables selecting it).
    const root = path.parse(homeRoot()).root;
    assert.equal(resolveBrowsableDir(root), root);
    // Nonexistent absolute paths still resolve to null.
    assert.equal(resolveBrowsableDir(path.join(base, "repos", "ghost")), null);
  });
});

test("listSystemRoots lists this machine's volume roots", () => {
  const roots = listSystemRoots();
  assert.ok(roots.length >= 1, "at least one volume root exists");
  for (const root of roots) {
    assert.equal(path.parse(root).root, root, `${root} is a bare volume root`);
  }
  if (process.platform !== "win32") assert.deepEqual(roots, ["/"]);
});

test("the drives pseudo-location is never a browsable or creatable real path", () => {
  assert.equal(DRIVES_LOCATION, "::drives");
  assert.equal(resolveBrowsableDir(DRIVES_LOCATION), null);
  assert.deepEqual(createSubdirInBrowsableDir(DRIVES_LOCATION, "child"), {
    ok: false,
    reason: "invalid-parent",
  });
});

test("createSubdirInBrowsableDir creates beneath absolute parents via their volume root", () => {
  withScratchDir((base) => {
    fs.mkdirSync(path.join(base, "repos"));

    assert.deepEqual(createSubdirInBrowsableDir(path.join(base, "repos"), "new-app"), {
      ok: true,
      path: path.join(base, "repos", "new-app"),
    });
    assert.deepEqual(createSubdirInBrowsableDir(path.join(base, "ghost"), "child"), {
      ok: false,
      reason: "invalid-parent",
    });
  });
});
