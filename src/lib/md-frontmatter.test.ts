import assert from "node:assert/strict";
import {
  parseMdDocument,
  serializeMdDocument,
  updateMdDocumentHeader,
  normalizeMdTags,
} from "./md-frontmatter.ts";

// No frontmatter: body passes through untouched.
{
  const doc = parseMdDocument("# Hello\n\nBody text.\n");
  assert.equal(doc.hasFrontmatter, false);
  assert.equal(doc.title, null);
  assert.deepEqual(doc.tags, []);
  assert.equal(doc.body, "# Hello\n\nBody text.\n");
  assert.equal(serializeMdDocument(doc), "# Hello\n\nBody text.\n", "no header added");
}

// Full round-trip preserves unknown keys.
{
  const raw = "---\ntitle: Launch week recap\ntags: [launch, retro]\nscope: global\nenabled: true\n---\n\nBody here.\n";
  const doc = parseMdDocument(raw);
  assert.equal(doc.hasFrontmatter, true);
  assert.equal(doc.title, "Launch week recap");
  assert.deepEqual(doc.tags, ["launch", "retro"]);
  assert.deepEqual(doc.rest, { scope: "global", enabled: true });
  assert.equal(doc.body.trim(), "Body here.");
  const out = serializeMdDocument(doc);
  assert.match(out, /^---\n/);
  assert.match(out, /title: Launch week recap/);
  assert.match(out, /scope: global/, "unknown key preserved");
  assert.match(out, /enabled: true/, "unknown key preserved");
  assert.match(out, /Body here\.\n$/);
  assert.deepEqual(parseMdDocument(out), doc, "stable round-trip");
}

// String tags normalize + dedupe; malformed YAML degrades to body.
{
  assert.deepEqual(parseMdDocument("---\ntags: a, b b\n---\nx").tags, ["a", "b"], "duplicates collapse");
  assert.deepEqual(parseMdDocument("---\ntags: [brief, brief, notes]\n---\nx").tags, ["brief", "notes"]);
  const bad = parseMdDocument("---\n: [unclosed\n---\nbody");
  assert.equal(bad.hasFrontmatter, false, "malformed yaml → treated as body");
  assert.match(bad.body, /unclosed/);
}

// updateMdDocumentHeader rewrites only title/tags.
{
  const raw = "---\ntitle: Old\ntags: [x]\nowner: kitty\n---\n\nKeep me.\n";
  const next = updateMdDocumentHeader(raw, { title: "New title", tags: ["a", "b"] });
  assert.match(next, /title: New title/);
  assert.match(next, /- a\n\s+- b|tags:\n\s+- a/, "tags rewritten");
  assert.match(next, /owner: kitty/, "unrelated key kept");
  assert.match(next, /Keep me\./);
  // Adding a header to a bare doc.
  const added = updateMdDocumentHeader("Just body.", { title: "T" });
  assert.match(added, /^---\ntitle: T\n---\n\nJust body\.\n$/);
  // Clearing title removes it.
  const cleared = updateMdDocumentHeader(next, { title: null });
  assert.doesNotMatch(cleared, /title:/);
  assert.match(cleared, /owner: kitty/);
}

// normalizeMdTags edge cases.
assert.deepEqual(normalizeMdTags(undefined), []);
assert.deepEqual(normalizeMdTags([1, " b ", ""]), ["1", "b"]);
assert.deepEqual(normalizeMdTags(["a", "a", "b"]), ["a", "b"], "array tags dedupe");

console.log("md-frontmatter.test: ok");
