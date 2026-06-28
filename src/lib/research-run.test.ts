// @ts-nocheck
import assert from "node:assert/strict";
import {
  slugifyTopic,
  researchDocFilename,
  buildResearchPrompt,
  buildResearchDoc,
  normalizeTopic,
  RESEARCH_COLLECTION_DIR,
} from "./research-run.ts";

// ── slugifyTopic ────────────────────────────────────────────────
assert.equal(slugifyTopic("How do LLM agents use tools?"), "how-do-llm-agents-use-tools");
assert.equal(slugifyTopic("  Trailing & symbols!!  "), "trailing-symbols");
assert.equal(slugifyTopic("***"), "untitled", "empty -> untitled");
assert.ok(slugifyTopic("x".repeat(200)).length <= 60, "slug capped at 60");
assert.doesNotMatch(slugifyTopic("end with spaces   "), /-$/, "no trailing hyphen");

// ── researchDocFilename ─────────────────────────────────────────
assert.equal(
  researchDocFilename("React Server Components", "2026-06-28T12:00:00Z"),
  "2026-06-28-react-server-components.md",
);

// ── buildResearchPrompt ─────────────────────────────────────────
const prompt = buildResearchPrompt("  WebGPU adoption  ");
assert.match(prompt, /"WebGPU adoption"/, "embeds trimmed topic");
assert.match(prompt, /## Sources/, "asks for sources");
assert.match(prompt, /Do NOT include a YAML frontmatter/, "forbids frontmatter");

// ── buildResearchDoc ────────────────────────────────────────────
const doc = buildResearchDoc({
  topic: 'The "best" approach',
  body: "## Summary\n\nText.",
  familiar: "sage",
  dateIso: "2026-06-28T00:00:00Z",
});
assert.match(doc, /^---\n/, "starts with frontmatter");
assert.match(doc, /title: "The 'best' approach"/, "escapes quotes in title");
assert.match(doc, /familiar: sage/);
assert.match(doc, /date: 2026-06-28/);
assert.match(doc, /\n# The "best" approach\n/, "h1 title after frontmatter");
assert.match(doc, /## Summary/, "includes body");
assert.ok(doc.endsWith("\n"), "trailing newline");

// ── normalizeTopic ──────────────────────────────────────────────
assert.equal(normalizeTopic("ab"), null, "too short");
assert.equal(normalizeTopic("  valid topic  "), "valid topic", "trims");
assert.equal(normalizeTopic(123), null, "non-string");
assert.equal(normalizeTopic("x".repeat(600)), null, "too long");

assert.equal(RESEARCH_COLLECTION_DIR, "research");

console.log("research-run.test.ts passed");
