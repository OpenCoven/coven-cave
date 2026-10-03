// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  READER_MEASURE_BIG_STEP_PX,
  READER_MEASURE_MAX_PX,
  READER_MEASURE_MIN_PX,
  READER_MEASURE_STEP_PX,
  clampReaderMeasure,
  loadReaderMeasure,
  measureAfterDrag,
  measureAfterKey,
  parseStoredReaderMeasure,
  readerMeasureStorageKey,
  saveReaderMeasure,
} from "./reader-measure.ts";

test("the reading measure is capped at max-w-screen-2xl", () => {
  assert.equal(READER_MEASURE_MAX_PX, 1536, "96rem at the 16px root");
  assert.equal(clampReaderMeasure(4000), 1536);
  assert.equal(clampReaderMeasure(10), READER_MEASURE_MIN_PX);
  assert.equal(clampReaderMeasure(900.4), 900);
});

test("available space bounds the maximum, never the minimum", () => {
  assert.equal(clampReaderMeasure(1400, 1000), 1000);
  assert.equal(clampReaderMeasure(1400, 200), READER_MEASURE_MIN_PX);
});

test("a centered column follows the dragged edge", () => {
  assert.equal(measureAfterDrag(800, 50), 900, "the edge moves 50px, the width grows by 100px");
  assert.equal(measureAfterDrag(800, -100), 600);
  assert.equal(measureAfterDrag(800, 2000, 1200), 1200);
  assert.equal(measureAfterDrag(800, -2000), READER_MEASURE_MIN_PX);
});

test("the separator is keyboard operable", () => {
  assert.equal(measureAfterKey(800, "ArrowLeft", false), 800 - READER_MEASURE_STEP_PX);
  assert.equal(measureAfterKey(800, "ArrowRight", false), 800 + READER_MEASURE_STEP_PX);
  assert.equal(measureAfterKey(800, "ArrowRight", true), 800 + READER_MEASURE_BIG_STEP_PX);
  assert.equal(measureAfterKey(800, "Home", false), READER_MEASURE_MIN_PX);
  assert.equal(measureAfterKey(800, "End", false), READER_MEASURE_MAX_PX);
  assert.equal(measureAfterKey(800, "End", false, 1100), 1100);
  assert.equal(measureAfterKey(800, "Enter", false), null, "Enter returns to the preset");
  assert.equal(measureAfterKey(800, "e", false), undefined, "other keys keep their meaning");
});

test("stored widths are validated and clamped", () => {
  assert.equal(parseStoredReaderMeasure(null), null);
  assert.equal(parseStoredReaderMeasure(""), null);
  assert.equal(parseStoredReaderMeasure("wide"), null);
  assert.equal(parseStoredReaderMeasure("NaN"), null);
  assert.equal(parseStoredReaderMeasure("1200"), 1200);
  assert.equal(parseStoredReaderMeasure("99999"), READER_MEASURE_MAX_PX);
});

test("widths persist per surface and clear back to the preset", () => {
  const store = new Map();
  const previous = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
  };
  try {
    assert.equal(loadReaderMeasure("library"), null);
    saveReaderMeasure("library", 1024);
    assert.equal(store.get(readerMeasureStorageKey("library")), "1024");
    assert.equal(loadReaderMeasure("library"), 1024);
    assert.equal(loadReaderMeasure("research"), null, "surfaces do not share a width");
    saveReaderMeasure("library", null);
    assert.equal(store.has(readerMeasureStorageKey("library")), false);
  } finally {
    globalThis.window = previous;
  }
});

test("unavailable storage never throws", () => {
  const previous = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    },
  };
  try {
    assert.equal(loadReaderMeasure("library"), null);
    assert.doesNotThrow(() => saveReaderMeasure("library", 900));
  } finally {
    globalThis.window = previous;
  }
});
