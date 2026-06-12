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
assert.equal(
  parseLeadingMetadata("# Heading\n\n**A:** one **B:** two"),
  null,
  "metadata must be the first paragraph, not preceded by other content",
);

console.log("library-metadata.test.ts: all assertions passed");
