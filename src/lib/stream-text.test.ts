// @ts-nocheck
import assert from "node:assert/strict";
import { appendCollapsingNewlines } from "./stream-text.ts";

// Equivalence with the naive whole-buffer collapse, across chunk boundaries.
const naive = (s) => s.replace(/\n{3,}/g, "\n\n");
function stream(chunks) {
  let acc = "";
  for (const c of chunks) acc = appendCollapsingNewlines(acc, c);
  return acc;
}

assert.equal(stream(["hello ", "world"]), "hello world");
assert.equal(stream(["a\n\n\n", "b"]), naive("a\n\n\nb"), "collapses a run inside one chunk");
assert.equal(stream(["a\n\n", "\n\nb"]), naive("a\n\n\n\nb"), "collapses a run straddling the seam");
assert.equal(stream(["a\n", "\n", "\n", "\nb"]), naive("a\n\n\n\nb"), "collapses newlines arriving one-per-chunk");
assert.equal(stream(["line\n\n\n\n\n\nend"]), "line\n\nend", "collapses a long run to exactly two");
assert.equal(appendCollapsingNewlines("anything", ""), "anything", "empty chunk is a no-op");

// Randomized: streamed result equals the naive collapse of the concatenation.
const fragments = ["x", "\n", "\n\n", "\n\n\n", "y ", "z\n", "\nq"];
for (let seed = 0; seed < 40; seed++) {
  const chunks = [];
  let n = (seed * 7 + 3) % 9 + 1;
  for (let i = 0; i < n; i++) chunks.push(fragments[(seed * 3 + i * 5) % fragments.length]);
  assert.equal(stream(chunks), naive(chunks.join("")), `seed ${seed}: ${JSON.stringify(chunks)}`);
}

console.log("stream-text: ok");
