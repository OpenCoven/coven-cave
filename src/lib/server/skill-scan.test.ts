// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseFrontmatter, resolveRuntimeSkillRoots } from "./skill-scan.ts";

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

// A harness can advertise skills from user and plugin roots only if the chat
// runtime grants those exact directories. Missing roots stay absent rather
// than broadening access to a harness home directory.
{
  const home = await mkdtemp(path.join(tmpdir(), "cave-runtime-skill-roots-"));
  const covenSkillsRoot = path.join(home, "custom-coven", "skills");
  const codexSkills = path.join(home, ".codex", "skills");
  const pluginCache = path.join(home, ".codex", "plugins", "cache");
  const agentsSkills = path.join(home, ".agents", "skills");
  try {
    await Promise.all([
      mkdir(covenSkillsRoot, { recursive: true }),
      mkdir(codexSkills, { recursive: true }),
      mkdir(pluginCache, { recursive: true }),
      mkdir(agentsSkills, { recursive: true }),
    ]);
    assert.deepEqual(
      await resolveRuntimeSkillRoots({ homeDir: home, covenSkillsRoot }),
      await Promise.all(
        [covenSkillsRoot, codexSkills, pluginCache, agentsSkills].map((root) => realpath(root)),
      ),
      "only existing, narrow skill roots should become runtime resources",
    );
    assert.deepEqual(
      await resolveRuntimeSkillRoots({
        homeDir: home,
        covenSkillsRoot,
        coveredRoots: [path.join(home, ".agents")],
      }),
      await Promise.all([covenSkillsRoot, codexSkills, pluginCache].map((root) => realpath(root))),
      "a skill root already covered by a project grant should not receive a contradictory read-only grant",
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

console.log("skill-scan.test.ts: ok");
