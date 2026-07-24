// @ts-nocheck
import assert from "node:assert/strict";
import {
  DEFAULT_JOURNAL_PROMPT,
  JOURNAL_PROMPT_PLACEHOLDERS,
  readStoredJournalPrompt,
  renderJournalPrompt,
  splitPromptSegments,
  writeStoredJournalPrompt,
} from "./journal-prompt.ts";

// ── The default template ──────────────────────────────────────────────────────
// The UI shows the template verbatim as "what will be sent", so the default
// must carry every placeholder and still read as the reflection ask.
for (const ph of JOURNAL_PROMPT_PLACEHOLDERS) {
  assert.ok(DEFAULT_JOURNAL_PROMPT.includes(ph), `default template carries ${ph}`);
}
assert.match(DEFAULT_JOURNAL_PROMPT, /first-person/i, "default still asks for a first-person reflection");

// ── Rendering ────────────────────────────────────────────────────────────────
{
  const out = renderJournalPrompt("As {familiar} on {date}:\n{context}", {
    familiar: "Sage",
    date: "June 20, 2026",
    context: "- Reply to Nova",
  });
  assert.equal(out, "As Sage on June 20, 2026:\n- Reply to Nova", "all three placeholders substitute");
}
{
  // A template that dropped {context} still gets the day's activity appended —
  // generation must stay grounded in what actually happened.
  const out = renderJournalPrompt("Reflect warmly, {familiar}.", {
    familiar: "Sage",
    date: "today",
    context: "2 responses.",
  });
  assert.match(out, /Reflect warmly, Sage\./, "custom text kept");
  assert.match(out, /Here is what happened today:\n2 responses\./, "context appended when {context} was dropped");
}
{
  const out = renderJournalPrompt("No placeholders at all.", { familiar: "x", date: "y", context: "  " });
  assert.equal(out, "No placeholders at all.", "blank context appends nothing");
}
{
  const out = renderJournalPrompt("{familiar} and {familiar}", { familiar: "Nova", date: "d", context: "" });
  assert.equal(out, "Nova and Nova", "repeated placeholders all substitute");
}

// ── Highlight segmentation ───────────────────────────────────────────────────
{
  const template = "Hello {familiar}, {date} was {unknown} fine";
  const segs = splitPromptSegments(template);
  assert.equal(segs.map((s) => s.text).join(""), template, "segments round-trip to the template");
  assert.deepEqual(
    segs.filter((s) => s.placeholder).map((s) => s.text),
    ["{familiar}", "{date}", "{unknown}"],
    "every {…} run reads as a placeholder (mirrors the prototype highlighter)",
  );
}
{
  assert.deepEqual(splitPromptSegments(""), [], "empty template → no segments");
  const solo = splitPromptSegments("{context}");
  assert.deepEqual(solo, [{ text: "{context}", placeholder: true }], "placeholder-only template");
  const braces = splitPromptSegments("a { not one } b");
  assert.equal(braces.filter((s) => s.placeholder).length, 1, "spaced braces still count as one {…} run");
}

// ── Persistence (localStorage with SSR guards) ───────────────────────────────
assert.equal(readStoredJournalPrompt(), null, "no window → read is null (SSR safe)");
writeStoredJournalPrompt("x"); // must not throw without a window

{
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  try {
    assert.equal(readStoredJournalPrompt(), null, "empty storage → default applies");
    writeStoredJournalPrompt("My custom template {context}");
    assert.equal(readStoredJournalPrompt(), "My custom template {context}", "custom template persists");
    writeStoredJournalPrompt(DEFAULT_JOURNAL_PROMPT);
    assert.equal(readStoredJournalPrompt(), null, "writing the default clears the override");
    writeStoredJournalPrompt("custom");
    writeStoredJournalPrompt("   ");
    assert.equal(readStoredJournalPrompt(), null, "a blank template clears the override");
    writeStoredJournalPrompt("custom");
    writeStoredJournalPrompt(null);
    assert.equal(readStoredJournalPrompt(), null, "null clears the override");
  } finally {
    delete globalThis.window;
  }
}

console.log("journal-prompt.test.ts: ok");
