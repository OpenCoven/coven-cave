import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { resolveWithinRoot } from "./home-browse.ts";

const ROOT = path.resolve("/home/alice");

test("empty/absent request resolves to the root itself", () => {
  assert.equal(resolveWithinRoot(ROOT, null), ROOT);
  assert.equal(resolveWithinRoot(ROOT, ""), ROOT);
  assert.equal(resolveWithinRoot(ROOT, "   "), ROOT);
});

test("a relative subpath resolves within the root", () => {
  assert.equal(resolveWithinRoot(ROOT, "code/my-app"), path.join(ROOT, "code", "my-app"));
});

test("an absolute path inside the root is accepted (reconstructed)", () => {
  assert.equal(resolveWithinRoot(ROOT, path.join(ROOT, "code")), path.join(ROOT, "code"));
});

test("escaping the root with .. is rejected", () => {
  assert.equal(resolveWithinRoot(ROOT, "../bob"), null);
  assert.equal(resolveWithinRoot(ROOT, "code/../../etc"), null);
});

test("an absolute path outside the root is rejected", () => {
  assert.equal(resolveWithinRoot(ROOT, "/etc/passwd"), null);
  assert.equal(resolveWithinRoot(ROOT, "/home/bob"), null);
});

test("the reconstructed path is derived from the fixed root, not the raw input", () => {
  // Even a request that resolves inside the root comes back joined off ROOT.
  const out = resolveWithinRoot(ROOT, "code/./sub");
  assert.equal(out, path.join(ROOT, "code", "sub"));
  assert.ok(out!.startsWith(ROOT + path.sep));
});
