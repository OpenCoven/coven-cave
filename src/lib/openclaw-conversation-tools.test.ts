// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./openclaw-conversation.ts", import.meta.url), "utf8");
const caveConversations = await readFile(new URL("./cave-conversations.ts", import.meta.url), "utf8");
const chatView = await readFile(new URL("../components/chat-view.tsx", import.meta.url), "utf8");

assert.match(
  caveConversations,
  /tools\?: Array<\{[\s\S]*name: string[\s\S]*status: "running" \| "ok" \| "error"/,
  "Saved conversation turns should support structured tool-use metadata",
);

assert.match(
  caveConversations,
  /reasoning\?: string/,
  "Saved conversation turns should support extracted reasoning metadata",
);

assert.match(
  source,
  /function extractToolEvent[\s\S]*role: "tool"[\s\S]*status: msg\.status === "error" \? "error" : "ok"/,
  "OpenClaw JSONL fallback should convert tool-role messages into tool events",
);

assert.match(
  source,
  /lastAssistant[\s\S]*lastAssistant\.tools = \[\.\.\.\(lastAssistant\.tools \?\? \[\]\), tool\]/,
  "OpenClaw JSONL fallback should attach tool events to the preceding assistant turn",
);

assert.match(
  chatView,
  /tools: t\.tools/,
  "ChatView should preserve saved tool metadata when loading history",
);

assert.match(
  chatView,
  /reasoning: t\.reasoning/,
  "ChatView should preserve saved reasoning metadata when loading history",
);
