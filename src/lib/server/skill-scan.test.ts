// @ts-nocheck
import assert from "node:assert/strict";
import { parseFrontmatter } from "./skill-scan.ts";

// Regression: skill `description:` is almost always a YAML block scalar
// (`description: |`). The old single-line parser captured just the "|"
// indicator, which surfaced as a near-empty Detail row in the capabilities
// inspector. The parser must now collect the full multi-line value.
{
  const fm = parseFrontmatter(`---
version: 0.3.0
name: higgsfield-generate
description: |
  Generate images/videos via Higgsfield AI.
  Second line of the blurb.
tags:
  - design
---
# body`);
  assert.equal(fm.name, "higgsfield-generate");
  assert.equal(fm.version, "0.3.0");
  assert.equal(
    fm.description,
    "Generate images/videos via Higgsfield AI.\nSecond line of the blurb.",
    "literal block scalar (|) must capture the full value, not the bare '|'",
  );
}

// Folded block scalar (`>`) joins wrapped lines with spaces.
{
  const fm = parseFrontmatter(`---
name: folded
description: >
  one
  two
---`);
  assert.equal(fm.description, "one two");
}

// Inline values still parse (and quotes are stripped).
{
  const fm = parseFrontmatter(`---
name: simple
description: A short one-liner
kind: "tool"
---`);
  assert.equal(fm.name, "simple");
  assert.equal(fm.description, "A short one-liner");
  assert.equal(fm.kind, "tool");
}

// An empty block scalar (no indented body) yields an empty string, never "|".
{
  const fm = parseFrontmatter(`---
name: empty
description: |
---`);
  assert.equal(fm.name, "empty");
  assert.notEqual(fm.description, "|");
  assert.equal(fm.description, "");
}

// No frontmatter → empty object.
{
  assert.deepEqual(parseFrontmatter("just a body, no frontmatter"), {});
}

console.log("skill-scan.test.ts: ok");
