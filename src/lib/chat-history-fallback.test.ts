import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_FALLBACK_HISTORY_TURNS,
  buildPriorConversationBlock,
  prependPriorConversation,
} from "./chat-history-fallback.ts";
import type { ChatTurn, ConversationFile } from "./cave-conversations.ts";

function turn(partial: Partial<ChatTurn> & Pick<ChatTurn, "id" | "role" | "text">): ChatTurn {
  return {
    parentId: null,
    createdAt: "2026-06-28T00:00:00.000Z",
    ...partial,
  };
}

function conv(turns: ChatTurn[], activeLeafId?: string): Pick<ConversationFile, "turns" | "activeLeafId"> {
  return { turns, activeLeafId };
}

test("empty / null conversations yield no block", () => {
  assert.equal(buildPriorConversationBlock(null), "");
  assert.equal(buildPriorConversationBlock(undefined), "");
  assert.equal(buildPriorConversationBlock(conv([])), "");
});

test("renders a labelled transcript along the active path", () => {
  const a = turn({ id: "a", role: "user", text: "remember the api key is XYZ", createdAt: "2026-06-28T00:00:00.000Z" });
  const b = turn({ id: "b", parentId: "a", role: "assistant", text: "Got it, noted.", createdAt: "2026-06-28T00:00:01.000Z" });
  const block = buildPriorConversationBlock(conv([a, b], "b"));
  assert.match(block, /^## Prior conversation/);
  assert.match(block, /\*\*User:\*\* remember the api key is XYZ/);
  assert.match(block, /\*\*Assistant:\*\* Got it, noted\./);
});

test("drops system, empty, and errored turns", () => {
  const turns = [
    turn({ id: "s", role: "system", text: "system preamble" }),
    turn({ id: "u", parentId: "s", role: "user", text: "hello" }),
    turn({ id: "blank", parentId: "u", role: "assistant", text: "   " }),
    turn({ id: "err", parentId: "blank", role: "assistant", text: "boom", isError: true }),
    turn({ id: "ok", parentId: "err", role: "assistant", text: "real answer" }),
  ];
  const block = buildPriorConversationBlock(conv(turns, "ok"));
  assert.doesNotMatch(block, /system preamble/);
  assert.doesNotMatch(block, /boom/);
  assert.match(block, /\*\*User:\*\* hello/);
  assert.match(block, /\*\*Assistant:\*\* real answer/);
});

test("windows to the most recent N turns", () => {
  const turns: ChatTurn[] = [];
  let parent: string | null = null;
  for (let i = 0; i < 40; i++) {
    const id = `t${i}`;
    turns.push(
      turn({
        id,
        parentId: parent,
        role: i % 2 === 0 ? "user" : "assistant",
        text: `msg ${i}`,
        createdAt: `2026-06-28T00:00:${String(i).padStart(2, "0")}.000Z`,
      }),
    );
    parent = id;
  }
  const block = buildPriorConversationBlock(conv(turns, "t39"));
  const lines = block.split("\n").filter((l) => l.startsWith("**"));
  assert.equal(lines.length, MAX_FALLBACK_HISTORY_TURNS);
  // Keeps the tail, not the head.
  assert.match(block, /msg 39/);
  assert.doesNotMatch(block, /msg 0\b/);
});

test("follows the selected branch, not abandoned siblings", () => {
  const root = turn({ id: "root", role: "user", text: "start", createdAt: "2026-06-28T00:00:00.000Z" });
  const branchA = turn({ id: "a", parentId: "root", role: "assistant", text: "answer A", createdAt: "2026-06-28T00:00:01.000Z" });
  const branchB = turn({ id: "b", parentId: "root", role: "assistant", text: "answer B", createdAt: "2026-06-28T00:00:02.000Z" });
  const block = buildPriorConversationBlock(conv([root, branchA, branchB], "a"));
  assert.match(block, /answer A/);
  assert.doesNotMatch(block, /answer B/);
});

test("prependPriorConversation is a no-op for an empty block", () => {
  assert.equal(prependPriorConversation("PROMPT", ""), "PROMPT");
});

test("prependPriorConversation joins block, rule, and prompt", () => {
  const out = prependPriorConversation("PROMPT", "## Prior conversation\n\n**User:** hi");
  assert.equal(out, "## Prior conversation\n\n**User:** hi\n\n---\n\nPROMPT");
});
