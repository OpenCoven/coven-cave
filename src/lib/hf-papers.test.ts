import assert from "node:assert/strict";
import { test } from "node:test";

import { hfPaperUrl, isArxivPaperId, parseHfPaperReferences } from "./hf-papers.ts";

test("recognises both command spellings", () => {
  assert.deepEqual(parseHfPaperReferences("hf papers read 2401.12345"), ["2401.12345"]);
  assert.deepEqual(parseHfPaperReferences("hf paper read 2401.12345"), ["2401.12345"]);
});

test("strips a version suffix to the canonical id", () => {
  assert.deepEqual(parseHfPaperReferences("hf papers read 2401.12345v2"), ["2401.12345"]);
});

test("recognises HF and arXiv URLs", () => {
  assert.deepEqual(parseHfPaperReferences("https://huggingface.co/papers/2401.12345"), ["2401.12345"]);
  assert.deepEqual(parseHfPaperReferences("https://arxiv.org/abs/2401.12345"), ["2401.12345"]);
  assert.deepEqual(parseHfPaperReferences("https://arxiv.org/pdf/2401.12345"), ["2401.12345"]);
});

test("collapses every spelling of one paper to a single id", () => {
  const text = [
    "hf papers read 2401.12345",
    "https://huggingface.co/papers/2401.12345",
    "https://arxiv.org/pdf/2401.12345v3",
  ].join("\n");
  assert.deepEqual(parseHfPaperReferences(text), ["2401.12345"]);
});

test("does NOT match a bare id with no command or URL", () => {
  assert.deepEqual(parseHfPaperReferences("the figure on 2401.12345 is wrong"), []);
});

test("does NOT match an over-long number", () => {
  assert.deepEqual(parseHfPaperReferences("hf papers read 2401.1234567"), []);
});

test("canonical URL and id guard", () => {
  assert.equal(hfPaperUrl("2401.12345"), "https://huggingface.co/papers/2401.12345");
  assert.equal(isArxivPaperId("2401.12345"), true);
  assert.equal(isArxivPaperId("2401.1234567"), false);
  assert.equal(isArxivPaperId("../etc/passwd"), false);
});
