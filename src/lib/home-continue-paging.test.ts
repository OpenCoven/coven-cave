// Paging model behind Home's Continue carousel (cave-9oi1s).
//
// Behavioural only — every assertion computes a value and checks the value.
// Nothing here reads component or CSS source text.

import assert from "node:assert/strict";
import test from "node:test";

import {
  HOME_CONTINUE_PAGE_SIZE,
  continuePage,
  continuePageLabel,
} from "./home-continue-paging.ts";

test("a page covers pageSize items and reports its 1-based span", () => {
  const first = continuePage(9, 0);
  assert.equal(first.index, 0);
  assert.equal(first.count, 3);
  assert.equal(first.from, 1);
  assert.equal(first.to, 3);
  assert.equal(first.total, 9);

  const second = continuePage(9, 1);
  assert.equal(second.from, 4);
  assert.equal(second.to, 6);
});

test("the last page is short rather than padded", () => {
  const last = continuePage(7, 2);
  assert.equal(last.count, 3, "7 items over 3 per page is 3 pages");
  assert.equal(last.from, 7);
  assert.equal(last.to, 7, "the span stops at the real item count, not at 9");
});

test("a requested page past the end clamps to the last page", () => {
  // The component holds the requested page in state; the session list under it
  // can shrink while that state stands. Clamping here means the carousel never
  // renders an empty page it would have to correct in an effect.
  const clamped = continuePage(4, 99);
  assert.equal(clamped.index, 1);
  assert.equal(clamped.from, 4);
  assert.equal(clamped.to, 4);
});

test("an empty list is one addressable page with an empty span", () => {
  const empty = continuePage(0, 0);
  assert.equal(empty.count, 1, "index 0 must always be addressable");
  assert.equal(empty.index, 0);
  assert.equal(empty.from, 0);
  assert.equal(empty.to, 0);
});

test("hostile inputs resolve rather than producing a negative or NaN span", () => {
  for (const [total, requested] of [
    [Number.NaN, 0],
    [-5, 0],
    [6, Number.NaN],
    [6, -3],
    [Number.POSITIVE_INFINITY, 0],
  ] as const) {
    const page = continuePage(total, requested);
    assert.ok(Number.isInteger(page.index) && page.index >= 0, `index for ${total}/${requested}`);
    assert.ok(page.count >= 1, `count for ${total}/${requested}`);
    assert.ok(page.to >= page.from, `span for ${total}/${requested}`);
    assert.ok(page.from >= 0, `from for ${total}/${requested}`);
  }
});

test("a non-positive page size falls back to the design's three-across page", () => {
  assert.equal(continuePage(9, 1, 0).from, 4);
  assert.equal(continuePage(9, 1, -2).to, 6);
  assert.equal(HOME_CONTINUE_PAGE_SIZE, 3);
});

test("an explicit page size is honoured", () => {
  const page = continuePage(10, 2, 4);
  assert.equal(page.count, 3);
  assert.equal(page.from, 9);
  assert.equal(page.to, 10);
});

test("the label states the reader's position, and singular when the page holds one", () => {
  assert.equal(continuePageLabel(continuePage(9, 1)), "Sessions 4 to 6 of 9");
  assert.equal(continuePageLabel(continuePage(7, 2)), "Session 7 of 7");
  assert.equal(continuePageLabel(continuePage(0, 0)), "No sessions to continue");
});

test("consecutive pages tile the list with no gap and no overlap", () => {
  const total = 11;
  const { count } = continuePage(total, 0);
  const covered: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const page = continuePage(total, i);
    for (let position = page.from; position <= page.to; position += 1) covered.push(position);
  }
  assert.deepEqual(
    covered,
    Array.from({ length: total }, (_, i) => i + 1),
    "every session appears on exactly one page, in order",
  );
});

console.log("home-continue-paging.test.ts: ok");
