import assert from "node:assert/strict";
import { parseLeadingMetadata } from "./library-metadata.ts";

// ── A real Sage research-note metadata paragraph ─────────────────
const NOTE = [
  "**Date:** 2026-06-11 **Source:** <https://github.com/batteryshark/nod> " +
    "**Stars:** 1 (fresh — v1.0.0 released Jun 10, 2026, ~12h ago) " +
    "**License:** AGPL-3.0 (self-host freely; hosted derivatives must share source) " +
    "**Stack:** Rust (63%) + Swift (18%) + TypeScript/HTML/CSS + Shell " +
    "**Author:** batteryshark (Stonefish Labs) " +
    "**Contributors:** batteryshark + Claude (listed as co-author in commits)",
  "",
  "## What This Is",
  "",
  "Some body prose.",
].join("\n");

const parsed = parseLeadingMetadata(NOTE);
assert.ok(parsed, "metadata paragraph should be detected");
const keys = parsed.entries.map((e) => e.key);
assert.deepEqual(
  keys,
  ["Date", "Source", "Stars", "License", "Stack", "Author", "Contributors"],
  "all bold labels parsed, in order",
);

// Values keep their full text including parens, URLs, and em-dashes.
const byKey = Object.fromEntries(parsed.entries.map((e) => [e.key, e.value]));
assert.equal(byKey.Date, "2026-06-11");
assert.equal(byKey.Source, "<https://github.com/batteryshark/nod>");
assert.equal(byKey.Stars, "1 (fresh — v1.0.0 released Jun 10, 2026, ~12h ago)");
assert.equal(byKey.Stack, "Rust (63%) + Swift (18%) + TypeScript/HTML/CSS + Shell");
assert.equal(byKey.Contributors, "batteryshark + Claude (listed as co-author in commits)");

// The metadata paragraph is stripped from the rest of the body.
assert.ok(!parsed.rest.includes("**Date:**"), "metadata removed from body");
assert.match(parsed.rest, /^## What This Is/, "body resumes at the first heading");

// ── Leading whitespace before the paragraph is tolerated ─────────
const padded = parseLeadingMetadata("\n\n**A:** one **B:** two\n\nrest");
assert.ok(padded, "leading blank lines tolerated");
assert.deepEqual(padded.entries.map((e) => e.key), ["A", "B"]);
assert.equal(padded.rest, "rest");

// ── Non-metadata prose is left untouched ─────────────────────────
assert.equal(
  parseLeadingMetadata("Just a normal paragraph with **bold** words."),
  null,
  "prose without bold-label pairs is not treated as metadata",
);
assert.equal(
  parseLeadingMetadata("**Only one:** label here, nothing else."),
  null,
  "a single label is not enough to qualify",
);
// ── A single leading subtitle/heading before the metadata is allowed ──
// Sage's notes commonly open with a bold tagline or an `## …` subtitle and
// THEN the metadata run; the grid should still lift the metadata, keeping the
// subtitle in the body (it renders below the grid).
const headed = parseLeadingMetadata("## Five products, one shape\n\n**A:** one **B:** two\n\nbody prose");
assert.ok(headed, "metadata after a single heading subtitle is detected");
assert.deepEqual(headed.entries.map((e) => e.key), ["A", "B"]);
assert.match(headed.rest, /^## Five products, one shape/, "subtitle stays at the top of the body");
assert.ok(!headed.rest.includes("**A:**"), "metadata removed from the body");
assert.match(headed.rest, /body prose/, "trailing body content is preserved");

const taglined = parseLeadingMetadata("**A bold tagline**\n\n**A:** one **B:** two\n\nrest");
assert.ok(taglined, "metadata after a single bold tagline is detected");
assert.deepEqual(taglined.entries.map((e) => e.key), ["A", "B"]);
assert.match(taglined.rest, /^\*\*A bold tagline\*\*/, "bold tagline stays in the body");

// ── An italic tagline subtitle before the metadata is allowed ────
const italic = parseLeadingMetadata("*A working synthesis on agent memory.*\n\n**Author:** Sage **Started:** 2026-05-30\n\nbody");
assert.ok(italic, "metadata after a single italic tagline is detected");
assert.deepEqual(italic.entries.map((e) => e.key), ["Author", "Started"]);
assert.match(italic.rest, /^\*A working synthesis on agent memory\.\*/, "italic tagline stays in the body");

// ── A stack of leading headings before the metadata is allowed ───
const stacked = parseLeadingMetadata("## Internal Synthesis Note\n### 2026-06-13\n\n**Prepared by:** Sage **Status:** Definitive\n\nbody");
assert.ok(stacked, "metadata after stacked headings is detected");
assert.deepEqual(stacked.entries.map((e) => e.key), ["Prepared by", "Status"]);
assert.match(stacked.rest, /^## Internal Synthesis Note\n### 2026-06-13/, "stacked headings stay in the body");

// ── Two separate subtitle blocks (heading then italic tagline) are skipped ──
const twoBlocks = parseLeadingMetadata("## Heading\n\n*tagline*\n\n**A:** one **B:** two");
assert.ok(twoBlocks, "metadata after two separate subtitle blocks is detected");
assert.deepEqual(twoBlocks.entries.map((e) => e.key), ["A", "B"]);

// Only subtitle/heading blocks are skipped — metadata buried under real prose
// (subtitle + a PROSE paragraph) is NOT swallowed; skipping stops at prose.
assert.equal(
  parseLeadingMetadata("## Heading\n\nSome intro prose.\n\n**A:** one **B:** two"),
  null,
  "metadata past a subtitle AND a prose paragraph is not treated as leading metadata",
);
// A multi-line first block (real prose, not a one-line subtitle) is not skipped.
assert.equal(
  parseLeadingMetadata("First line of prose\nsecond line\n\n**A:** one **B:** two"),
  null,
  "a multi-line opening paragraph is not treated as a skippable subtitle",
);

console.log("library-metadata.test.ts: all assertions passed");
