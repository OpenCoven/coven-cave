// @ts-nocheck
import assert from "node:assert/strict";
import {
  chatSummaryTitle,
  defaultChatTitleForSession,
  disambiguateSessionTitles,
  MAX_SUMMARY_TITLE_LENGTH,
  MAX_SUMMARY_TITLE_WORDS,
  mergeSessionTitleOverrides,
  normalizeChatTitle,
  titleFromAssistantReply,
} from "./cave-chat-titles.ts";

const sessions = [
  { id: "s1", title: "daemon title", updated_at: "2026-06-01T00:00:00.000Z" },
  { id: "s2", title: "keep me", updated_at: "2026-06-01T00:00:01.000Z" },
];

assert.equal(normalizeChatTitle("  Renamed chat  "), "Renamed chat");
assert.equal(normalizeChatTitle("one\n  two\tthree"), "one two three");
assert.equal(normalizeChatTitle("   "), null);
assert.equal(normalizeChatTitle("x".repeat(130)), "x".repeat(120));
assert.equal(defaultChatTitleForSession("session-1234567890"), "New chat");
assert.equal(defaultChatTitleForSession(""), "New chat");
assert.equal(defaultChatTitleForSession(null), "New chat");

assert.deepEqual(
  mergeSessionTitleOverrides(sessions, {
    s1: "manual title",
    missing: "ignored",
    s2: "   ",
  }),
  [
    { id: "s1", title: "manual title", updated_at: "2026-06-01T00:00:00.000Z" },
    { id: "s2", title: "keep me", updated_at: "2026-06-01T00:00:01.000Z" },
  ],
);

// disambiguateSessionTitles — collisions get a relative-time suffix; uniques don't.
{
  const now = new Date();
  const iso = (minsAgo) => new Date(now.getTime() - minsAgo * 60000).toISOString();
  const rows = [
    { id: "a", title: "New chat", updated_at: iso(5) },
    { id: "b", title: "New chat", updated_at: iso(120) },
    { id: "c", title: "Fix the parser bug", updated_at: iso(10) },
  ];
  const map = disambiguateSessionTitles(rows);
  assert.notEqual(map.get("a"), "New chat", "colliding title gets a suffix");
  assert.notEqual(map.get("b"), "New chat", "the other colliding title gets a suffix");
  assert.notEqual(map.get("a"), map.get("b"), "the two collisions are now distinct");
  assert.match(map.get("a"), /^New chat · /, "suffix is appended after the title");
  assert.equal(map.get("c"), "Fix the parser bug", "a unique title is unchanged");
}
// missing updated_at on a collision → no crash, falls back to the bare title.
{
  const map = disambiguateSessionTitles([
    { id: "x", title: "New chat" },
    { id: "y", title: "New chat" },
  ]);
  assert.equal(map.get("x"), "New chat", "no time => no suffix, no crash");
  assert.equal(map.get("y"), "New chat");
}

// chatSummaryTitle — auto-naming threads from the first exchange.
{
  // Short prompts pass through filler-cleaned, already title-shaped.
  assert.equal(
    chatSummaryTitle({ userText: "please fix the search bar" }),
    "Fix the search bar",
  );
  // Long prompts fall back to an opening assistant heading when one exists.
  const longAsk =
    "I have been thinking about how our retry policy interacts with the queue " +
    "backoff settings and I want to understand what the best configuration is " +
    "for high-throughput consumers under sustained load";
  assert.equal(
    chatSummaryTitle({
      userText: longAsk,
      assistantText: "## Retry policy vs queue backoff\n\nHere is how they interact…",
    }),
    "Retry policy vs queue backoff",
  );
  // No usable heading → question lead-in stripped + word-boundary clamp.
  const noHeading = chatSummaryTitle({
    userText: "what's the best way to configure retry backoff for high-throughput queue consumers under sustained load",
    assistantText: "They interact in a few ways.",
  });
  assert.ok(noHeading.length <= MAX_SUMMARY_TITLE_LENGTH, "clamped to summary length");
  assert.match(noHeading, /^Best way to configure retry backoff/, "lead-in stripped, capitalized");
  // Nothing meaningful → null (caller keeps the current title).
  assert.equal(chatSummaryTitle({ userText: "   ", assistantText: "" }), null);
  assert.equal(chatSummaryTitle({}), null);
}

// titleFromAssistantReply — only clean, early, plausible headings count.
{
  assert.equal(
    titleFromAssistantReply("# **Fixing the parser** 🎉\nbody"),
    "Fixing the parser",
    "markdown syntax and edge emoji stripped",
  );
  assert.equal(titleFromAssistantReply("no headings here\njust text"), null);
  assert.equal(
    titleFromAssistantReply("line one\nline two\nline three\n# Too late"),
    null,
    "headings after the opening lines are ignored",
  );
  assert.equal(titleFromAssistantReply(null), null);
}

// ── Generated title contract ─────────────────────────────────────────────────
// MAX_SUMMARY_TITLE_WORDS is the word cap for all auto-generated titles.
assert.equal(typeof MAX_SUMMARY_TITLE_WORDS, "number");

// Question/request framing stripped in generated titles.
assert.equal(
  chatSummaryTitle({ userText: "How do I configure retry backoff?" }),
  "Configure retry backoff",
  "question lead-in and trailing ? stripped from short user prompt",
);

// Long user prompt: ≤40 chars, ≤7 words, word-boundary truncated.
{
  const longPrompt =
    "Please help me carefully investigate and repair the unusually slow project session synchronization behavior today";
  const title = chatSummaryTitle({ userText: longPrompt });
  assert.ok(title !== null, "long prompt yields a title");
  assert.ok(title.length <= 40, `title ≤40 chars (got ${title.length}): "${title}"`);
  const wordCount = title.replace(/…$/, "").trimEnd().split(/\s+/).length;
  assert.ok(
    wordCount <= MAX_SUMMARY_TITLE_WORDS,
    `title ≤${MAX_SUMMARY_TITLE_WORDS} words (got ${wordCount}): "${title}"`,
  );
}

// Answer-heading boilerplate stripped from assistant headings.
assert.equal(
  titleFromAssistantReply("## **Here is the deployment rollback safety checklist** 🎉"),
  "Deployment rollback safety checklist",
  "answer-heading boilerplate and markdown stripped from assistant heading",
);

// All generated results must satisfy ≤40 chars and ≤7 words.
{
  const cases: Array<[string, string | null]> = [
    ["short user prompt", chatSummaryTitle({ userText: "please fix the search bar" })],
    ["question lead-in", chatSummaryTitle({ userText: "How do I configure retry backoff?" })],
    ["markdown heading", titleFromAssistantReply("# **Fixing the parser** 🎉\nbody")],
    ["boilerplate heading", titleFromAssistantReply("## **Here is the deployment rollback safety checklist** 🎉")],
  ];
  for (const [label, t] of cases) {
    assert.ok(t !== null, `${label}: expected non-null result`);
    assert.ok(t.length <= 40, `${label}: ≤40 chars — "${t}" (${t.length})`);
    const wc = t.replace(/…$/, "").trimEnd().split(/\s+/).length;
    assert.ok(wc <= MAX_SUMMARY_TITLE_WORDS, `${label}: ≤${MAX_SUMMARY_TITLE_WORDS} words — "${t}" (${wc})`);
  }
}

// Empty/unusable input remains null (no regression).
assert.equal(chatSummaryTitle({ userText: null }), null);
assert.equal(chatSummaryTitle({ userText: "" }), null);
assert.equal(titleFromAssistantReply(""), null);

// normalizeChatTitle max stays at 120 — manual titles not shortened.
assert.equal(normalizeChatTitle("x".repeat(130))!.length, 120, "manual title max 120 unchanged");

// ── Review issue 1: clamp must not return null for multiword strings ──────────
// When the last space falls before the 60% threshold, the old code returned null
// so the caller kept the current (stale) title. The fix always backs up to the
// last word boundary — only a *truly* single-token over-length string (no spaces
// at all) may yield null. Multiword strings must never be silently dropped.
{
  // "A " + 50 a's: space at index 1 < 24 (= 60 % of 40). Buggy code → null.
  // Fixed code → "A…" (cut at the only word boundary).
  const r = titleFromAssistantReply("# A " + "a".repeat(50));
  assert.ok(r !== null, "multiword long title must not collapse to null — must cut at last word boundary");
  assert.equal(r, "A…", "clamp backs up to word boundary even when space is before 60% threshold");
}

// ── Review issue 2: Markdown stripping ───────────────────────────────────────
// Image syntax: already handled (was the bug that produced "!diagram"; fixed).
assert.equal(
  chatSummaryTitle({ userText: "![diagram](https://example.com/img.png)" }),
  "Diagram",
  "image syntax stripped to alt text (no leading !)",
);
// Strikethrough: ~~text~~ must reduce to its plain content.
assert.equal(
  titleFromAssistantReply("# ~~Fix parser~~"),
  "Fix parser",
  "strikethrough syntax stripped in assistant heading",
);
assert.equal(
  chatSummaryTitle({ userText: "~~Fix parser~~" }),
  "Fix parser",
  "strikethrough syntax stripped in user text",
);
assert.equal(
  chatSummaryTitle({ userText: "> Fix parser" }),
  "Fix parser",
  "blockquote marker stripped from user text",
);
assert.equal(
  titleFromAssistantReply("> ## Retry policy"),
  "Retry policy",
  "blockquote marker stripped before assistant heading detection",
);
assert.equal(
  chatSummaryTitle({ userText: "[Retry docs][retries]" }),
  "Retry docs",
  "full reference link yields its label",
);
assert.equal(
  chatSummaryTitle({ userText: "[Retry docs][]" }),
  "Retry docs",
  "collapsed reference link yields its label",
);
assert.equal(
  chatSummaryTitle({ userText: "[Retry docs]" }),
  "Retry docs",
  "shortcut reference link yields its label",
);

// ── Review issue 3: VS16 / ZWJ emoji sequences fully stripped at edges ────────
// ❤️ = U+2764 (Extended_Pictographic) + U+FE0F (VS16, variation selector).
// Without the fix U+FE0F is not in EMOJI_RE and leaks into the output as an
// invisible combining character, producing "️ Fix parser" or "Trailing ❤️".
assert.equal(
  titleFromAssistantReply("# \u2764\uFE0F Fix parser"),
  "Fix parser",
  "leading emoji with VS16 variation selector fully stripped",
);
{
  const r = chatSummaryTitle({ userText: "trailing \u2764\uFE0F" });
  assert.equal(r, "Trailing", "trailing emoji with VS16 fully stripped — no invisible residue");
}
// ZWJ sequence: 👩‍💻 = U+1F469 + U+200D (ZWJ) + U+1F4BB.
// Without the fix the ZWJ and second emoji leak past the strip, producing
// "‍💻 Fix parser" as the title.
assert.equal(
  titleFromAssistantReply("# \u{1F469}\u200D\u{1F4BB} Fix parser"),
  "Fix parser",
  "leading ZWJ emoji sequence fully stripped",
);
// Multi-member ZWJ family: 👨‍👩‍👧‍👦 = U+1F468 ZWJ U+1F469 ZWJ U+1F467 ZWJ U+1F466.
// Four emojis joined by three ZWJ codes — must be consumed as a single sequence.
assert.equal(
  chatSummaryTitle({ userText: "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} Fix" }),
  "Fix",
  "leading multi-member ZWJ family sequence fully stripped",
);
assert.equal(
  titleFromAssistantReply("# \u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466} Fix parser"),
  "Fix parser",
  "leading ZWJ family sequence in heading fully stripped",
);
// VS15 (U+FE0E) requests text presentation; the base character is still
// Extended_Pictographic and its VS15 suffix must be consumed as part of the
// cluster so it does not leak as an invisible residue in the stripped output.
// "❤︎ Fix" = U+2764 + U+FE0E (VS15) + space + Fix.
assert.equal(
  chatSummaryTitle({ userText: "\u2764\uFE0E Fix" }),
  "Fix",
  "leading emoji with VS15 (text variation selector) fully stripped",
);
assert.equal(
  titleFromAssistantReply("# \u2764\uFE0E Fix parser"),
  "Fix parser",
  "leading VS15 emoji in heading fully stripped",
);
{
  const r = chatSummaryTitle({ userText: "trailing \u2764\uFE0E" });
  assert.equal(r, "Trailing", "trailing VS15 emoji fully stripped — no U+FE0E residue");
}
assert.equal(
  chatSummaryTitle({ userText: "1\uFE0F\u20E3 Fix parser" }),
  "Fix parser",
  "leading keycap emoji sequence fully stripped",
);
assert.equal(
  chatSummaryTitle({ userText: "Fix parser #\uFE0F\u20E3" }),
  "Fix parser",
  "trailing keycap emoji sequence fully stripped",
);

// ── Review issue 4: Unicode sentence-ending punctuation stripped at title end ──
// ASCII .!? were already stripped; 。(U+3002) ！(U+FF01) ？(U+FF1F) were not.
assert.equal(
  chatSummaryTitle({ userText: "Fix the parser\u3002" }),
  "Fix the parser",
  "ideographic full stop \u3002 stripped from title end",
);
assert.equal(
  chatSummaryTitle({ userText: "Fix the parser\uFF01" }),
  "Fix the parser",
  "fullwidth exclamation mark \uFF01 stripped from title end",
);
assert.equal(
  chatSummaryTitle({ userText: "Fix the parser\uFF1F" }),
  "Fix the parser",
  "fullwidth question mark \uFF1F stripped from title end",
);

// ── Task 2 adjacent gap: punctuation before closing delimiters ────────────────

// Sentence punctuation immediately before a closing quote is stripped;
// the closing quote itself is preserved.
assert.equal(
  chatSummaryTitle({ userText: '"Fix parser."' }),
  '"Fix parser"',
  'period before straight double-quote stripped; quote preserved',
);
assert.equal(
  chatSummaryTitle({ userText: "'Fix parser.'" }),
  "'Fix parser'",
  "period before straight single-quote stripped; quote preserved",
);
// Unicode right double quotation mark U+201D.
assert.equal(
  chatSummaryTitle({ userText: "\u201CFix parser.\u201D" }),
  "\u201CFix parser\u201D",
  "period before Unicode right double quote \u201D stripped; quote preserved",
);

// Punctuation immediately before a closing paren is stripped.
assert.equal(
  chatSummaryTitle({ userText: "(Fix parser.)" }),
  "(Fix parser)",
  "period before closing paren stripped; paren preserved",
);

// Mixed punctuation runs before a closing delimiter are fully stripped.
assert.equal(
  chatSummaryTitle({ userText: '"Fix parser!?"' }),
  '"Fix parser"',
  "mixed punctuation run before closing double-quote fully stripped",
);

// Formatter-added truncation ellipsis is NOT affected by the cleanup —
// it is added AFTER cleanup runs, so it must appear in the output when the
// source is long enough to trigger truncation.
{
  // 8 content words + period before closing quote → period cleaned, then word
  // cap fires and the formatter appends its own … signal.
  const truncResult = chatSummaryTitle({
    userText: '"Implement the new feature for the search component right now."',
  });
  assert.ok(truncResult !== null, "truncation test: long source must yield a title");
  assert.ok(truncResult!.endsWith("…"), `truncation test: formatter must add … for long source, got "${truncResult}"`);
  assert.ok(!truncResult!.includes("."), `truncation test: source period must be cleaned before truncation, got "${truncResult}"`);
}

// ── Formatter edge cases (Task 2 spec gaps) ──────────────────────────────────

// Gap 2a: Markdown link syntax → label only, destination discarded.
assert.equal(
  chatSummaryTitle({ userText: "[our docs](https://example.com)" }),
  "Our docs",
  "markdown link yields label, destination discarded",
);

// Gap 2b: Emoji removal works adjacent to trailing punctuation.
assert.equal(
  titleFromAssistantReply("# Fix parser 🎉."),
  "Fix parser",
  "emoji removal works adjacent to trailing punctuation",
);

// Gap 2c: Conversational framing stripped even when passed directly through
// the shared formatter (not only via cleanPromptForTitle pre-pass).
assert.equal(
  chatSummaryTitle({ userText: "Can you configure retries?" }),
  "Configure retries",
  "conversational framing stripped in shared formatter path",
);

// Gap 2d: Boilerplate-only input yields null, not a stub title.
assert.equal(
  chatSummaryTitle({ userText: "This is." }),
  null,
  "boilerplate-only yields null",
);

// Gap 2e: Two-character meaningful topics are preserved.
assert.equal(
  chatSummaryTitle({ userText: "AI" }),
  "AI",
  "two-character meaningful topic preserved",
);

// Gap 2f: A single token longer than 40 chars yields null — no mid-word
// fragment. Callers retain the current/default title.
{
  const longToken = "a".repeat(41);
  const result = chatSummaryTitle({ userText: longToken });
  assert.equal(result, null, "single token >40 chars yields null, not a fragment");
}

// ── Long/over-limit inputs: ≤40 chars, ≤7 words, differs from raw input ──────
{
  const overLimitUser =
    "I need detailed guidance on designing and implementing a robust distributed caching layer " +
    "with automatic failover for high-throughput microservices handling session management at scale";
  const result = chatSummaryTitle({ userText: overLimitUser });
  assert.ok(result !== null, "over-limit user text yields a title");
  assert.ok(
    result.length <= MAX_SUMMARY_TITLE_LENGTH,
    `over-limit user text ≤${MAX_SUMMARY_TITLE_LENGTH} chars: "${result}" (${result.length})`,
  );
  const wc = result.replace(/…$/, "").trimEnd().split(/\s+/).length;
  assert.ok(
    wc <= MAX_SUMMARY_TITLE_WORDS,
    `over-limit user text ≤${MAX_SUMMARY_TITLE_WORDS} words: "${result}" (${wc})`,
  );
  assert.notEqual(result, overLimitUser, "output differs from raw input");
}

// ── Task 2 follow-up: C formatter gaps ──────────────────────────────────────

// C1: Here's (straight apostrophe) boilerplate stripped, same as "Here is".
assert.equal(
  chatSummaryTitle({ userText: "Here's the fix" }),
  "Fix",
  "Here's (straight apostrophe) boilerplate stripped",
);
assert.equal(
  chatSummaryTitle({ userText: "Here's your answer" }),
  "Your answer",
  "Here's (straight apostrophe) strips boilerplate and article",
);

// C1: Here's (Unicode right single quote U+2019) treated identically.
assert.equal(
  chatSummaryTitle({ userText: "Here\u2019s the deployment guide" }),
  "Deployment guide",
  "Here\u2019s (Unicode right single quote) boilerplate stripped",
);

// C7: Boilerplate-only variants with trailing punctuation → null.
assert.equal(
  chatSummaryTitle({ userText: "Here's." }),
  null,
  "Here's. (boilerplate + period, no content) yields null",
);
assert.equal(
  chatSummaryTitle({ userText: "Here\u2019s." }),
  null,
  "Here\u2019s. (Unicode, boilerplate + period, no content) yields null",
);

// C2: Trailing ,  :  ; stripped (in addition to existing . ! ?).
assert.equal(
  titleFromAssistantReply("## Fix the parser, add tests,"),
  "Fix the parser, add tests",
  "trailing comma stripped from generated title",
);
assert.equal(
  chatSummaryTitle({ userText: "Deployment guide:" }),
  "Deployment guide",
  "trailing colon stripped from title",
);

// C3: Leading separator exposed after emoji removal is stripped.
assert.equal(
  chatSummaryTitle({ userText: "🎉: Fix parser" }),
  "Fix parser",
  "🎉: prefix — leading separator after emoji removal is stripped",
);

// C4: Markdown image → alt text kept; empty alt → nothing (yields null).
assert.equal(
  chatSummaryTitle({ userText: "![diagram](img.png)" }),
  "Diagram",
  "markdown image with non-empty alt → alt text as title",
);
assert.equal(
  chatSummaryTitle({ userText: "![](img.png)" }),
  null,
  "markdown image with empty alt → null (no content)",
);
// ! must not leak from image syntax into the title.
{
  const imageResult = chatSummaryTitle({ userText: "![diagram](img.png)" });
  assert.ok(imageResult !== null && !imageResult.includes("!"), "! does not leak from markdown image syntax");
}

// C5: Markdown link with one level of nested parentheses in destination.
assert.equal(
  chatSummaryTitle({ userText: "[Docs](https://x.test/a_(b))" }),
  "Docs",
  "markdown link with nested parens in destination → label only, no URL or parens leak",
);

// C6: Multiword input where the only word boundary is before the 60% threshold —
// must cut at the word boundary and yield a title, not null. Returning null here
// would silently discard the title for any prompt with a short first word and a
// long second token (the exact bug fixed in Review issue 1).
{
  const prefixedGiant = "Fix " + "a".repeat(38); // 42 chars: "Fix " + 38 a's
  const r = chatSummaryTitle({ userText: prefixedGiant });
  assert.ok(r !== null, "prefixed giant: multiword string must yield a result at word boundary, not null");
  assert.equal(r, "Fix…", "prefixed giant: cut at word boundary even when space is before 60% threshold");
}

// Important follow-up: preserve newlines until line-oriented Markdown cleanup.
assert.equal(
  chatSummaryTitle({
    userText: "Fix parser\n> quoted context\n[details]: https://example.com/parser",
  }),
  "Fix parser quoted context",
  "multiline blockquote markers and reference definitions are cleaned before whitespace collapses",
);
assert.equal(
  chatSummaryTitle({
    userText: "- Fix parser\n* Add focused tests\n+ Keep the text",
  }),
  "Fix parser Add focused tests Keep the…",
  "unordered list markers are stripped per line before whitespace collapses",
);
assert.equal(
  chatSummaryTitle({
    userText: "1. Fix parser\n2) Add focused tests",
  }),
  "Fix parser Add focused tests",
  "ordered list markers are stripped per line before whitespace collapses",
);
assert.equal(
  chatSummaryTitle({
    userText: "> 1. Fix parser\n> 2) Add focused tests",
  }),
  "Fix parser Add focused tests",
  "list markers exposed by blockquote cleanup are stripped without losing text",
);

// Unicode subdivision flags are emoji tag sequences: a pictograph followed by
// tag characters U+E0020–U+E007E and cancel tag U+E007F.
{
  const englandFlag = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
  assert.equal(
    chatSummaryTitle({ userText: `${englandFlag} Fix parser ${englandFlag}` }),
    "Fix parser",
    "Unicode emoji tag sequences are removed at title edges",
  );
}

// Word-limit truncation is visible, word-safe, and remains within both caps.
assert.equal(
  chatSummaryTitle({ userText: "one two three four five six seven eight" }),
  "One two three four five six seven…",
  "word-limit truncation appends an ellipsis to the final retained word",
);
assert.equal(
  chatSummaryTitle({ userText: "Fix parser…" }),
  "Fix parser",
  "a source ellipsis is removed when the formatter does not truncate",
);
assert.equal(
  chatSummaryTitle({ userText: "Fix parser. …" }),
  "Fix parser",
  "spaced source sentence punctuation and ellipsis do not survive normalization",
);
assert.equal(
  chatSummaryTitle({ userText: "one two three four five six seven. eight" }),
  "One two three four five six seven…",
  "word-limit truncation replaces retained sentence punctuation with exactly one ellipsis",
);
assert.equal(
  chatSummaryTitle({ userText: "Alpha bravo charlie delta echo. foxtrotlong" }),
  "Alpha bravo charlie delta echo…",
  "character-limit truncation replaces retained sentence punctuation with exactly one ellipsis",
);
{
  const title = chatSummaryTitle({
    userText: "alpha bravo charlie delta echo foxtrot golf hotel",
  });
  assert.equal(title, "Alpha bravo charlie delta echo foxtrot…");
  assert.ok(title.length <= MAX_SUMMARY_TITLE_LENGTH, "word-truncated title remains within the character cap");
  assert.ok(
    title.replace(/…$/, "").split(/\s+/).length <= MAX_SUMMARY_TITLE_WORDS,
    "attached ellipsis does not add a word",
  );
}

console.log("cave-chat-titles.test.ts ok");
