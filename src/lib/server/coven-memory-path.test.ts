// @ts-nocheck
import assert from "node:assert/strict";
import path from "node:path";
import { resolveCovenMemoryFullPath } from "./coven-memory-path.ts";

const HOME = "/home/u";
const fam = "sage";
const root = path.join(HOME, ".coven", "workspaces", "familiars");

// Happy path: relative "<fam>/<file>" → absolute under the familiar's memory dir.
{
  const out = resolveCovenMemoryFullPath({ path: "sage/2026-05-24.md", familiar_id: "sage" }, HOME);
  assert.equal(out, path.join(root, "sage", "memory", "2026-05-24.md"));
}

// Nested relative path is preserved under memory/.
{
  const out = resolveCovenMemoryFullPath({ path: "sage/sub/note.md", familiar_id: "sage" }, HOME);
  assert.equal(out, path.join(root, "sage", "memory", "sub", "note.md"));
}

// Path without the familiar prefix still resolves using familiar_id.
{
  const out = resolveCovenMemoryFullPath({ path: "2026-05-24.md", familiar_id: "sage" }, HOME);
  assert.equal(out, path.join(root, "sage", "memory", "2026-05-24.md"));
}

// Traversal in the remainder is rejected.
{
  const out = resolveCovenMemoryFullPath({ path: "sage/../../etc/passwd", familiar_id: "sage" }, HOME);
  assert.equal(out, undefined, "`..` segments must not produce a path");
}

// Traversal via familiar id is rejected.
{
  const out = resolveCovenMemoryFullPath({ path: "x.md", familiar_id: ".." }, HOME);
  assert.equal(out, undefined);
}

// Missing pieces → undefined.
assert.equal(resolveCovenMemoryFullPath({ path: "", familiar_id: "sage" }, HOME), undefined);
assert.equal(resolveCovenMemoryFullPath({ path: "x.md" }, HOME), undefined, "no familiar_id");
assert.equal(resolveCovenMemoryFullPath({ path: "sage", familiar_id: "sage" }, HOME), undefined, "path is just the familiar dir");

// An absolute path outside any allowed root is rejected.
{
  const out = resolveCovenMemoryFullPath({ path: "/etc/passwd", familiar_id: "sage" }, HOME);
  assert.equal(out, undefined);
}

// An absolute path inside an allowed root is honored.
{
  const abs = path.join(root, "sage", "memory", "2026-05-24.md");
  const out = resolveCovenMemoryFullPath({ path: abs, familiar_id: "sage" }, HOME);
  assert.equal(out, abs);
}

console.log("coven-memory-path: all assertions passed");
