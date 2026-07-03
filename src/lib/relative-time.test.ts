import assert from "node:assert/strict";
import { test } from "node:test";
import { relativeTime, isRelativePhrase, relativeTimeSigned } from "./relative-time.ts";
import { relativeTime as reExported } from "./daily-report.ts";
import { readFileSync } from "node:fs";

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

test("dates from a prior year include the year (Mon D, YYYY)", () => {
  const out = relativeTime("2025-01-05T12:00:00.000Z", NOW);
  assert.match(out, /^[A-Za-z]{3} \d{1,2}, \d{4}$/, `expected "Mon D, YYYY", got "${out}"`);
  assert.match(out, /2025/);
  // a same-year date older than a week still omits the year
  assert.doesNotMatch(relativeTime(ago(60 * 24 * 8), NOW), /\d{4}/);
});

test("density key stays in sync with datetime-format (no drift)", () => {
  const dt = readFileSync(new URL("./datetime-format.ts", import.meta.url), "utf8");
  const rt = readFileSync(new URL("./relative-time.ts", import.meta.url), "utf8");
  const key = dt.match(/DATETIME_DENSITY_KEY = "([^"]+)"/)?.[1];
  assert.ok(key, "datetime-format defines DATETIME_DENSITY_KEY");
  assert.ok(rt.includes(`"${key}"`), "relative-time reads the same density key");
});

test("verbose density spells out phrases and uses long month names", () => {
  assert.equal(relativeTime(ago(0), NOW, "verbose"), "just now");
  assert.equal(relativeTime(ago(1), NOW, "verbose"), "1 minute ago");
  assert.equal(relativeTime(ago(5), NOW, "verbose"), "5 minutes ago");
  assert.equal(relativeTime(ago(60), NOW, "verbose"), "1 hour ago");
  assert.equal(relativeTime(ago(180), NOW, "verbose"), "3 hours ago");
  assert.equal(relativeTime(ago(60 * 24), NOW, "verbose"), "1 day ago");
  const out = relativeTime(ago(60 * 24 * 8), NOW, "verbose");
  assert.match(out, /^[A-Za-z]{4,} \d{1,2}$/, `expected a long-month date, got "${out}"`);
  // compact remains the default when no density is passed
  assert.equal(relativeTime(ago(5), NOW), "5m ago");
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

test("relativeTimeSigned handles past and future, compact + verbose", () => {
  const now = new Date("2026-01-01T12:00:00Z").getTime();
  // compact
  assert.equal(relativeTimeSigned("2026-01-01T11:58:00Z", now, "compact"), "2m ago");
  assert.equal(relativeTimeSigned("2026-01-01T12:05:00Z", now, "compact"), "in 5m");
  assert.equal(relativeTimeSigned("2026-01-01T11:59:40Z", now, "compact"), "just now");
  assert.equal(relativeTimeSigned("2026-01-01T12:00:20Z", now, "compact"), "soon");
  // verbose
  assert.equal(relativeTimeSigned("2026-01-01T10:00:00Z", now, "verbose"), "2 hours ago");
  assert.equal(relativeTimeSigned("2026-01-01T14:00:00Z", now, "verbose"), "in 2 hours");
  // null
  assert.equal(relativeTimeSigned(null, now, "compact"), "");
});

test('bare density: compact thresholds without the " ago" suffix', () => {
  assert.equal(relativeTime(ago(0), NOW, "bare"), "just now");
  assert.equal(relativeTime(ago(2), NOW, "bare"), "2m");
  assert.equal(relativeTime(ago(180), NOW, "bare"), "3h");
  assert.equal(relativeTime(ago(60 * 24 * 3), NOW, "bare"), "3d");
  // ≥7 days falls through to the same short date as compact.
  const out = relativeTime(ago(60 * 24 * 8), NOW, "bare");
  assert.match(out, /^[A-Za-z]{3} \d{1,2}$/, `expected a "Mon D" date, got "${out}"`);
});
