// @ts-nocheck
import assert from "node:assert/strict";
const { extractWikiLinks, uniqueWikiLinkTargets } = await import("./wiki-link-parser.ts");

// ── basic + alias ───────────────────────────────────────────────────────────
{
  const [l] = extractWikiLinks("see [[Onboarding]] here");
  assert.equal(l.target, "Onboarding", "target is the inner text");
  assert.equal(l.display, "Onboarding", "display defaults to the target");
  assert.equal(l.raw, "[[Onboarding]]", "raw keeps the brackets");
  assert.equal(l.index, 4, "index is the offset in the source");
}
{
  const [l] = extractWikiLinks("[[api-style-guide|the style guide]]");
  assert.equal(l.target, "api-style-guide", "target is before the pipe");
  assert.equal(l.display, "the style guide", "display is the alias after the pipe");
}

// ── whitespace + emptiness ──────────────────────────────────────────────────
assert.equal(extractWikiLinks("[[  Trimmed Me  ]]")[0].target, "Trimmed Me", "target is trimmed");
assert.deepEqual(extractWikiLinks("[[]] and [[   ]]"), [], "empty / blank targets are ignored");

// ── multiple + de-dupe ──────────────────────────────────────────────────────
assert.equal(extractWikiLinks("[[A]] then [[B]] then [[C]]").length, 3, "all links are returned");
assert.deepEqual(
  uniqueWikiLinkTargets("[[A]] [[a]] [[B]] [[b]] [[C]]"),
  ["A", "B", "C"],
  "unique targets are case-insensitive, first-seen order preserved",
);

// ── nested / malformed brackets never false-match ───────────────────────────
assert.deepEqual(extractWikiLinks("[[a][b]]"), [], "adjacent single-bracket runs are not a wiki-link");
assert.deepEqual(extractWikiLinks("[[a\nb]]"), [], "a target may not span lines");
assert.deepEqual(extractWikiLinks("a single [bracket] and [[x"), [], "unterminated / single brackets ignored");

// ── code regions are skipped ────────────────────────────────────────────────
assert.deepEqual(extractWikiLinks("`[[x]]`"), [], "inline code is not scanned for links");
assert.deepEqual(extractWikiLinks("```\n[[x]]\n```"), [], "fenced code is not scanned for links");
assert.deepEqual(extractWikiLinks("~~~\n[[x]]\n~~~"), [], "tilde fences are skipped too");
{
  // A real link survives even when a code span nearby also contains one; the
  // masked offset must still point at the real link in the original string.
  const links = extractWikiLinks("before `[[ignored]]` then [[Real]] after");
  assert.equal(links.length, 1, "only the non-code link is returned");
  assert.equal(links[0].target, "Real", "the surviving link is the one outside code");
  assert.equal(links[0].raw, "[[Real]]", "raw is sliced from the original at the right offset");
}

// ── cheap fast path ─────────────────────────────────────────────────────────
assert.deepEqual(extractWikiLinks("no links here at all"), [], "strings without [[ return empty");
assert.deepEqual(extractWikiLinks(""), [], "empty input is safe");

console.log("wiki-link-parser.test.ts: ok");
