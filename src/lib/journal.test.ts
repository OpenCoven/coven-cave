// @ts-nocheck
import assert from "node:assert/strict";
import {
  parseJournalEntry,
  formatJournalEntry,
  isEmptyEntry,
  entryPreview,
  buildJournalContext,
} from "./journal.ts";

// round-trip: format then parse yields the same fields
{
  const entry = { reflectedBy: "sage", generatedAt: "2026-06-20T18:40:00.000Z", reflection: "A good day.\n\nShipped the dashboard." };
  const md = formatJournalEntry(entry);
  const back = parseJournalEntry(md);
  assert.equal(back.reflectedBy, "sage");
  assert.equal(back.generatedAt, "2026-06-20T18:40:00.000Z");
  assert.equal(back.reflection, "A good day.\n\nShipped the dashboard.");
}

// parse tolerates a body with no frontmatter
{
  const back = parseJournalEntry("just some reflection text");
  assert.equal(back.reflectedBy, null);
  assert.equal(back.generatedAt, null);
  assert.equal(back.reflection, "just some reflection text");
}

// empty reflection => isEmptyEntry true
{
  assert.equal(isEmptyEntry({ reflectedBy: "sage", generatedAt: null, reflection: "   " }), true);
  assert.equal(isEmptyEntry({ reflectedBy: null, generatedAt: null, reflection: "hi" }), false);
}

// preview strips markdown and truncates
{
  const p = entryPreview({ reflectedBy: null, generatedAt: null, reflection: "# Title\n**Bold** and more text here" }, 12);
  assert.ok(p.length <= 12, "preview respects max");
  assert.doesNotMatch(p, /[#*]/, "preview strips markdown");
}

// context summarizes the day's items
{
  const ctx = buildJournalContext("2026-06-20", {
    reminders: [{ title: "Review retro" }],
    responses: [{ title: "Reply to Sage" }, { title: "Approve deploy" }],
    familiars: [],
  });
  assert.match(ctx, /2026-06-20/);
  assert.match(ctx, /Review retro/);
  assert.match(ctx, /Reply to Sage/);
  assert.match(ctx, /2 response/);
}

// context empty-state line when nothing happened
{
  const ctx = buildJournalContext("2026-06-20", { reminders: [], responses: [], familiars: [] });
  assert.match(ctx, /quiet|nothing/i, "empty day produces a clear line");
}

// The day pane's memory stats are one compact meta line, zero parts hidden.
{
  const { formatJournalMemoryMeta } = await import("./journal.ts");
  assert.equal(formatJournalMemoryMeta({ covenOrigin: 166, externalRuntimes: 0, runtimeMemory: 0 }), "166 Coven files");
  assert.equal(
    formatJournalMemoryMeta({ covenOrigin: 1, externalRuntimes: 2, runtimeMemory: 1 }),
    "1 Coven file · 2 external runtime files · 1 runtime file",
  );
  assert.equal(formatJournalMemoryMeta({ covenOrigin: 0, externalRuntimes: 0, runtimeMemory: 0 }), "No memory files yet");
}

console.log("journal.test.ts: ok");
