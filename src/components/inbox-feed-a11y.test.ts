// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The Inbox view (mode "inbox") is AutomationsView's Inbox tab, whose feed is
// InboxFeedSection / InboxFeedRow. These pin the feed's accessibility structure.
const src = readFileSync(new URL("./automations-view.tsx", import.meta.url), "utf8");

// ── Sections are labelled regions with real headings ─────────────────────────
// Was: a styled <span> title inside a <div> with a bare <ul> — no heading
// navigation and no accessible name on the list.
assert.match(
  src,
  /<section className="mb-6" aria-labelledby=\{headingId\}>/,
  "each inbox feed section is a region labelled by its heading",
);
assert.match(
  src,
  /<h3 id=\{headingId\} className="text-\[12px\] font-bold"/,
  "the section title (Needs you / Active / Resolved) is a real heading, not a span",
);
assert.match(
  src,
  /<ul aria-labelledby=\{headingId\}>/,
  "the section list is named by its heading so screen readers announce which list it is",
);
assert.match(src, /const headingId = useId\(\);/, "each section gets a stable heading id");

// ── Selected inbox row announces itself ──────────────────────────────────────
assert.match(
  src,
  /aria-current=\{selected \? "true" : undefined\}/,
  "the open inbox row is aria-current, not just a background tint",
);

console.log("inbox-feed-a11y.test.ts: ok");
