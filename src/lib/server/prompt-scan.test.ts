// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanPromptsDir, mergePrompts } from "./prompt-scan.ts";

const root = await mkdtemp(path.join(tmpdir(), "prompt-scan-"));
try {
  const dir = path.join(root, "prompts");
  await mkdir(dir);

  await writeFile(
    path.join(dir, "code-review.md"),
    `---
name: Code review
description: Audit the current change
icon: ph:list-checks-bold
tags:
  - review
  - quality
---
Review the current change. End with a must-fix list.
`,
  );
  // Frontmatter only, no body → nothing to insert, must be skipped.
  await writeFile(path.join(dir, "empty.md"), `---\nname: Empty\n---\n`);
  // No frontmatter at all → id/name fall back to the filename.
  await writeFile(path.join(dir, "bare-note.md"), "Just a body, no frontmatter.\n");
  // Non-markdown files are ignored.
  await writeFile(path.join(dir, "ignore.txt"), "not a template");

  const out = [];
  await scanPromptsDir(dir, "user", out);

  assert.equal(out.length, 2, "body-less and non-md files are skipped");
  const review = out.find((p) => p.id === "code-review");
  assert.ok(review, "template id comes from the filename");
  assert.equal(review.name, "Code review", "name from frontmatter");
  assert.equal(review.description, "Audit the current change", "description from frontmatter");
  assert.equal(review.icon, "ph:list-checks-bold", "icon from frontmatter");
  assert.deepEqual(review.tags, ["review", "quality"], "tags list parsed");
  assert.equal(review.body, "Review the current change. End with a must-fix list.", "body excludes frontmatter");
  assert.equal(review.source, "user", "source is threaded through");
  assert.equal(review.path, path.join(dir, "code-review.md"), "absolute path recorded");

  const bare = out.find((p) => p.id === "bare-note");
  assert.ok(bare, "frontmatter-less file still scans");
  assert.equal(bare.name, "bare-note", "name falls back to the filename");
  assert.equal(bare.body, "Just a body, no frontmatter.", "whole file is the body");

  // Missing directory is silent (first run: ~/.coven/prompts doesn't exist).
  const missing = [];
  await scanPromptsDir(path.join(root, "nope"), "user", missing);
  assert.equal(missing.length, 0, "missing dir → empty, no throw");
} finally {
  await rm(root, { recursive: true, force: true });
}

// ── mergePrompts: user > pack > builtin, keyed by id ─────────────────────────
const builtin = [
  { id: "a", name: "A builtin", body: "b", source: "builtin" },
  { id: "b", name: "B builtin", body: "b", source: "builtin" },
];
const packs = [
  { id: "b", name: "B pack", body: "b", source: "pack:essentials" },
  { id: "c", name: "C pack", body: "b", source: "pack:essentials" },
];
const user = [{ id: "c", name: "C user", body: "b", source: "user" }];

const merged = mergePrompts(builtin, user, packs);
assert.equal(merged.length, 3, "merged by id");
assert.equal(merged.find((p) => p.id === "a")?.source, "builtin", "builtin survives when unshadowed");
assert.equal(merged.find((p) => p.id === "b")?.source, "pack:essentials", "pack overrides builtin");
assert.equal(merged.find((p) => p.id === "c")?.source, "user", "user overrides pack");
assert.deepEqual(mergePrompts(builtin, []), builtin, "packs param is optional");

console.log("prompt-scan.test.ts: ok");
