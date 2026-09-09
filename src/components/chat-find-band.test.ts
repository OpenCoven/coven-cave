// @ts-nocheck
// Source pins for the find band (cave-7gr08, Chat.dc.html 2a). The behavioural
// contract lives in src/lib/transcript-find.test.ts; these pin the wiring and
// the design's structure — control row, toggles, hit list, empty state.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const band = read("./chat-find-band.tsx");
const chatView = read("./chat-view.tsx");
const css = read("../styles/cave-chat/activity.css");

// ── The band replaced the inline widget, under the title row ────────────────
assert.doesNotMatch(chatView, /function ChatFindBar/, "the inline find bar is retired");
assert.doesNotMatch(css, /\.cave-chat-find\b/, "and so is its CSS, exclusions included");
assert.match(
  chatView,
  /<\/header>[\s\S]{0,600}?<ChatFindBand/,
  "the band renders under the title row, not inside the action cluster",
);
assert.match(
  chatView,
  /turns\.length > 0 && !findOpen \?[\s\S]{0,400}?aria-label="Find in conversation"/,
  "the header keeps only the trigger, and hides it while the band is open",
);

// ── Control row: the design's 37px row with both toggles ────────────────────
assert.match(css, /\.cave-find-band__controls \{[\s\S]*?min-height: 37px;/, "37px control row");
assert.match(band, /aria-pressed=\{matchCase\}/, "Match case is a pressed-state toggle");
assert.match(band, /aria-pressed=\{wholeWord\}/, "Whole word is a pressed-state toggle");
assert.match(
  css,
  /\.cave-find-band__count \{[\s\S]*?font-variant-numeric: tabular-nums;/,
  "the count is tabular so it does not shuffle the controls as it changes",
);

// ── The hit list is the point of the redesign ───────────────────────────────
assert.match(band, /visibleHits\.map\(\(hit, offset\) =>/, "only the bounded hit window gets rows");
assert.match(band, /const index = windowStart \+ offset;/, "row actions retain global hit indexes");
assert.doesNotMatch(band, /\bhits\.map\(/, "the full result set must never mount at once");
assert.match(
  band,
  /<mark className="cave-find-hit__mark">\{match\}<\/mark>/,
  "the hit is highlighted in place inside its snippet",
);
assert.match(
  band,
  /hit\.snippet\.slice\(0, hit\.snippetStart\)[\s\S]*?hit\.snippet\.slice\(hit\.snippetStart, hit\.snippetEnd\)[\s\S]*?hit\.snippet\.slice\(hit\.snippetEnd\)/,
  "the row splits its snippet by the hit's own offsets",
);
assert.match(band, /onClick=\{\(\) => onSelectHit\(index\)\}/, "a row jumps to its hit");
assert.match(band, /data-role=\{hit\.role\}/, "the author name is role-tinted");
assert.match(css, /\.cave-find-hit__name\[data-role="user"\]/, "and the tint is defined");
assert.match(
  css,
  /\.cave-find-band__list \{[\s\S]*?max-height: 240px;[\s\S]*?overflow-y: auto;/,
  "the list scrolls inside a cap so the band never eats the transcript",
);

// A nested <button> is invalid markup and the inner one steals the click —
// UserChatAvatar is a button that navigates to settings, so the row uses a
// plain initial instead.
assert.doesNotMatch(band, /<UserChatAvatar/, "no nested button inside the hit row");
assert.match(band, /cave-find-hit__initial/, "the user side of a hit row is a plain initial");

// ── Empty state names a way forward ─────────────────────────────────────────
assert.match(band, /No matches in this chat/, "the empty state says what happened");
assert.match(
  band,
  /matchCase \|\| wholeWord \?/,
  "it only offers to relax a filter that is actually on",
);
assert.match(band, /cave-find-band__kbd">⌘K<\/kbd>/, "and points at all-session search");

// ── chat-view wiring: hits, toggles, re-jump ────────────────────────────────
assert.match(chatView, /findTranscriptHits\(/, "the view matches occurrences, not just turns");
assert.match(
  chatView,
  /\{ matchCase: findMatchCase, wholeWord: findWholeWord \}/,
  "the toggles reach the matcher",
);
assert.match(
  chatView,
  /const key = \[findMatchCase \? "c" : "", findWholeWord \? "w" : "", findDebouncedQuery\]\.join\("\|"\);/,
  "the re-jump key includes the toggles — flipping one must not strand the active hit",
);
assert.match(
  chatView,
  /const id = matches\[idx\]\?\.turnId;/,
  "a jump still resolves to a turn, because scrolling lands on a turn",
);

console.log("chat-find-band.test.ts: ok");

// Use the existing TSX loader so this already-registered Node test also mounts
// the real component, rather than a test copy of the window arithmetic.
await import("../../scripts/test-alias-register.mjs");
const { ChatFindBand, CHAT_FIND_HIT_WINDOW_SIZE } = await import("./chat-find-band.tsx");
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeHits(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    turnId: `turn-${index}`,
    turnIndex: index,
    role: "user",
    snippet: `match ${index}`,
    snippetStart: 0,
    snippetEnd: 5,
    occurrenceInTurn: 1,
    occurrencesInTurn: 1,
    ellipsisStart: false,
    ellipsisEnd: false,
  }));
}

async function mountBand(initialIndex = 0, count = 1000) {
  let renderer;
  let activeIndex = initialIndex;
  let hits = makeHits(count);
  let open = true;
  const selected: number[] = [];
  const scrolling: unknown[] = [];
  const focus = { calls: 0 };
  const select = (index: number) => {
    selected.push(index);
    activeIndex = index;
    renderer.update(render());
  };
  const render = () => createElement(ChatFindBand, {
    open,
    query: "match",
    hits,
    activeIndex,
    matchCase: false,
    wholeWord: false,
    focusNonce: 0,
    familiar: { id: "sage", display_name: "Sage" },
    operatorName: "Reader",
    onQueryChange() {},
    onToggleMatchCase() {},
    onToggleWholeWord() {},
    onSelectHit: select,
    onNext: () => { if (hits.length) select((activeIndex + 1) % hits.length); },
    onPrev: () => { if (hits.length) select((activeIndex - 1 + hits.length) % hits.length); },
    onClose: () => { open = false; renderer.update(render()); },
  });
  await act(async () => {
    renderer = create(render(), {
      createNodeMock: (element) => {
        if (element.type === "input") return {
          focus: () => { focus.calls += 1; },
          select() {},
        };
        if (element.type === "ul") return {
          querySelector: () => ({ scrollIntoView: (options) => scrolling.push(options) }),
        };
        return null;
      },
    });
  });
  return {
    get root() { return renderer.root; },
    get activeIndex() { return activeIndex; },
    selected,
    scrolling,
    focus,
    rows: () => renderer.root.findAllByType("li"),
    hitButtons: () => renderer.root.findAll((node) => node.type === "button" && node.props.className === "cave-find-hit focus-ring"),
    pageButton: (label: string) => renderer.root.find((node) => node.type === "button" && node.children.includes(label)),
    async key(key: string, shiftKey = false) {
      let prevented = false;
      await act(async () => {
        renderer.root.findByType("input").props.onKeyDown({
          key, shiftKey,
          preventDefault: () => { prevented = true; },
          stopPropagation() {},
        });
      });
      assert.equal(prevented, true);
    },
    async update(index: number, nextHits = hits) {
      activeIndex = index;
      hits = nextHits;
      await act(async () => { renderer.update(render()); });
    },
    async unmount() { await act(async () => { renderer.unmount(); }); },
  };
}

test("1,000 results mount only 40 hits while retaining full count and accessible positions", async () => {
  const mounted = await mountBand(500);
  try {
    assert.equal(CHAT_FIND_HIT_WINDOW_SIZE, 40);
    assert.equal(mounted.rows().length, 40);
    assert.equal(mounted.rows()[0].props["aria-posinset"], 481);
    for (const row of mounted.rows()) assert.equal(row.props["aria-setsize"], 1000);
    assert.equal(mounted.root.findByProps({ className: "cave-find-band__count" }).children.join(""), "501/1000");
    assert.equal(mounted.hitButtons().filter((row) => row.props["aria-current"] === "true").length, 1);
    await act(async () => { mounted.hitButtons()[0].props.onClick(); });
    assert.equal(mounted.selected.at(-1), 480, "clicks use full-result indexes, never window offsets");
    assert.equal(mounted.rows().length, 40);
  } finally {
    await mounted.unmount();
  }
});

test("Arrow and Enter navigation cross window edges and wrap while the active hit remains mounted", async () => {
  const mounted = await mountBand();
  try {
    for (const [key, shift, expected] of [
      ["ArrowUp", false, 999],
      ["Enter", false, 0],
      ["Enter", true, 999],
      ["ArrowDown", false, 0],
    ]) {
      await mounted.key(key, shift);
      assert.equal(mounted.activeIndex, expected);
      assert.equal(mounted.rows().length, 40);
      const active = mounted.rows().find((row) => row.props["aria-posinset"] === expected + 1);
      assert.ok(active);
      assert.equal(active.findByType("button").props["data-active"], "true");
    }
    await mounted.update(39);
    await mounted.key("ArrowDown");
    assert.equal(mounted.activeIndex, 40);
    assert.ok(mounted.scrolling.length >= 6, "every active-index change requests active row visibility");
    assert.deepEqual(mounted.scrolling.at(-1), { block: "nearest", behavior: "auto" });
    assert.equal(mounted.focus.calls, 1, "paging never steals focus back from a hit or page button");
    await mounted.key("Escape");
    assert.equal(mounted.root.findAllByType("li").length, 0);
  } finally {
    await mounted.unmount();
  }
});

test("explicit earlier/later paging reaches every hit without accumulating mounted rows", async () => {
  const mounted = await mountBand();
  try {
    const seen = new Set<number>();
    for (let page = 0; page < 100; page += 1) {
      const rows = mounted.rows();
      assert.ok(rows.length <= 40);
      for (const row of rows) seen.add(row.props["aria-posinset"]);
      const later = mounted.pageButton("Later matches");
      assert.ok(!later.props.disabled, "boundary controls remain keyboard-focusable");
      if (later.props["aria-disabled"]) break;
      await act(async () => { later.props.onClick(); });
    }
    assert.equal(seen.size, 1000);
    for (let page = 0; page < 100; page += 1) {
      const earlier = mounted.pageButton("Earlier matches");
      if (earlier.props["aria-disabled"]) break;
      await act(async () => { earlier.props.onClick(); });
      assert.ok(mounted.rows().length <= 40);
    }
    assert.equal(mounted.rows()[0].props["aria-posinset"], 1);
    const before = mounted.selected.length;
    await act(async () => { mounted.pageButton("Earlier matches").props.onClick(); });
    assert.equal(mounted.selected.length, before, "an aria-disabled boundary is also behaviorally inert");
  } finally {
    await mounted.unmount();
  }
});

test("shrinking/replaced results clamp the visible selection and refresh active-row visibility", async () => {
  const mounted = await mountBand(999);
  try {
    await mounted.update(999, makeHits(3));
    assert.equal(mounted.rows().length, 3);
    assert.equal(mounted.hitButtons()[2].props["data-active"], "true");
    assert.equal(mounted.root.findByProps({ className: "cave-find-band__count" }).children.join(""), "3/3");
    const priorScrolls = mounted.scrolling.length;
    await mounted.update(2, makeHits(3).map((hit) => ({ ...hit, turnId: `replacement-${hit.turnId}` })));
    assert.equal(mounted.scrolling.length, priorScrolls + 1, "new hits at the same index/count get scrolled too");
    await mounted.update(0, []);
    assert.equal(mounted.rows().length, 0);
    assert.equal(mounted.root.findByProps({ className: "cave-find-band__count" }).children.join(""), "0/0");
  } finally {
    await mounted.unmount();
  }
});
