import assert from "node:assert/strict";
import { test } from "node:test";
import { relativeTime, isRelativePhrase } from "./relative-time.ts";
import { relativeTime as reExported } from "./daily-report.ts";

const NOW = new Date("2026-06-18T12:00:00.000Z");
const NOW_MS = NOW.getTime();
const ago = (mins: number) => new Date(NOW_MS - mins * 60_000).toISOString();

test("buckets: just now / minutes / hours / days, then short date", () => {
  assert.equal(relativeTime(ago(0), NOW), "just now");
  assert.equal(relativeTime(ago(2), NOW), "2m ago");
  assert.equal(relativeTime(ago(180), NOW), "3h ago");
  assert.equal(relativeTime(ago(60 * 24), NOW), "1d ago");
  assert.equal(relativeTime(ago(60 * 24 * 3), NOW), "3d ago");
  // 8 days ago → past the week, falls through to a short month/day date.
  const out = relativeTime(ago(60 * 24 * 8), NOW);
  assert.match(out, /^[A-Za-z]{3} \d{1,2}$/, `expected a "Mon D" date, got "${out}"`);
  assert.doesNotMatch(out, /ago/);
});

test("now accepts a number (epoch ms) or a Date, identically", () => {
  assert.equal(relativeTime(ago(2), NOW_MS), relativeTime(ago(2), NOW));
});

test("empty/invalid input renders nothing", () => {
  assert.equal(relativeTime(null), "");
  assert.equal(relativeTime(undefined), "");
  assert.equal(relativeTime(""), "");
  assert.equal(relativeTime("not-a-date"), "");
});

test("daily-report re-exports the same function (no behavior drift)", () => {
  assert.equal(reExported, relativeTime);
  assert.equal(reExported(ago(2), NOW), "2m ago");
});

test("isRelativePhrase distinguishes relative phrases from the absolute fallback", () => {
  assert.equal(isRelativePhrase("just now"), true);
  assert.equal(isRelativePhrase("5m ago"), true);
  assert.equal(isRelativePhrase("2h ago"), true);
  assert.equal(isRelativePhrase("3d ago"), true);
  assert.equal(isRelativePhrase("Jun 6"), false);
  assert.equal(isRelativePhrase(""), false);
});
