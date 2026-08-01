// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./openclaw-conversation.ts", import.meta.url), "utf8");
const caveConversations = await readFile(new URL("./cave-conversations.ts", import.meta.url), "utf8");
const chatTurnState = await readFile(new URL("./chat-turn-state.ts", import.meta.url), "utf8");

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
  /function openClawToolStatus[\s\S]*return !normalized[\s\S]*: "error";[\s\S]*function extractToolEvent[\s\S]*status: openClawToolStatus\(msg\.status\)/,
  "OpenClaw JSONL fallback should preserve non-success tool terminal states as errors",
);

assert.match(
  source,
  /lastAssistant[\s\S]*lastAssistant\.tools = \[\.\.\.\(lastAssistant\.tools \?\? \[\]\), tool\]/,
  "OpenClaw JSONL fallback should attach tool events to the preceding assistant turn",
);

assert.match(
  chatTurnState,
  /tools: turn\.tools/,
  "Chat turn state should preserve saved tool metadata when loading history",
);

assert.match(
  chatTurnState,
  /reasoning: turn\.reasoning/,
  "Chat turn state should preserve saved reasoning metadata when loading history",
);
