// @ts-nocheck
// Quote-reply prompt builder (Reply to Chat). The reply must ride inside the
// outgoing prompt as a markdown blockquote so the model sees it and it
// survives reload (the transcript is persisted server-side from the prompt).
import assert from "node:assert/strict";
import { buildReplySnippet, buildQuotedPrompt, REPLY_SNIPPET_MAX } from "./chat-reply.ts";

// ── snippet: collapse whitespace, trim, truncate ──────────────────────────
assert.equal(buildReplySnippet("hello   world"), "hello world", "runs of spaces collapse");
assert.equal(buildReplySnippet("  trim me  "), "trim me", "outer whitespace trimmed");
assert.equal(buildReplySnippet("a\n\nb\nc"), "a b c", "newlines collapse to single spaces");

{
  const long = "x".repeat(REPLY_SNIPPET_MAX + 50);
  const s = buildReplySnippet(long);
  assert.ok(s.endsWith("…"), "over-long snippet is ellipsized");
  assert.ok(s.length <= REPLY_SNIPPET_MAX + 1, "snippet is capped at REPLY_SNIPPET_MAX (+ellipsis)");
}

// ── no target → pass-through (normal send is unaffected) ───────────────────
assert.equal(buildQuotedPrompt(null, "just a message"), "just a message", "null target returns body verbatim");

// ── target → blockquote header + quoted excerpt + blank line + body ────────
{
  const out = buildQuotedPrompt(
    { turnId: "t1", author: "Echo", snippet: "the deploy is done" },
    "thanks!",
  );
  assert.match(out, /^> Replying to \*\*Echo\*\*:/, "leads with an attributed blockquote header");
  assert.match(out, /^> the deploy is done$/m, "quotes the snippet as a blockquote line");
  assert.ok(out.includes("\n\nthanks!"), "a blank line separates the quote from the reply body");
  assert.ok(out.endsWith("thanks!"), "the user's reply body is preserved at the end");
}

// ── long quoted turn is condensed before quoting ──────────────────────────
{
  const out = buildQuotedPrompt(
    { turnId: "t2", author: "You", snippet: "y".repeat(REPLY_SNIPPET_MAX + 80) },
    "ok",
  );
  assert.ok(out.includes("…"), "long quoted text is truncated inside the blockquote");
}

console.log("chat-reply.test.ts passed");
