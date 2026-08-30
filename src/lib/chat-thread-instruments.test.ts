// Contract tests for the transcript's LEFT turn spine (cave-j86la): the pure
// derivation it consumes, plus source pins for how chat-view mounts it.
//
// The thread minimap that used to share this module is permanently removed
// (cave-5m5hv). The pins at the bottom are what keep it removed AND what keep
// the spine mounted — a removal PR is exactly where "nothing renders" quietly
// passes for "the old thing is gone".
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import * as instrumentModel from "./chat-thread-instruments.ts";
import {
  instrumentSummary,
  instrumentTime,
  spineSegmentHeights,
  spineNodes,
  spineStackHeight,
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

test("the minimap derivation is gone from the module, not merely unused", () => {
  // The minimap's model was `threadMapEvents` plus the two helpers only it
  // called. Naming them individually is the point: a removal that leaves the
  // derivation exported keeps a working minimap one import away, and the next
  // reader has no way to tell "retired" from "not currently mounted" — which
  // is exactly the state this change found the codebase in.
  for (const retired of ["threadMapEvents", "toolBarWidth", "formatTookLabel"]) {
    assert.ok(
      !(retired in instrumentModel),
      `${retired} was minimap-only and must not survive the removal`,
    );
  }
  // What the spine actually needs is still here — the sweep above must not be
  // satisfiable by deleting the module.
  for (const kept of ["spineNodes", "spineStackHeight", "spineSegmentHeights", "toolCategory"]) {
    assert.ok(kept in instrumentModel, `${kept} is the spine's own derivation and must survive`);
  }
});

test("formatting helpers stay honest on absent data", () => {
  assert.equal(instrumentTime(undefined), null);
  assert.equal(instrumentTime("not a date"), null);
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

test("the spine stamp sits in its own lane, never under the node ring", () => {
  // The stamp used to be placed at `left: -18px` on a node inset by 18px, so
  // it started at the gutter's x=0 and ran ~30px right — straight beneath the
  // 26px ring, which paints over it. Right-anchoring is what keeps the clock
  // legible, so pin the anchor rather than any one offset.
  assert.match(
    instrumentStyles,
    /\.cave-thread-spine__time \{[^}]*right: 100%;/,
    "the stamp must end at the node's left edge, not start at the gutter's",
  );
  assert.match(
    instrumentStyles,
    /\.cave-thread-spine__time \{[^}]*margin-right: var\(--cave-spine-stamp-gap\);/,
    "a gap must separate the stamp from the ring",
  );
  assert.doesNotMatch(
    instrumentStyles,
    /\.cave-thread-spine__time \{[^}]*left: -/,
    "a negative left pulls the stamp back under the ring — the original bug",
  );

  // The ring column and the rule under it must both be pushed right by the
  // same lane, or widening the lane just moves the collision instead of
  // removing it.
  for (const [selector, expected] of [
    [".cave-thread-spine__node", "left: var(--cave-spine-node-inset);"],
    [".cave-thread-spine__line", "left: calc(var(--cave-spine-node-inset) + 13px);"],
  ] as const) {
    const block = new RegExp(`\\${selector} \\{[^}]*${expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
    assert.match(instrumentStyles, block, `${selector} must derive from the stamp lane`);
  }

  // The lane is sized from the clock STRING, not a px guess: a 12-hour locale
  // renders "11:00 PM" where a 24-hour one renders "23:00", and only a
  // character-count knob survives that difference on someone else's machine.
  assert.match(
    instrumentStyles,
    /--cave-spine-stamp-chars: \d+;/,
    "the lane must be driven by a character count",
  );
  assert.match(
    instrumentStyles,
    /--cave-spine-stamp-lane: calc\(var\(--cave-spine-stamp-chars\) \* [\d.]+ \* var\(--text-2xs\)\)/,
    "the lane must derive from the stamp's own type scale, so a font change moves it too",
  );
  // Clipping keeps an over-long stamp cut at the left instead of sliding back
  // under the ring — an unreadable prefix beats an unreadable whole.
  assert.match(
    instrumentStyles,
    /\.cave-thread-spine__time \{[^}]*overflow: hidden;/,
    "an over-long stamp must clip inside its lane",
  );
});

test("spine controls use the shared focus ring and no dead running class", () => {
  assert.match(instruments, /className=\{`cave-thread-spine__node focus-ring/);
  assert.doesNotMatch(instruments, /is-running/);
});

test("spine tint mappings use theme-aware semantic tokens", () => {
  assert.doesNotMatch(instrumentStyles, /--tim-[^:]+:\s*oklch\(/);
  assert.match(instrumentStyles, /\.cave-thread-spine \.is-read \{ --tim: var\(--color-info\); \}/);
});

// ── the left turn spine SURVIVES the minimap's removal ──────────────────────
// This is the constraint the removal is most likely to violate by accident:
// both instruments lived in one file behind one preference, so deleting the
// preference or the file takes the spine with it and every remaining test
// still passes. Assert the spine renders, not merely that it compiles.
test("chat-view mounts the left turn spine over the transcript's own activePath", () => {
  assert.match(
    chatView,
    /^import \{ ChatThreadSpine \} from "@\/components\/chat-thread-instruments";$/m,
    "chat-view imports the spine",
  );
  assert.match(
    chatView,
    /<ChatThreadSpine\s+turns=\{activePath\}\s+scrollRef=\{scrollRef\}/,
    "the spine reads the branch-aware visible path and the transcript's own scroller",
  );
  // Inside the scroller, not beside it: the spine is an overlay in the left
  // gutter, so it must be mounted within the element it measures and scrolls
  // with. Mounted outside, it would render against the wrong box and jump
  // nodes to offsets computed in another coordinate space.
  const scroller = chatView.indexOf('className="cave-chat-transcript');
  const spine = chatView.indexOf("<ChatThreadSpine");
  const thread = chatView.indexOf('className="cave-chat-thread"');
  assert.ok(scroller > 0 && spine > 0 && thread > 0, "scroller, spine and thread are all present");
  assert.ok(
    spine > scroller && spine < thread,
    "the spine mounts inside the transcript scroller, above the conversation log",
  );
});

test("the spine draws real per-turn nodes, not an empty nav", () => {
  // "Nothing renders" satisfies "the minimap is gone", so pin the marks a
  // reader would actually see: a labelled nav, one button per placed turn,
  // each carrying the tool-category stack that makes it an instrument.
  assert.match(instruments, /aria-label="Turns in this thread"/, "the spine is a named landmark");
  assert.match(instruments, /placed\.map\(\(node\) => \(\s*\n\s*<SpineNodeButton/, "one node per placed turn");
  assert.match(
    instruments,
    /node\.cats\.map\(\(c, index\) => \(/,
    "each node renders its tool-category stack",
  );
  assert.match(
    instruments,
    /aria-label=\{`Jump to \$\{node\.name\}'s turn/,
    "every node is an operable, named jump target",
  );
});

test("the retired minimap leaves no component, markup or stylesheet behind", () => {
  // Strip comments first. Both files explain in prose WHY the minimap is gone,
  // and an unanchored search happily matches that explanation — the "satisfied
  // by a comment" trap chat-run-rail.test.ts already guards against. Scan the
  // code, not the paragraph about the code.
  const code = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  assert.doesNotMatch(code(chatView), /ChatThreadMinimap/, "chat-view cannot mount it");
  assert.doesNotMatch(
    code(instruments),
    /ChatThreadMinimap|cave-thread-map|MapRow|MapHoverCard|threadMapEvents/,
    "the component, its rows and its hover card are deleted",
  );
  assert.doesNotMatch(code(instrumentStyles), /cave-thread-map/, "its stylesheet rules are deleted");
  // The stripper must not be doing the work on its own.
  assert.match(code(instruments), /ChatThreadSpine/, "the spine is still real code, not a comment");
});

test("the spine is an overlay: self-gated by pane width, jumps via data-turn-id", () => {
  assert.match(
    instruments,
    /THREAD_INSTRUMENTS_MIN_WIDTH = 1360/,
    "the spine's wide-pane gate",
  );
  assert.match(
    instruments,
    /querySelector<HTMLElement>\(`\[data-turn-id="\$\{CSS\.escape\(turnId\)\}"\]`\)/,
    "jumps target the transcript's existing turn anchors",
  );
  // The spine is `position: absolute` inside the scroller, so it can never add
  // a horizontal axis to the transcript — the property phone widths depend on.
  assert.match(
    instrumentStyles,
    /\.cave-thread-spine \{[^}]*position: absolute;/,
    "the spine is an overlay, never layout",
  );
  // rAF-coalescing refs must null on cancel (the #2659 wedge). One guard now
  // that the minimap's scroll tracker is gone; the count is the assertion, so
  // a re-added guard that forgets to null still fails.
  const cancels = instruments.match(/cancelAnimationFrame\(frameRef\.current\);\s*\n\s*frameRef\.current = null;/g) ?? [];
  const raf = instruments.match(/requestAnimationFrame\(/g) ?? [];
  assert.equal(raf.length, 1, "the spine keeps exactly one rAF-coalesced measure");
  assert.equal(cancels.length, 1, "every rAF guard nulls its ref when cancelling");
});
