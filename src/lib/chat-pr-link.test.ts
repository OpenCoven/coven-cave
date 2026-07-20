// @ts-nocheck
import assert from "node:assert/strict";
import { test } from "node:test";
import { latestPrUrlFromText } from "./chat-pr-link.ts";

test("extracts a plain PR URL", () => {
  assert.equal(
    latestPrUrlFromText("Merged as https://github.com/OpenCoven/coven-cave/pull/3249 — done."),
    "https://github.com/OpenCoven/coven-cave/pull/3249",
  );
});

test("the LAST PR URL wins", () => {
  const text = [
    "Follow-up from https://github.com/OpenCoven/coven-cave/pull/2983.",
    "Landed as **PR #3125** (https://github.com/OpenCoven/coven-cave/pull/3125).",
  ].join("\n");
  assert.equal(latestPrUrlFromText(text), "https://github.com/OpenCoven/coven-cave/pull/3125");
});

test("trailing paths, fragments, and punctuation are normalized away", () => {
  assert.equal(
    latestPrUrlFromText("see https://github.com/o/r/pull/12/files#diff-abc),"),
    "https://github.com/o/r/pull/12",
  );
  assert.equal(
    latestPrUrlFromText("(https://github.com/o/r/pull/7)"),
    "https://github.com/o/r/pull/7",
  );
  assert.equal(
    latestPrUrlFromText('link: "https://github.com/o/r/pull/9#issuecomment-1"'),
    "https://github.com/o/r/pull/9",
  );
});

test("issues, repos, and non-GitHub hosts do not match", () => {
  assert.equal(latestPrUrlFromText("https://github.com/o/r/issues/5"), null);
  assert.equal(latestPrUrlFromText("https://github.com/o/r"), null);
  assert.equal(latestPrUrlFromText("https://gitlab.com/o/r/pull/5"), null);
  assert.equal(latestPrUrlFromText("https://evil.example/github.com/o/r/pull/1"), null);
});

test("a later non-PR link does not clobber an earlier PR link", () => {
  const text =
    "PR https://github.com/o/r/pull/3 and repo https://github.com/o/r plus issue https://github.com/o/r/issues/8";
  assert.equal(latestPrUrlFromText(text), "https://github.com/o/r/pull/3");
});

test("null/empty/PR-free text yields null", () => {
  assert.equal(latestPrUrlFromText(null), null);
  assert.equal(latestPrUrlFromText(undefined), null);
  assert.equal(latestPrUrlFromText(""), null);
  assert.equal(latestPrUrlFromText("no links here"), null);
});

test("www.github.com is accepted and canonicalized", () => {
  assert.equal(
    latestPrUrlFromText("https://www.github.com/o/r/pull/2"),
    "https://github.com/o/r/pull/2",
  );
});
