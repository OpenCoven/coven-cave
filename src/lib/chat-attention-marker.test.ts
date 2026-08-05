// Behavioral tests for the chat attention marker protocol
// (`<coven:attention …>`; chat sidebar attention task 1).
import assert from "node:assert/strict";
import test from "node:test";
import { extractChatAttentionMarker } from "./chat-attention-marker.ts";

test("extracts one explicit attention request and removes its marker", () => {
  assert.deepEqual(
    extractChatAttentionMarker(
      'Choose a release channel.\n<coven:attention reason="decision" />',
    ),
    {
      visible: "Choose a release channel.\n",
      request: { reason: "decision" },
    },
  );
});

test("last valid marker wins across multiple requests", () => {
  assert.deepEqual(
    extractChatAttentionMarker(
      '<coven:attention reason="input" /><coven:attention reason="approval" />',
    ).request,
    { reason: "approval" },
  );
});

test("invalid reasons are stripped without fabricating a request", () => {
  assert.deepEqual(
    extractChatAttentionMarker('Need something <coven:attention reason="urgent" />'),
    {
      visible: "Need something ",
      request: null,
    },
  );
});

test("fenced markers stay literal example text", () => {
  const text = '```\n<coven:attention reason="credentials" />\n```';
  assert.deepEqual(extractChatAttentionMarker(text), {
    visible: text,
    request: null,
  });
});

test("partial streaming tails stay hidden outside code ranges", () => {
  assert.deepEqual(extractChatAttentionMarker("Waiting <coven:attention rea"), {
    visible: "Waiting ",
    request: null,
  });
});

test("partial tails inside code ranges stay literal", () => {
  const text = "```\nWaiting <coven:attention rea\n```";
  assert.deepEqual(extractChatAttentionMarker(text), {
    visible: text,
    request: null,
  });
});
