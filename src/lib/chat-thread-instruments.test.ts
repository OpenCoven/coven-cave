// Contract tests for the transcript's navigation instruments (cave-j86la):
// the pure derivation both the run spine and the thread minimap consume, plus
// source pins for how chat-view mounts them.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import {
  formatTookLabel,
  instrumentSummary,
  instrumentTime,
  spineSegmentHeights,
  spineNodes,
  spineStackHeight,
  threadMapEvents,
  toolBarWidth,
  toolCategory,
  type InstrumentTurn,
} from "./chat-thread-instruments.ts";

const names = { operatorName: "Val", familiarName: "Kitty" };

const turn = (over: Partial<InstrumentTurn>): InstrumentTurn => ({
  id: "t1",
  role: "assistant",
  text: "Answer",
  createdAt: "2026-07-29T18:19:00.000Z",
  ...over,
});

test("toolCategory maps harness names onto the design palette, compounds first", () => {
  assert.equal(toolCategory("bash"), "shell");
  assert.equal(toolCategory("Read"), "read");
  assert.equal(toolCategory("str_replace_editor"), "edit");
  assert.equal(toolCategory("grep"), "search");
  // Compounds resolve to their dominant register — web_search is web.
  assert.equal(toolCategory("web_search"), "web");
  assert.equal(toolCategory("WebFetch"), "web");
  assert.equal(toolCategory("Task"), "agent");
  assert.equal(toolCategory("monitor"), "wait");
  // Unknown names are honest "other", never a guess.
  assert.equal(toolCategory("frobnicate"), "other");
  assert.equal(toolCategory(""), "other");
});

test("spineNodes aggregates one node per speaking turn with a category rollup", () => {
  const nodes = spineNodes(
    [
      turn({ id: "u1", role: "user", text: "Please fix the release" }),
      turn({
        id: "a1",
        tools: [
          { id: "1", name: "bash", status: "ok" },
          { id: "2", name: "bash", status: "ok" },
          { id: "3", name: "read", status: "ok" },
        ],
      }),
      // System turns never earn a node — the spine narrates the conversation.
      turn({ id: "s1", role: "system", text: "noise" }),
    ],
    names,
  );
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].name, "Val");
  assert.equal(nodes[0].total, 0);
  assert.equal(nodes[1].name, "Kitty");
  // Category order is the palette's, and counts aggregate per category.
  assert.deepEqual(nodes[1].cats, [
    { cat: "read", count: 1 },
    { cat: "shell", count: 2 },
  ]);
  assert.equal(nodes[1].total, 3);
});

test("spine stack height follows the design's curve and stays bounded", () => {
  assert.equal(spineStackHeight(0), 0);
  assert.equal(spineStackHeight(1), 28); // floor
  assert.equal(spineStackHeight(20), 48); // 20 × 2.4
  assert.equal(spineStackHeight(500), 96); // cap — a 100-step turn can't own the gutter
});

test("spine segment heights stay within one stack even with a dominant category", () => {
  const heights = spineSegmentHeights([
    { count: 99 },
    { count: 1 },
  ]);
  assert.equal(heights.length, 2);
  assert.ok(heights.every((height) => height >= Math.min(8, 100 / heights.length)));
  assert.ok(heights.reduce((sum, height) => sum + height, 0) <= 100.0001);
});

test("threadMapEvents orders prompt → tools → answer and attributes owners", () => {
  const events = threadMapEvents(
    [
      turn({ id: "u1", role: "user", text: "Go" }),
      turn({
        id: "a1",
        durationMs: 51_000,
        tools: [
          { id: "1", name: "bash", input: "gh run list --limit 5", status: "ok", durationMs: 900 },
          { id: "2", name: "edit", input: "release.yml", status: "error" },
        ],
      }),
    ],
    names,
  );
  assert.deepEqual(
    events.map((e) => e.kind),
    ["turn", "shell", "edit", "answer"],
  );
  // Turn and answer bars span the row; tool bars are duration/name-keyed.
  assert.equal(events[0].width, 100);
  assert.equal(events[3].width, 100);
  assert.ok(events[1].width >= 24 && events[1].width <= 96);
  // Owner attribution: every event on an assistant turn belongs to the familiar.
  assert.equal(events[1].ownerName, "Kitty");
  assert.equal(events[2].error, true, "a failed tool keeps its error flag");
  assert.equal(events[3].took, "51s");
  assert.equal(events[0].turnLabel, "VAL");
  // Ids are stable so React keys and selection survive re-renders.
  assert.equal(events[1].id, "a1:tool:1");
});

test("bar widths are deterministic and clamped", () => {
  assert.equal(toolBarWidth("bash", 900), toolBarWidth("bash", 900));
  assert.ok(toolBarWidth("bash", 50) >= 24);
  assert.ok(toolBarWidth("bash", 90 * 60_000) <= 96);
  // No duration → stable name-keyed spread, not randomness.
  assert.equal(toolBarWidth("read"), toolBarWidth("read"));
  assert.notEqual(toolBarWidth("read"), toolBarWidth("web_fetch"));
});

test("formatting helpers stay honest on absent data", () => {
  assert.equal(instrumentTime(undefined), null);
  assert.equal(instrumentTime("not a date"), null);
  assert.equal(formatTookLabel(undefined), null);
  assert.equal(formatTookLabel(400), "400ms");
  assert.equal(formatTookLabel(83_000), "1m 23s");
  assert.equal(instrumentSummary("one line\nrest"), "one line");
  assert.equal(instrumentSummary("x".repeat(200)).length, 96);
});

// ── Wiring pins ──────────────────────────────────────────────────────────────

const chatView = readFileSync(new URL("../components/chat-view.tsx", import.meta.url), "utf8");
const instruments = readFileSync(
  new URL("../components/chat-thread-instruments.tsx", import.meta.url),
  "utf8",
);
const instrumentStyles = readFileSync(
  new URL("../styles/cave-chat/thread-instruments.css", import.meta.url),
  "utf8",
);

test("instrument controls use the shared focus ring and no dead running class", () => {
  assert.match(instruments, /className=\{`cave-thread-spine__node focus-ring/);
  assert.match(instruments, /className=\{`cave-thread-map__row focus-ring/);
  assert.doesNotMatch(instruments, /is-running/);
});

test("instrument tint mappings use theme-aware semantic tokens", () => {
  assert.doesNotMatch(instrumentStyles, /--tim-[^:]+:\s*oklch\(/);
  assert.match(instrumentStyles, /\.cave-thread-map \.is-read \{ --tim: var\(--color-info\); \}/);
});

test("chat-view mounts both instruments over the SAME activePath the transcript renders", () => {
  assert.match(
    chatView,
    /<ChatThreadMinimap\s*\n\s*turns=\{activePath\}/,
    "the minimap reads the branch-aware visible path, not raw turns",
  );
  assert.match(
    chatView,
    /<ChatThreadSpine\s*\n\s*turns=\{activePath\}/,
    "the spine reads the branch-aware visible path, not raw turns",
  );
});

test("instruments are overlays: self-gated by pane width, jump via data-turn-id", () => {
  assert.match(
    instruments,
    /THREAD_INSTRUMENTS_MIN_WIDTH = 1360/,
    "one shared wide-pane gate for both instruments",
  );
  assert.match(
    instruments,
    /querySelector<HTMLElement>\(`\[data-turn-id="\$\{CSS\.escape\(turnId\)\}"\]`\)/,
    "jumps target the transcript's existing turn anchors",
  );
  // rAF-coalescing refs must null on cancel (the #2659 wedge) — both cleanups.
  const cancels = instruments.match(/cancelAnimationFrame\(frameRef\.current\);\s*\n\s*frameRef\.current = null;/g) ?? [];
  assert.equal(cancels.length, 2, "every rAF guard nulls its ref when cancelling");
});
