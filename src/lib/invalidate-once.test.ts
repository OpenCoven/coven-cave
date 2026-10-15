import assert from "node:assert/strict";
import { test } from "node:test";
import { createInvalidateOnce } from "./invalidate-once.ts";

test("the first listener for an event invalidates; later ones don't (#5869)", () => {
  const calls: string[] = [];
  const once = createInvalidateOnce((key) => calls.push(key));
  const event = { topic: "board", version: 3 };
  once(event, "board:cards");
  once(event, "board:cards");
  assert.deepEqual(calls, ["board:cards"]);
});

test("a new event invalidates again, and keys are tracked separately", () => {
  const calls: string[] = [];
  const once = createInvalidateOnce((key) => calls.push(key));
  const first = { topic: "board", version: 3 };
  once(first, "board:cards");
  once(first, "board:cards", "board:other");
  once({ topic: "board", version: 4 }, "board:cards");
  assert.deepEqual(calls, ["board:cards", "board:other", "board:cards"]);
});
