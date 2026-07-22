// Source pins for the dedicated Ask Salem surface (mode "salem").
//
// The section's contract: answers are written by a user-picked familiar's
// already-connected model, grounded on the hosted docs index plus the local
// Cave index, with a thread that persists across visits. These pins keep the
// wiring honest without rendering React.

import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src/components/salem/ask-salem-view.tsx"),
  "utf8",
);

test("familiar picker drives the ask — options advertise the connected model", () => {
  assert.match(source, /pickAskFamiliar\(/, "default familiar comes from the shared fallback helper");
  assert.match(source, /familiarModelLabel|defaultModelForRuntime/, "options fall back to the harness default model label");
  assert.match(source, /\{f\.display_name\} — \{familiarModelLabel\(f\)\}/, "option text pairs familiar name with its model");
  assert.match(
    source,
    /aria-label="Familiar whose connected model writes the answers"/,
    "picker is labeled for assistive tech",
  );
});

test("ask flow posts familiarId + model + local context + history to /api/salem", () => {
  assert.match(source, /fetch\("\/api\/salem"/, "asks ride the existing salem route");
  assert.match(source, /familiarId: selectedFamiliar\.id/, "picked familiar attributed on the request");
  assert.match(source, /model: selectedFamiliar\.model/, "explicit model override only when the familiar pins one");
  assert.match(source, /buildAskSalemContext\(/, "local Cave index context built from gathered corpora");
  assert.match(source, /historyForApi\(messages\)/, "prior turns capped via the shared history helper");
});

test("local index corpora mirror the palette sources", () => {
  for (const endpoint of ["/api/chat/search?q=", "/api/board", "/api/coven-memory", "/api/memory"]) {
    assert.ok(source.includes(endpoint), `gathers ${endpoint}`);
  }
});

test("thread persists across visits and can be cleared", () => {
  assert.match(source, /loadThread\(window\.localStorage\)/, "thread restored on mount");
  assert.match(source, /saveThread\(window\.localStorage/, "turns saved as they land");
  assert.match(source, /clearThread\(window\.localStorage\)/, "clear action wipes storage");
  assert.match(source, /aria-label="Clear conversation"/, "clear button is labeled");
});

test("a11y: labeled section, labeled input, focus-ring on interactive chrome", () => {
  assert.match(source, /<section className="ask-salem" aria-label="Ask Salem">/);
  assert.match(source, /aria-label="Ask Salem a question"/);
  assert.match(source, /focus-ring/);
});

test("salem replies render markdown; requests degrade gracefully", () => {
  assert.match(source, /MarkdownBlock/, "salem turns render through the shared markdown block");
  assert.match(source, /catch/, "network failure produces an in-thread apology, not a crash");
});
