import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_FALLBACK_HISTORY_TURNS,
  MAX_FALLBACK_CHARS_PER_TURN,
  buildPriorConversationBlock,
  buildResumeRetryPrompt,
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

// ── adversarial / robustness edge cases ──────────────────────────────────────

test("missing activeLeafId falls back to chronological order", () => {
  // Out-of-order array, no activeLeafId: resolveActivePath linearizes by createdAt.
  const turns = [
    turn({ id: "b", role: "assistant", text: "second", createdAt: "2026-06-28T00:00:02.000Z" }),
    turn({ id: "a", role: "user", text: "first", createdAt: "2026-06-28T00:00:01.000Z" }),
  ];
  const block = buildPriorConversationBlock(conv(turns));
  assert.ok(
    block.indexOf("first") < block.indexOf("second"),
    "turns should be replayed oldest-first regardless of array order",
  );
});

test("a dangling activeLeafId (no such turn) falls back instead of throwing", () => {
  const turns = [
    turn({ id: "a", role: "user", text: "hello", createdAt: "2026-06-28T00:00:01.000Z" }),
    turn({ id: "b", parentId: "a", role: "assistant", text: "hi there", createdAt: "2026-06-28T00:00:02.000Z" }),
  ];
  const block = buildPriorConversationBlock(conv(turns, "does-not-exist"));
  assert.match(block, /hello/);
  assert.match(block, /hi there/);
});

test("a parentId cycle does not hang and still yields a bounded block", () => {
  // Corrupt ring: a -> b -> a. resolveActivePath guards against revisiting.
  const a = turn({ id: "a", parentId: "b", role: "user", text: "ring one" });
  const b = turn({ id: "b", parentId: "a", role: "assistant", text: "ring two" });
  const block = buildPriorConversationBlock(conv([a, b], "a"));
  // Whatever the traversal yields, it must terminate and stay a valid block.
  assert.match(block, /^## Prior conversation/);
  const lines = block.split("\n").filter((l) => l.startsWith("**"));
  assert.ok(lines.length >= 1 && lines.length <= 2);
});

test("oversized turn text is clamped with a truncation marker", () => {
  const huge = "x".repeat(MAX_FALLBACK_CHARS_PER_TURN + 5000);
  const block = buildPriorConversationBlock(
    conv([turn({ id: "a", role: "user", text: huge })], "a"),
  );
  assert.match(block, /… \(truncated\)/);
  // The single line must be bounded near the cap, not the full 9000 chars.
  const line = block.split("\n").find((l) => l.startsWith("**User:**"))!;
  assert.ok(line.length < MAX_FALLBACK_CHARS_PER_TURN + 100);
});

test("maxCharsPerTurn override clamps shorter and is honoured", () => {
  const block = buildPriorConversationBlock(
    conv([turn({ id: "a", role: "user", text: "abcdefghij" })], "a"),
    { maxCharsPerTurn: 4 },
  );
  assert.match(block, /\*\*User:\*\* abcd… \(truncated\)/);
});

test("maxTurns override narrows the window", () => {
  const turns: ChatTurn[] = [];
  let parent: string | null = null;
  for (let i = 0; i < 6; i++) {
    const id = `t${i}`;
    turns.push(
      turn({
        id,
        parentId: parent,
        role: i % 2 === 0 ? "user" : "assistant",
        text: `msg ${i}`,
        createdAt: `2026-06-28T00:00:0${i}.000Z`,
      }),
    );
    parent = id;
  }
  const block = buildPriorConversationBlock(conv(turns, "t5"), { maxTurns: 2 });
  const lines = block.split("\n").filter((l) => l.startsWith("**"));
  assert.equal(lines.length, 2);
  assert.match(block, /msg 5/);
  assert.match(block, /msg 4/);
  assert.doesNotMatch(block, /msg 3/);
});

test("MAX_FALLBACK_CHARS_PER_TURN keeps a full window bounded", () => {
  // Worst case: a full window of maxed-out turns stays within a predictable cap.
  const cap = MAX_FALLBACK_HISTORY_TURNS * (MAX_FALLBACK_CHARS_PER_TURN + 64);
  const turns: ChatTurn[] = [];
  let parent: string | null = null;
  for (let i = 0; i < MAX_FALLBACK_HISTORY_TURNS + 4; i++) {
    const id = `t${i}`;
    turns.push(
      turn({
        id,
        parentId: parent,
        role: i % 2 === 0 ? "user" : "assistant",
        text: "y".repeat(MAX_FALLBACK_CHARS_PER_TURN * 3),
        createdAt: `2026-06-28T00:${String(i).padStart(2, "0")}:00.000Z`,
      }),
    );
    parent = id;
  }
  const block = buildPriorConversationBlock(conv(turns, `t${MAX_FALLBACK_HISTORY_TURNS + 3}`));
  assert.ok(block.length < cap, `block (${block.length}) should stay under ${cap}`);
});

// ── buildResumeRetryPrompt: the exact transformation the route applies ────────

test("buildResumeRetryPrompt replays history ahead of the live prompt", () => {
  const turns = [
    turn({ id: "a", role: "user", text: "the deploy token is ABC", createdAt: "2026-06-28T00:00:01.000Z" }),
    turn({ id: "b", parentId: "a", role: "assistant", text: "noted", createdAt: "2026-06-28T00:00:02.000Z" }),
  ];
  const { prompt, replayedHistory } = buildResumeRetryPrompt("LIVE INSTRUCTION", conv(turns, "b"));
  assert.equal(replayedHistory, true);
  assert.match(prompt, /## Prior conversation/);
  assert.match(prompt, /the deploy token is ABC/);
  assert.ok(
    prompt.indexOf("the deploy token is ABC") < prompt.indexOf("LIVE INSTRUCTION"),
    "replayed history must precede the live instruction",
  );
  assert.ok(prompt.endsWith("LIVE INSTRUCTION"));
});

test("buildResumeRetryPrompt is a transparent passthrough when there is no history", () => {
  const { prompt, replayedHistory } = buildResumeRetryPrompt("LIVE INSTRUCTION", null);
  assert.equal(replayedHistory, false);
  assert.equal(prompt, "LIVE INSTRUCTION");
});

test("buildResumeRetryPrompt reports no replay when only unusable turns exist", () => {
  const turns = [
    turn({ id: "s", role: "system", text: "preamble" }),
    turn({ id: "e", parentId: "s", role: "assistant", text: "boom", isError: true }),
  ];
  const { prompt, replayedHistory } = buildResumeRetryPrompt("LIVE", conv(turns, "e"));
  assert.equal(replayedHistory, false);
  assert.equal(prompt, "LIVE");
});
