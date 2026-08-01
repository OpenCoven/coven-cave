import assert from "node:assert/strict";
import {
  parseMdDocument,
  serializeMdDocument,
  updateMdDocumentHeader,
  normalizeMdTags,
  splitLeadingMdComments,
  joinLeadingMdComments,
} from "./md-frontmatter.ts";

const provenance = `<!-- research-provenance
mission: research-1
iteration: 1
-->

`;

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

// Leading provenance comments are hidden from the visual presentation only.
{
  const body = `${provenance}# Findings\n\nBody.\n`;
  const split = splitLeadingMdComments(body);
  assert.equal(split.hiddenPrefix, provenance);
  assert.equal(split.visibleBody, "# Findings\n\nBody.\n");
  assert.equal(
    joinLeadingMdComments(split.hiddenPrefix, "Edited body.\n"),
    `${provenance}Edited body.\n`,
  );
}

// Leading blank lines are hidden with the first complete leading comment.
{
  const body = "\n\n<!-- a -->\nbody";
  const split = splitLeadingMdComments(body);
  assert.equal(split.hiddenPrefix, "\n\n<!-- a -->\n");
  assert.equal(split.visibleBody, "body");
  assert.equal(joinLeadingMdComments(split.hiddenPrefix, split.visibleBody), body);
}

// Leading comments must not consume indentation from the first visible line.
{
  const body = "<!-- meta -->\n    code";
  const split = splitLeadingMdComments(body);
  assert.equal(split.hiddenPrefix, "<!-- meta -->\n");
  assert.equal(split.visibleBody, "    code");
  assert.equal(joinLeadingMdComments(split.hiddenPrefix, split.visibleBody), body);
}

// Multiple leading comments keep blank lines hidden without touching content.
{
  const body = "<!-- a -->\r\n\r\n<!-- b -->\r\n\r\ncode";
  const split = splitLeadingMdComments(body);
  assert.equal(split.hiddenPrefix, "<!-- a -->\r\n\r\n<!-- b -->\r\n\r\n");
  assert.equal(split.visibleBody, "code");
}

// Unclosed leading comments stay visible instead of being hidden.
{
  const body = "<!-- research-provenance\nmission: research-1\n# Findings\n\nBody.\n";
  assert.deepEqual(splitLeadingMdComments(body), {
    hiddenPrefix: "",
    visibleBody: body,
  });
}

// A malformed second leading comment stays visible instead of being swallowed.
{
  const body = "<!-- a -->\n\n<!-- broken\nbody";
  assert.deepEqual(splitLeadingMdComments(body), {
    hiddenPrefix: "<!-- a -->\n\n",
    visibleBody: "<!-- broken\nbody",
  });
}

// Internal comments that are not leading metadata stay visible.
{
  const body = `# Findings\n\n${provenance.trimEnd()}Body.\n`;
  assert.deepEqual(splitLeadingMdComments(body), {
    hiddenPrefix: "",
    visibleBody: body,
  });
}

// Stable hidden prefixes avoid duplicating a newly entered leading comment.
{
  const initial = splitLeadingMdComments("<!-- hidden -->\nbody\n");
  const firstVisibleBody = "<!-- entered -->\nbody\n";
  const firstRaw = joinLeadingMdComments(initial.hiddenPrefix, firstVisibleBody);
  assert.equal(firstRaw, "<!-- hidden -->\n<!-- entered -->\nbody\n");

  const secondVisibleBody = "<!-- entered -->\nbody\nmore\n";
  const secondRaw = joinLeadingMdComments(initial.hiddenPrefix, secondVisibleBody);
  assert.equal(secondRaw, "<!-- hidden -->\n<!-- entered -->\nbody\nmore\n");
  assert.equal(secondRaw.match(/<!-- entered -->/g)?.length ?? 0, 1);

  const unstableRaw = joinLeadingMdComments(
    splitLeadingMdComments(firstRaw).hiddenPrefix,
    secondVisibleBody,
  );
  assert.equal(unstableRaw, "<!-- hidden -->\n<!-- entered -->\n<!-- entered -->\nbody\nmore\n");
}

console.log("md-frontmatter.test: ok");
