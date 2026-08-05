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
  stripLeadingTrailingEmoji,
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

// ── Task 2 sanitizer issue 2: interrobang and Arabic question mark ────────────
// ‽ (U+203D) and ؟ (U+061F) are sentence-ending characters not previously
// included in the trailing punctuation strip; they must be removed before
// a truncation ellipsis is appended (same contract as .!?。！？).
assert.equal(
  chatSummaryTitle({ userText: "Fix parser\u203D" }),
  "Fix parser",
  "interrobang \u203D (U+203D) stripped from bare title end",
);
assert.equal(
  chatSummaryTitle({ userText: "Fix parser\u061F" }),
  "Fix parser",
  "Arabic question mark \u061F (U+061F) stripped from bare title end",
);
// Mixed with closing delimiter — same lookahead contract as existing types.
assert.equal(
  chatSummaryTitle({ userText: '"Fix parser\u203D"' }),
  '"Fix parser"',
  "interrobang before closing double-quote stripped; quote preserved",
);
// Before truncation: a source interrobang must not appear in the output
// alongside the formatter-appended … when the title is long enough to truncate.
{
  const interrobangTrunc = chatSummaryTitle({
    userText: "one two three four five six seven eight\u203D",
  });
  assert.ok(interrobangTrunc !== null, "interrobang truncation: must yield a title");
  assert.ok(
    !interrobangTrunc!.includes("\u203D"),
    `interrobang removed before truncation ellipsis appended, got "${interrobangTrunc}"`,
  );
  assert.ok(interrobangTrunc!.endsWith("…"), "truncation ellipsis appended after interrobang stripped");
}

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
// ── Task 2 sanitizer issue 1: reference definition must not leak URL ──────────
// The raw userText must pass through stripLineMarkdown BEFORE whitespace is
// collapsed so that a reference definition on its own line (`[label]: url`)
// is consumed by the line-oriented regex and never reaches formatGeneratedTitle.
assert.equal(
  chatSummaryTitle({ userText: "topic\n[retries]: https://example.com" }),
  "Topic",
  "reference definition on its own line stripped before whitespace collapse; URL does not leak",
);
assert.equal(
  chatSummaryTitle({ userText: "Fix network\n[retries]: https://example.com\nconfig" }),
  "Fix network config",
  "reference definition embedded between content lines is stripped; URL does not leak",
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

// ── Task 2 sanitizer issue 3: lone tag chars at title edges ───────────────────
// Tag chars (U+E0020–U+E007F) that appear without a preceding base pictographic
// are invisible and must be stripped at title edges. They appear e.g. when only
// part of a subdivision-flag sequence is present. Middle emoji are unaffected.
{
  // Lone CANCEL TAG (U+E007F) at start — invisible garbage.
  assert.equal(
    stripLeadingTrailingEmoji("\u{E007F}Fix parser"),
    "Fix parser",
    "lone cancel tag (U+E007F) at title start is stripped",
  );
  // Lone tag letter (U+E0067 = TAG LATIN SMALL LETTER G) at end.
  assert.equal(
    stripLeadingTrailingEmoji("Fix parser\u{E0067}"),
    "Fix parser",
    "lone tag char (U+E0067) at title end is stripped",
  );
  // Orphan tag sequence at start (multiple tag chars, no base pictographic).
  assert.equal(
    stripLeadingTrailingEmoji("\u{E0067}\u{E0062}\u{E007F}Fix parser"),
    "Fix parser",
    "orphan tag-char sequence at title start is stripped",
  );
  // Via chatSummaryTitle: the same cleanup runs through the formatter pipeline.
  assert.equal(
    chatSummaryTitle({ userText: "\u{E0067}Fix parser" }),
    "Fix parser",
    "lone tag char at start of userText is stripped via chatSummaryTitle",
  );
  // A full subdivision-flag emoji in the MIDDLE of a title is not touched.
  {
    const walesFlag = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0077}\u{E006C}\u{E0073}\u{E007F}";
    assert.equal(
      stripLeadingTrailingEmoji(`Fix ${walesFlag} parser`),
      `Fix ${walesFlag} parser`,
      "tag sequence inside a middle emoji is not consumed by edge cleanup",
    );
  }
}
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
  chatSummaryTitle({ userText: "Plan… then execute" }),
  "Plan then execute",
  "an intra-text Unicode ellipsis is removed when no truncation occurs",
);
assert.equal(
  chatSummaryTitle({ userText: "Plan... then execute" }),
  "Plan then execute",
  "an intra-text ASCII ellipsis is removed when no truncation occurs",
);
assert.equal(
  chatSummaryTitle({ userText: "\u201CFix parser 🎉\u201D" }),
  "\u201CFix parser\u201D",
  "edge emoji immediately before a closing quote is stripped",
);
assert.equal(
  chatSummaryTitle({ userText: "\u201CFix 🎉 parser\u201D" }),
  "\u201CFix 🎉 parser\u201D",
  "meaningful emoji inside quoted title text is preserved",
);
assert.equal(
  chatSummaryTitle({ userText: "(Fix parser 🎉)" }),
  "(Fix parser)",
  "edge emoji is removed without consuming a closing delimiter",
);
assert.equal(
  chatSummaryTitle({ userText: "<https://example.com>" }),
  null,
  "a Markdown URL autolink is stripped without leaking angle-bracket syntax",
);
assert.equal(
  chatSummaryTitle({ userText: "Read <https://example.com> docs" }),
  "Read docs",
  "an inline Markdown URL autolink is removed without disturbing surrounding text",
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

// ── Issue 1: Linear link/image scanner — malformed/adversarial inputs ────────
// Long inputs assert deterministic correctness rather than wall-clock timing.
{
  const longDestination = `https://example.test/${"a".repeat(5000)}`;
  assert.equal(
    chatSummaryTitle({ userText: `[Fix parser](${longDestination}) safely` }),
    "Fix parser safely",
    "a valid link is parsed before the generated-title source is clamped",
  );
}
{
  const malformedLink = "[Docs](https://x.test/" + "b".repeat(5000);
  assert.equal(
    chatSummaryTitle({ userText: malformedLink }),
    "Docs",
    "a long unclosed destination is discarded without leaking URL text",
  );
}
{
  const nestedDest = "[label](" + "(".repeat(80) + "a".repeat(200) + ")".repeat(80) + ")";
  assert.equal(
    chatSummaryTitle({ userText: nestedDest }),
    "Label",
    "deeply nested balanced destinations reduce to their label",
  );
}
assert.equal(
  chatSummaryTitle({
    userText: '[Docs](https://x.test/a_(b) "see ) details") safely',
  }),
  "Docs safely",
  "parentheses inside an optional quoted link title do not terminate the destination or leak title text",
);
{
  const malformedAtManualLimit = `[Docs](${"a".repeat(113)}`;
  assert.equal(malformedAtManualLimit.length, 120, "performance fixture stays at the manual-title limit");
  const startedAt = performance.now();
  for (let iteration = 0; iteration < 200; iteration++) {
    assert.equal(
      chatSummaryTitle({ userText: malformedAtManualLimit }),
      "Docs",
      "an unclosed destination is safely reduced to its label",
    );
  }
  assert.ok(
    performance.now() - startedAt < 3_000,
    "manual-length malformed links are processed repeatedly without catastrophic backtracking",
  );
}
assert.equal(
  chatSummaryTitle({ userText: "[outer [inner]](https://example.test)" }),
  "Outer inner",
  "nested brackets in a link label are flattened to plain text",
);
assert.equal(
  chatSummaryTitle({ userText: "[a [b [c]]](x)" }),
  "A b c",
  "deeply nested link labels are flattened without leaking bracket artifacts",
);
assert.equal(
  chatSummaryTitle({ userText: "[outer \\[inner\\]](https://example.test)" }),
  "Outer inner",
  "escaped brackets do not terminate the label scan or leak Markdown escapes",
);
assert.equal(
  chatSummaryTitle({ userText: "[\\*literal\\*](x)" }),
  "Literal",
  "CommonMark-escaped emphasis punctuation does not leak backslashes",
);
assert.equal(
  chatSummaryTitle({
    userText: "[\\#hash \\+plus \\@at \\{brace\\}](x)",
  }),
  "#hash +plus @at {brace}",
  "CommonMark-escapable punctuation is unescaped",
);
assert.equal(
  chatSummaryTitle({
    userText: "[escaped \\[brackets\\] \\\\backslash](x)",
  }),
  "Escaped brackets \\backslash",
  "escaped brackets and backslashes do not leak Markdown escapes",
);
assert.equal(
  chatSummaryTitle({ userText: "[\\#hash]" }),
  "#hash",
  "shortcut labels unescape CommonMark punctuation consistently",
);
assert.equal(
  chatSummaryTitle({ userText: "[\\+plus][reference]" }),
  "+plus",
  "full reference labels unescape CommonMark punctuation consistently",
);
assert.equal(
  chatSummaryTitle({ userText: "Fix \\#hash but keep \\alpha" }),
  "Fix #hash but keep \\alpha",
  "CommonMark punctuation escapes are removed without consuming non-punctuation escapes",
);
assert.equal(
  chatSummaryTitle({ userText: "Keep ordinary [bracket prose intact" }),
  "Keep ordinary bracket prose intact",
  "an unmatched prose bracket is sanitized without discarding its content",
);
assert.equal(
  chatSummaryTitle({ userText: "Keep ordinary [bracket] prose intact" }),
  "Keep ordinary bracket prose intact",
  "ordinary balanced bracket prose keeps all visible words",
);
assert.equal(
  chatSummaryTitle({ userText: "[outer [inner]](https://example.test/unclosed" }),
  "Outer inner",
  "an unclosed destination after a nested label keeps only the safe visible label",
);
assert.equal(
  chatSummaryTitle({ userText: "[a [b [c]]](unclosed" }),
  "A b c",
  "malformed destinations still emit a flattened safe label",
);
{
  const longNestedLink = `[outer [inner]](https://example.test/${"x".repeat(5_000)})`;
  assert.equal(
    chatSummaryTitle({ userText: longNestedLink }),
    "Outer inner",
    "long nested links are reduced without leaking destination text",
  );
}
{
  const depth = 5_000;
  const deeplyNestedLabel = `${"[".repeat(depth)}deep${"]".repeat(depth)}(x)`;
  const startedAt = performance.now();
  assert.equal(
    chatSummaryTitle({ userText: deeplyNestedLabel }),
    "Deep",
    "arbitrarily deep labels flatten without a depth-specific parser limit",
  );
  assert.ok(
    performance.now() - startedAt < 1_000,
    "deep balanced labels are processed linearly",
  );
}

assert.equal(
  chatSummaryTitle({ userText: '"🎉 Fix parser"' }),
  '"Fix parser"',
  "leading emoji inside straight quotes is stripped without removing the quotes",
);
assert.equal(
  chatSummaryTitle({ userText: "(👩‍💻 Fix parser)" }),
  "(Fix parser)",
  "leading ZWJ emoji inside parentheses is stripped without removing the delimiters",
);
assert.equal(
  chatSummaryTitle({ userText: '"Fix 🎉 parser"' }),
  '"Fix 🎉 parser"',
  "meaningful emoji inside delimited title text is preserved",
);

// ── Issue 2: Preserve programming symbols; strip Markdown contextually ────────
assert.equal(
  chatSummaryTitle({ userText: "C# programming" }),
  "C# programming",
  "C# symbol preserved — # is not stripped when adjacent to word char",
);
assert.equal(
  chatSummaryTitle({ userText: "Fix #123" }),
  "Fix #123",
  "issue reference #123 preserved — # not stripped before digit",
);
assert.equal(
  chatSummaryTitle({ userText: "Handle *.ts files" }),
  "Handle *.ts files",
  "glob *.ts preserved — unpaired * not stripped",
);
assert.equal(
  chatSummaryTitle({ userText: "**bold text**" }),
  "Bold text",
  "paired ** bold emphasis stripped from user text",
);
assert.equal(
  chatSummaryTitle({ userText: "*italic*" }),
  "Italic",
  "paired * italic emphasis stripped from user text",
);
assert.equal(
  chatSummaryTitle({ userText: "_underscored_" }),
  "Underscored",
  "paired _ emphasis stripped at word boundaries",
);
assert.equal(
  chatSummaryTitle({ userText: "snake_case naming" }),
  "Snake_case naming",
  "intra-word underscore preserved in snake_case",
);
// Heading from assistant reply — paired ** inside heading content stripped
assert.equal(
  titleFromAssistantReply("# **Fix C# parser** for #123"),
  "Fix C# parser for #123",
  "paired ** stripped from heading; C# and #123 preserved",
);

// ── Issue 3: Balance truncation delimiters ────────────────────────────────────
// Quoted long input: 10-word quoted prompt is truncated at 7 words; the
// leading " has no matching " in the retained stem → strip it.
{
  const quotedLong = '"Implement the new feature for the search component right now"';
  const r = chatSummaryTitle({ userText: quotedLong });
  assert.ok(r !== null, "quoted long: yields a title");
  assert.ok(r!.endsWith("…"), "quoted long: truncation ellipsis appended");
  assert.ok(!r!.startsWith('"'), 'quoted long: unmatched leading " removed after truncation');
  assert.ok(r!.length <= 40, "quoted long: ≤40 chars");
}
// Parenthesized long input: leading ( has no matching ) in retained stem.
{
  const parenLong = "(Handle the configuration right now to fix all the performance issues)";
  const r = chatSummaryTitle({ userText: parenLong });
  assert.ok(r !== null, "parens long: yields a title");
  assert.ok(r!.endsWith("…"), "parens long: truncation ellipsis appended");
  assert.ok(!r!.startsWith("("), "parens long: unmatched leading ( removed after truncation");
  assert.ok(r!.length <= 40, "parens long: ≤40 chars");
}
// Short balanced title: both delimiters present → keep both.
assert.equal(
  chatSummaryTitle({ userText: '"Short quote"' }),
  '"Short quote"',
  "balanced short: leading and closing quotes preserved",
);

// ── Issue: Direct ATX heading cleanup ────────────────────────────────────────
// #{1,6} at line start followed by whitespace is an ATX heading prefix in
// Markdown. Strip it so "# Fix parser" → "Fix parser". Non-heading hashes
// (C#, Fix #123) are mid-line and are preserved.
assert.equal(
  chatSummaryTitle({ userText: "# Fix parser" }),
  "Fix parser",
  "h1 ATX heading prefix stripped from user text",
);
assert.equal(
  chatSummaryTitle({ userText: "## Fix parser" }),
  "Fix parser",
  "h2 ATX heading prefix stripped from user text",
);
assert.equal(
  chatSummaryTitle({ userText: "###### Fix parser" }),
  "Fix parser",
  "h6 ATX heading prefix stripped from user text",
);

// ── Issue: ATX closing markers ────────────────────────────────────────────────
// "# Fix parser ###" and "## Fix parser ##" must become "Fix parser".
// Strip optional ATX closing sequence: whitespace + 1-6 hashes at end.
// Internal hashes (C#, #123) are not affected.
assert.equal(
  titleFromAssistantReply("# Fix parser ###"),
  "Fix parser",
  "ATX closing markers stripped from assistant heading (h1 opening, ### closing)",
);
assert.equal(
  titleFromAssistantReply("## Fix parser ##"),
  "Fix parser",
  "ATX closing markers stripped from assistant heading (h2 opening, ## closing)",
);
assert.equal(
  chatSummaryTitle({ userText: "# Fix parser ###" }),
  "Fix parser",
  "ATX closing markers stripped from direct user h1 heading",
);
assert.equal(
  chatSummaryTitle({ userText: "## Fix parser ##" }),
  "Fix parser",
  "ATX closing markers stripped from direct user h2 heading",
);
// Internal hashes must not be stripped — no leading whitespace before the hash.
assert.equal(
  chatSummaryTitle({ userText: "Programming in C#" }),
  "Programming in C#",
  "internal C# hash not stripped — no leading whitespace before it",
);
// Issue reference hash must not be stripped — digits follow the hash.
assert.equal(
  chatSummaryTitle({ userText: "Fix issue #123" }),
  "Fix issue #123",
  "issue ref #123 not stripped — non-hash characters follow it",
);

// ── Issue: Escaped parentheses in link destination parser ─────────────────────
// \) in a destination must not close the paren depth counter — it is part of
// the URL. \( must not open a new nesting level. Both must be skipped as
// opaque content so the scanner stays linear and never leaks URL fragments.
assert.equal(
  chatSummaryTitle({ userText: "[Docs](https://x.test/a\\)b) safely" }),
  "Docs safely",
  "escaped ) in destination not treated as closing paren — no URL fragment leak",
);
assert.equal(
  chatSummaryTitle({ userText: "[Docs](https://x.test/a\\(b)" }),
  "Docs",
  "escaped ( in destination not treated as nesting opener",
);
{
  // Long malformed input after an escaped ): consumed as unclosed destination.
  const malformedEscaped = "[Docs](https://x.test/a\\)" + "b".repeat(5000);
  assert.equal(
    chatSummaryTitle({ userText: malformedEscaped }),
    "Docs",
    "long malformed destination after escaped ) discarded without leaking content",
  );
}

// ── Issue: Nested unmatched leading delimiters after truncation ───────────────
// When truncation leaves (" or [" or any stack of openers without their
// corresponding closers in the retained stem, all must be stripped, not just
// the outermost one. The fix iterates until no unmatched leading opener remains.
{
  const nestedLong = '("Implement the new feature for the search component right now")';
  const r = chatSummaryTitle({ userText: nestedLong });
  assert.ok(r !== null, "nested delimiters long: yields a title");
  assert.ok(r!.endsWith("…"), "nested delimiters long: truncation ellipsis appended");
  assert.ok(!r!.startsWith("("), "nested delimiters long: unmatched ( stripped after truncation");
  assert.ok(!r!.startsWith('"'), 'nested delimiters long: unmatched " stripped after ( removal');
}
// Balanced short: no truncation → delimiter loop never runs → preserved.
assert.equal(
  chatSummaryTitle({ userText: '("short")' }),
  '("short")',
  "balanced short nested delimiters preserved when no truncation occurs",
);

// ── Issue: Angle-quote leading delimiter stripping after truncation ───────────
// «…» (U+00AB/U+00BB) and ‹…› (U+2039/U+203A) were missing from the closers
// map in stripUnmatchedLeadingDelimiter. After word-limit or char-limit
// truncation the closing angle quote falls outside the retained stem, leaving
// an unmatched leading opener that must be stripped.
{
  // Word-limit path: 10-word «-quoted input is truncated at 7 words;
  // the leading « has no matching » in the retained stem → strip it.
  const doubleAngleLong =
    "\u00ABImplement the new feature for the search component right now\u00BB";
  const r = chatSummaryTitle({ userText: doubleAngleLong });
  assert.ok(r !== null, "\u00AB angle-quote long: yields a title");
  assert.ok(r!.endsWith("\u2026"), "\u00AB angle-quote long: truncation ellipsis appended");
  assert.ok(
    !r!.startsWith("\u00AB"),
    "\u00AB angle-quote long: unmatched leading \u00AB removed after truncation",
  );
}
{
  // Char-limit path: 4-word ‹-quoted input (48 chars) is clamped at a word
  // boundary within 40 chars; the leading ‹ has no matching › in the retained
  // stem → strip it.
  const singleAngleLong =
    "\u2039Reconfigure the authentication synchronization\u203A";
  const r = chatSummaryTitle({ userText: singleAngleLong });
  assert.ok(r !== null, "\u2039 angle-quote long: yields a title");
  assert.ok(r!.endsWith("\u2026"), "\u2039 angle-quote long: truncation ellipsis appended");
  assert.ok(
    !r!.startsWith("\u2039"),
    "\u2039 angle-quote long: unmatched leading \u2039 removed after char-limit truncation",
  );
}
// Balanced short titles: both angle quotes present → kept intact (no truncation).
assert.equal(
  chatSummaryTitle({ userText: "\u00ABFix parser\u00BB" }),
  "\u00ABFix parser\u00BB",
  "balanced \u00AB\u00BB short: leading and closing angle quotes preserved",
);
assert.equal(
  chatSummaryTitle({ userText: "\u2039Fix parser\u203A" }),
  "\u2039Fix parser\u203A",
  "balanced \u2039\u203A short: leading and closing single angle quotes preserved",
);

// ── Issue: Common user-directed framing ──────────────────────────────────────
// "I need you to", "I want you to", "I'd like you to", "I would like you to"
// are added as `you to` extensions of existing patterns in LEADING_FILLER_RE.
// "I need help" (no "you to") is not matched and is preserved.
assert.equal(
  chatSummaryTitle({ userText: "I need you to fix parser errors" }),
  "Fix parser errors",
  "I need you to stripped from user text",
);
assert.equal(
  chatSummaryTitle({ userText: "I want you to fix parser errors" }),
  "Fix parser errors",
  "I want you to stripped from user text",
);
assert.equal(
  chatSummaryTitle({ userText: "I'd like you to fix parser errors" }),
  "Fix parser errors",
  "I'd like you to stripped from user text",
);
assert.equal(
  chatSummaryTitle({ userText: "I would like you to fix parser errors" }),
  "Fix parser errors",
  "I would like you to stripped from user text",
);
assert.equal(
  chatSummaryTitle({ userText: "I need help with parsers" }),
  "I need help with parsers",
  "I need help preserved — no you to or to form to match",
);

// ── P2: Markdown email autolink ───────────────────────────────────────────────
// <user@example.com> is a valid Markdown autolink whose content (the address
// itself) IS useful. Strip the angle brackets but preserve the address text,
// unlike URL autolinks whose destination is always discarded.
assert.equal(
  chatSummaryTitle({ userText: "<user@example.com>" }),
  "User@example.com",
  "bare Markdown email autolink: angle brackets stripped, address text preserved",
);
assert.equal(
  chatSummaryTitle({ userText: "Contact <user@example.com> now" }),
  "Contact user@example.com now",
  "inline Markdown email autolink: angle brackets stripped, address stays lowercase",
);
assert.equal(
  chatSummaryTitle({ userText: "<https://example.com>" }),
  null,
  "URL autolink is still fully stripped (no content preserved)",
);

// ── P2: Fullwidth full stop U+FF0E stripped at sentence end ──────────────────
// U+FF0E (FULLWIDTH FULL STOP ．) is a sentence-ending character that must be
// stripped from title ends, just like its ASCII counterpart and 。！？.
assert.equal(
  chatSummaryTitle({ userText: "Fix parser\uFF0E" }),
  "Fix parser",
  "fullwidth full stop U+FF0E stripped from bare title end",
);
assert.equal(
  chatSummaryTitle({ userText: '"Fix parser\uFF0E"' }),
  '"Fix parser"',
  "fullwidth full stop before closing quote stripped; quote preserved",
);
// U+FF0E must not survive truncation (same contract as . before ellipsis).
{
  const fullwidthTrunc = chatSummaryTitle({
    userText: "one two three four five six seven eight\uFF0E",
  });
  assert.ok(fullwidthTrunc !== null, "fullwidth-stop truncation: yields a title");
  assert.ok(
    !fullwidthTrunc!.includes("\uFF0E"),
    `fullwidth stop removed before truncation ellipsis, got "${fullwidthTrunc}"`,
  );
  assert.ok(fullwidthTrunc!.endsWith("…"), "truncation ellipsis appended after fullwidth stop stripped");
}

// ── P2: Edge emoji after opening quotes ──────────────────────────────────────
// Emoji immediately following an opening delimiter (quote, paren, bracket)
// must be stripped while the delimiter itself is preserved.
assert.equal(
  chatSummaryTitle({ userText: '"🎉 Fix parser"' }),
  '"Fix parser"',
  "leading emoji after straight double-quote stripped; quote preserved",
);
assert.equal(
  chatSummaryTitle({ userText: "(\uD83D\uDC69\u200D\uD83D\uDCBB Fix parser)" }),
  "(Fix parser)",
  "leading ZWJ emoji after opening paren stripped; paren preserved",
);
assert.equal(
  chatSummaryTitle({ userText: '"\uD83C\uDF89 Fix 🎉 parser"' }),
  '"\uD83C\uDF89 Fix 🎉 parser"'.replace(/^"\uD83C\uDF89 /, '"'),
  "leading emoji after quote stripped; meaningful mid-title emoji preserved",
);

// ── P2: VS15 keycap sequences stripped at edges ──────────────────────────────
// Keycap sequences with the text-presentation selector VS15 (U+FE0E) instead
// of VS16 (U+FE0F) must also be consumed at title edges. The EMOJI_SEQUENCE
// matcher handles [#*0-9][\uFE0F\uFE0E]?\u20E3 so both variation selectors
// (and no selector at all) are covered.
assert.equal(
  chatSummaryTitle({ userText: "1\uFE0E\u20E3 Fix parser" }),
  "Fix parser",
  "leading keycap with VS15 (text presentation selector) fully stripped",
);
assert.equal(
  chatSummaryTitle({ userText: "Fix parser #\uFE0E\u20E3" }),
  "Fix parser",
  "trailing keycap with VS15 fully stripped",
);
assert.equal(
  chatSummaryTitle({ userText: "*\uFE0E\u20E3 Fix parser" }),
  "Fix parser",
  "leading asterisk-keycap with VS15 stripped",
);
// VS16 keycap (existing contract) remains unaffected.
assert.equal(
  chatSummaryTitle({ userText: "1\uFE0F\u20E3 Fix parser" }),
  "Fix parser",
  "leading keycap with VS16 still stripped (no regression)",
);

console.log("cave-chat-titles.test.ts ok");
