// @ts-nocheck
// The Rewrite control's pure model (Reader.dc.html 3a): what each tone asks
// for, and how the reply is recovered from a --stream-json transcript.
import assert from "node:assert/strict";
import test from "node:test";

import {
  REWRITE_MAX_CHARS,
  REWRITE_TONES,
  extractRewrite,
  isRewriteTone,
  isUsableRewrite,
  rewritePrompt,
} from "./reader-rewrite.ts";

test("Full is not a tone — it is the original text, never a model call", () => {
  assert.deepEqual([...REWRITE_TONES], ["brief", "eli5"]);
  assert.equal(isRewriteTone("full"), false);
  assert.equal(isRewriteTone("brief"), true);
  assert.equal(isRewriteTone("ELI5"), false, "the wire value is lowercase");
  assert.equal(isRewriteTone(undefined), false);
});

test("every tone forbids answering, researching, or inventing", () => {
  for (const tone of REWRITE_TONES) {
    const prompt = rewritePrompt(tone, "the answer");
    assert.match(prompt, /Do not answer it, research it, or add anything/);
    assert.match(prompt, /Keep every factual claim, file path, identifier and number exactly as written/);
    assert.match(prompt, /Reply with the rewritten text and nothing else/);
    assert.ok(prompt.endsWith("the answer"), "the answer is the last thing in the prompt");
  }
});

test("the two tones ask for different things", () => {
  const brief = rewritePrompt("brief", "x");
  const eli5 = rewritePrompt("eli5", "x");

  assert.match(brief, /as short as it can be while keeping every finding and its verdict/);
  assert.match(eli5, /expand jargon on first use/);
  assert.notEqual(brief, eli5);
});

test("assistant text is concatenated in order across stream events", () => {
  const raw = [
    '{"role":"assistant","text":"Tests pass. "}',
    '{"role":"assistant","text":"Two regressions."}',
  ].join("\n");

  assert.equal(extractRewrite(raw), "Tests pass. Two regressions.");
});

test("non-assistant events are not part of the answer", () => {
  const raw = [
    '{"role":"user","text":"Rewrite the text below."}',
    '{"role":"assistant","text":"The real reply."}',
    '{"role":"system","text":"session archived"}',
  ].join("\n");

  assert.equal(extractRewrite(raw), "The real reply.");
});

test("the nested content-block shape is read too", () => {
  const raw = '{"message":{"content":[{"type":"text","text":"Condensed."},{"type":"tool_use","id":"t1"}]}}';

  assert.equal(extractRewrite(raw), "Condensed.", "tool_use blocks carry no prose");
});

test("a flat string content field is read", () => {
  assert.equal(extractRewrite('{"content":"Short version."}'), "Short version.");
});

test("garbage lines are skipped rather than thrown on", () => {
  const raw = [
    "Reading config…",
    "not json at all",
    '{"broken":',
    '{"role":"assistant","text":"Survived."}',
  ].join("\n");

  assert.equal(extractRewrite(raw), "Survived.", "a partial stream still yields its prose");
});

test("an empty or whitespace stream yields nothing, not a crash", () => {
  assert.equal(extractRewrite(""), "");
  assert.equal(extractRewrite("\n\n   \n"), "");
});

test("a reply too short to be a rewrite is not usable", () => {
  // The reader keeps the original rather than blanking the document.
  assert.equal(isUsableRewrite(""), false);
  assert.equal(isUsableRewrite("   "), false);
  assert.equal(isUsableRewrite("ok"), false);
  assert.equal(isUsableRewrite("Tests pass, two regressions found."), true);
});

test("there is a cap on what will be sent for rewriting", () => {
  // The one way this feature could get expensive by accident.
  assert.equal(typeof REWRITE_MAX_CHARS, "number");
  assert.ok(REWRITE_MAX_CHARS > 1000 && REWRITE_MAX_CHARS <= 100_000);
});
