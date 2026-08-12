import assert from "node:assert/strict";
import test from "node:test";
import { buildReplySnippet } from "./chat-reply.ts";
import {
  chatTurnVisibleText,
  extractChatRenderedText,
} from "./chat-rendered-text.ts";
import { findTranscriptHits } from "./transcript-find.ts";

const CONTROL_HEAVY_ASSISTANT_TEXT = [
  "```coven:attachment",
  '{ "path": "/workspace/report.txt" }',
  "```",
  "<thinking>private chain of thought</thinking>",
  "The ordinary visible answer remains.",
  '<coven:skill name="research" stage="done" />',
  '<coven:auto-status state="done" />',
  '<coven:attention reason="decision" />',
  "<coven:next-paths>",
  "- [reply] Hidden follow-up",
  "</coven:next-paths>",
  '<coven:github kind="issue" repo="OpenCoven/coven-cave" number="42" />',
  '<coven:image src="/api/chat/attachment?id=preview.png" />',
].join("\n");

test("rendered assistant text keeps prose while removing every non-prose control", () => {
  const result = extractChatRenderedText(CONTROL_HEAVY_ASSISTANT_TEXT);

  assert.equal(result.visible.trim(), "The ordinary visible answer remains.");
  assert.equal(result.inlineReasoning, "private chain of thought");
  assert.deepEqual(result.skillUpdates, [{ name: "research", stage: "done" }]);
  assert.deepEqual(result.autoStatusUpdate, { state: "done" });
  assert.deepEqual(result.attentionRequest, { reason: "decision" });
  assert.deepEqual(result.nextPaths, [
    {
      kind: "reply",
      label: "Hidden follow-up",
      prompt: "Hidden follow-up",
      recommended: false,
    },
  ]);
  assert.match(result.cardText, /<coven:github/);
  assert.match(result.cardText, /<coven:image/);
});

test("find and reply projections cannot expose assistant control markers", () => {
  const turn = {
    id: "assistant-1",
    role: "assistant" as const,
    text: CONTROL_HEAVY_ASSISTANT_TEXT,
    pending: false,
  };
  const visible = chatTurnVisibleText(turn);

  assert.equal(findTranscriptHits([{ ...turn, text: visible }], "attention").length, 0);
  assert.equal(findTranscriptHits([{ ...turn, text: visible }], "ordinary").length, 1);
  assert.equal(buildReplySnippet(visible), "The ordinary visible answer remains.");
});

test("attention fragments use pending extraction only while a turn is streaming", () => {
  const possibleMarker = 'Visible before <coven:attention reason="decision>AFTER';

  assert.equal(
    chatTurnVisibleText({ role: "assistant", text: possibleMarker, pending: true }),
    "Visible before ",
  );
  assert.equal(
    chatTurnVisibleText({ role: "assistant", text: possibleMarker, pending: false }),
    "Visible before AFTER",
  );
  assert.equal(
    chatTurnVisibleText({
      role: "assistant",
      text: '<coven:attention" reason="decision">AFTER',
      pending: false,
    }),
    "AFTER",
  );
});

test("user and system text remains unchanged", () => {
  const text = '<coven:attention reason="decision" /> ordinary text';
  assert.equal(chatTurnVisibleText({ role: "user", text }), text);
  assert.equal(chatTurnVisibleText({ role: "system", text }), text);
});

test("fenced reasoning tags stay literal in rendered text", () => {
  const text = [
    "```xml",
    "<thinking>literal example</thinking>",
    "```",
    "<thinking>private plan</thinking>",
    "Visible answer.",
  ].join("\n");

  const result = extractChatRenderedText(text);
  assert.equal(
    result.visible,
    "```xml\n<thinking>literal example</thinking>\n```\n\nVisible answer.",
  );
  assert.equal(result.inlineReasoning, "private plan");
});

test("renderer-code fence quirks keep attention examples literal in rendered text", () => {
  const listText = [
    "- ```xml",
    "  example",
    "  ```",
    '<coven:attention reason="decision" />',
  ].join("\n");
  const listed = extractChatRenderedText(listText);
  assert.equal(listed.visible, "- ```xml\n  example\n  ```\n");
  assert.equal(listed.cardText, "- ```xml\n  example\n  ```\n");
  assert.deepEqual(listed.attentionRequest, { reason: "decision" });

  const quotedText = [
    "> ```x",
    "> ````",
    '> <coven:attention reason="approval" />',
    "> ```",
  ].join("\n");
  const quoted = extractChatRenderedText(quotedText);
  assert.equal(quoted.visible, quotedText);
  assert.equal(quoted.cardText, quotedText);
  assert.equal(quoted.attentionRequest, null);
});
