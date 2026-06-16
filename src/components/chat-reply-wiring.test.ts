// @ts-nocheck
// Reply to Chat — UI wiring guards. The reply action must be reachable from
// both roles' settled action rows, staged through a dismissible composer chip,
// and folded into the outgoing prompt (not dropped) at send time.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bubble = readFileSync(new URL("./message-bubble.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");

// ── MessageBubble exposes an onReply action in BOTH role action rows ───────
assert.match(bubble, /onReply\?:\s*\(\)\s*=>\s*void/, "MessageBubbleProps declares an optional onReply");
assert.match(
  bubble,
  /onReply,\s*onOpenUrl/,
  "onReply is destructured in the MessageBubble signature",
);
{
  const replyButtons = bubble.match(/aria-label="Reply to message"/g) ?? [];
  assert.equal(replyButtons.length, 2, "Reply action renders in both the user and assistant action rows");
}
// The reply buttons live INSIDE the !pending action rows so they never show
// on a streaming turn.
assert.match(bubble, /onClick=\{onReply\}/, "the Reply button invokes onReply");

// ── chat-view stages, shows, and sends the reply ──────────────────────────
assert.match(view, /from "@\/lib\/chat-reply"/, "chat-view imports the quote-reply helpers");
assert.match(view, /const \[replyTarget, setReplyTarget\] = useState<ReplyTarget \| null>/, "reply target state exists");
assert.match(view, /function replyToTurn\(turn: Turn\)/, "a handler stages a turn as the reply target");
assert.match(view, /function replyFor\(turn: Turn\)/, "a gate builds the per-turn Reply action");
// Pending turns can't be replied to; empty turns produce no action.
assert.match(view, /if \(turn\.pending\) return undefined;/, "replyFor hides on pending turns");

// The outgoing prompt is built through buildQuotedPrompt (model sees the quote
// and it persists) — NOT silently discarded.
assert.match(
  view,
  /const outgoingText = buildQuotedPrompt\(replyTarget, text\);/,
  "send() folds the reply target into the outgoing prompt",
);
assert.match(view, /setReplyTarget\(null\);/, "the reply target clears after sending");
assert.match(view, /await sendRaw\(outgoingText,/, "the quoted prompt is what gets sent");

// ── composer chip is present, labelled, and dismissible ───────────────────
assert.match(view, /cave-composer-reply/, "a reply chip renders above the composer input");
assert.match(view, /Replying to \{replyTarget\.author\}/, "the chip names the quoted author");
assert.match(view, /aria-label="Cancel reply"/, "the chip has a dismiss control");

// ── both TurnRow call sites pass the Reply action ─────────────────────────
{
  const wired = view.match(/onReply=\{replyFor\(t\)\}/g) ?? [];
  assert.equal(wired.length, 2, "onReply is wired at both TurnRow render sites (linear + voice group)");
}

console.log("chat-reply-wiring.test.ts passed");
