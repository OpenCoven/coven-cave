// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { publishBoardChanged, publishSchedulesChanged } from "./board-cache-events.ts";

test("publishes the board reload event after an external board mutation", () => {
  const priorWindow = globalThis.window;
  const events = [];
  globalThis.window = { dispatchEvent: (event) => events.push(event.type) };
  try {
    publishBoardChanged();
    assert.deepEqual(events, ["cave:board:reload"]);
  } finally {
    globalThis.window = priorWindow;
  }
});

test("publishes the schedules reload event after an external automation mutation", () => {
  const priorWindow = globalThis.window;
  const events = [];
  globalThis.window = { dispatchEvent: (event) => events.push(event.type) };
  try {
    publishSchedulesChanged();
    assert.deepEqual(events, ["cave:schedules:reload"]);
  } finally {
    globalThis.window = priorWindow;
  }
});
