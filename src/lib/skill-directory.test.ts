import assert from "node:assert/strict";
import test from "node:test";

import {
  installCommand,
  quoteCliArg,
  sourceKey,
  sourceTarget,
  specificSkillName,
  stripFrontmatter,
  useCommand,
} from "./skill-directory.ts";
import type { SkillBrowserEntry } from "@/components/skill-browser";

// The helpers read a handful of identity fields off a directory entry; build
// minimal fixtures rather than whole rows.
function entry(partial: Partial<SkillBrowserEntry>): SkillBrowserEntry {
  return { id: "id", ...partial } as SkillBrowserEntry;
}

// ── sourceTarget: the install origin, however the entry names it ─────────────

test("sourceTarget prefers owner/repo, then package, then slug shape", () => {
  assert.equal(sourceTarget(entry({ owner: "Acme", repo: "Skills" })), "Acme/Skills");
  assert.equal(sourceTarget(entry({ packageName: "@acme/pack" })), "@acme/pack");
  // 3+ segment slug → the source is the first two segments (owner/repo).
  assert.equal(sourceTarget(entry({ slug: "a/b/c/d" })), "a/b");
  // 2-segment slug whose first part is a hostname → that host is the source.
  assert.equal(sourceTarget(entry({ slug: "example.com/skill" })), "example.com");
  // Plain 2-segment slug isn't a host → the whole slug is the source.
  assert.equal(sourceTarget(entry({ slug: "foo/bar" })), "foo/bar");
  // Nothing else → fall back to the slug, then the id.
  assert.equal(sourceTarget(entry({ slug: "solo" })), "solo");
  assert.equal(sourceTarget(entry({ id: "only-id" })), "only-id");
});

test("sourceKey lower-cases the target for grouping", () => {
  assert.equal(sourceKey(entry({ owner: "Acme", repo: "Skills" })), "acme/skills");
});

// ── specificSkillName: the --skill target within a multi-skill source ────────

test("specificSkillName names the skill only when the source holds many", () => {
  assert.equal(specificSkillName(entry({ owner: "Acme", repo: "Skills", id: "lint" })), "lint");
  assert.equal(specificSkillName(entry({ slug: "a/b/c/d" })), "c/d");
  // Dotted-host 2-seg slug addresses one skill → its id.
  assert.equal(specificSkillName(entry({ slug: "example.com/skill", id: "idv" })), "idv");
  // Whole-source targets carry no specific skill.
  assert.equal(specificSkillName(entry({ slug: "foo/bar" })), null);
  assert.equal(specificSkillName(entry({ id: "only-id" })), null);
});

// ── quoteCliArg: shell-safe only when needed ─────────────────────────────────

test("quoteCliArg leaves safe args bare and escapes the rest", () => {
  assert.equal(quoteCliArg("owner/repo_x.1@v:2+beta-1"), "owner/repo_x.1@v:2+beta-1");
  assert.equal(quoteCliArg("has space"), '"has space"');
  // Double-quote context: escape " \ $ ` so the shell can't reinterpret them.
  assert.equal(quoteCliArg('a"b$c`d\\e'), '"a\\"b\\$c\\`d\\\\e"');
});

// ── install / use commands ───────────────────────────────────────────────────

test("installCommand and useCommand add --skill and quote as needed", () => {
  assert.equal(installCommand(entry({ owner: "Acme", repo: "Skills", id: "lint rule" })), 'npx skills add Acme/Skills --skill "lint rule"');
  assert.equal(installCommand(entry({ slug: "foo/bar" })), "npx skills add foo/bar");
  assert.equal(useCommand(entry({ owner: "Acme", repo: "Skills", id: "lint" })), "npx skills use Acme/Skills --skill lint");
  assert.equal(useCommand(entry({ slug: "foo/bar" })), "npx skills use foo/bar");
});

// ── stripFrontmatter: drop the YAML block, keep the prose ────────────────────

test("stripFrontmatter removes a leading YAML block, BOM and CRLF included", () => {
  assert.equal(stripFrontmatter("﻿---\nname: X\ntags: [a]\n---\r\nBody here"), "Body here");
  assert.equal(stripFrontmatter("---\r\nname: X\r\n---\r\n\r\nBody"), "Body");
  // No frontmatter → unchanged (leading whitespace trimmed).
  assert.equal(stripFrontmatter("  Just prose"), "Just prose");
  assert.equal(stripFrontmatter("Line one\n---\nnot frontmatter"), "Line one\n---\nnot frontmatter");
});
