// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSentenceChunker,
  MIN_SPOKEN_SENTENCE_CHARS,
} from "./speech-loop.ts";

test("emits each completed sentence exactly once as text accumulates", () => {
  const chunker = createSentenceChunker(10);
  assert.deepEqual(chunker.push("The moon is full toni"), []);
  assert.deepEqual(chunker.push("The moon is full tonight. The cats are"), [
    "The moon is full tonight.",
  ]);
  // Re-pushing the same accumulation emits nothing new.
  assert.deepEqual(chunker.push("The moon is full tonight. The cats are"), []);
  assert.deepEqual(
    chunker.push("The moon is full tonight. The cats are out! And the o"),
    ["The cats are out!"],
  );
});

test("flush returns the unterminated tail once", () => {
  const chunker = createSentenceChunker(10);
  assert.deepEqual(chunker.push("First part done. And a trailing thought"), [
    "First part done.",
  ]);
  assert.equal(
    chunker.flush("First part done. And a trailing thought"),
    "And a trailing thought",
  );
  assert.equal(chunker.flush("First part done. And a trailing thought"), null);
});

test("short fragments buffer until a later break instead of tiny utterances", () => {
  const chunker = createSentenceChunker();
  // "1. " looks like a sentence break but is far below the minimum — it must
  // ride with the following text, not become its own utterance.
  const text = "1. Feed the familiar something substantial to say aloud. Then rest.";
  const out = chunker.push(text);
  assert.deepEqual(out, [
    "1. Feed the familiar something substantial to say aloud.",
  ]);
  assert.ok(out[0].length >= MIN_SPOKEN_SENTENCE_CHARS);
});

test("question and ellipsis breaks with closing quotes are honored", () => {
  const chunker = createSentenceChunker(10);
  assert.deepEqual(
    chunker.push('"Shall we begin the ritual?" She nodded once… And then'),
    ['"Shall we begin the ritual?"', "She nodded once…"],
  );
});
