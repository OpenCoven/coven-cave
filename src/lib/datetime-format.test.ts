import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_CLOCK,
  DEFAULT_DATE,
  formatClock,
  formatTimestamp,
  normalizeClock,
  normalizeDate,
} from "./datetime-format.ts";

// A no-Z ISO is parsed as LOCAL time, so the month/day are timezone-stable.
const ISO = "2026-06-19T13:31:00";

test("normalize falls back to defaults for junk", () => {
  assert.equal(normalizeClock("nonsense"), DEFAULT_CLOCK);
  assert.equal(normalizeClock(null), DEFAULT_CLOCK);
  assert.equal(normalizeClock("24h"), "24h");
  assert.equal(normalizeDate("nonsense"), DEFAULT_DATE);
  assert.equal(normalizeDate(undefined), DEFAULT_DATE);
  assert.equal(normalizeDate("ddmm"), "ddmm");
});

test("default prefs render MM.DD + 12-hour", () => {
  const out = formatTimestamp(ISO);
  assert.ok(out.startsWith("06.19 "), `expected MM.DD prefix, got "${out}"`);
  assert.match(out, /1:31/);
  assert.match(out, /[AP]M/i, "12-hour clock keeps an AM/PM marker");
});

test("24-hour clock drops AM/PM and shows 13:31", () => {
  const out = formatTimestamp(ISO, { clock: "24h", date: "off" });
  assert.match(out, /13:31/);
  assert.doesNotMatch(out, /[AP]M/i);
  assert.ok(!/^\d\d\./.test(out), "date Off omits the date prefix");
});

test("DD.MM reverses the date ordering", () => {
  const out = formatTimestamp(ISO, { clock: "12h", date: "ddmm" });
  assert.ok(out.startsWith("19.06 "), `expected DD.MM prefix, got "${out}"`);
});

test("date Off returns the time only", () => {
  const out = formatTimestamp(ISO, { clock: "12h", date: "off" });
  assert.match(out, /1:31/);
  assert.ok(!out.includes("06.19") && !out.includes("19.06"));
});

test("unparseable input renders nothing", () => {
  assert.equal(formatTimestamp("not-a-date"), "");
  assert.equal(formatTimestamp(""), "");
});

test("formatClock honors the clock pref, time only (app-wide entry point)", () => {
  const twelve = formatClock(ISO, { clock: "12h", date: "mmdd" });
  assert.match(twelve, /1:31/);
  assert.match(twelve, /[AP]M/i);
  assert.ok(!twelve.includes("06.19"), "formatClock never emits a date even if the date pref is set");

  const twentyFour = formatClock(ISO, { clock: "24h", date: "mmdd" });
  assert.match(twentyFour, /13:31/);
  assert.doesNotMatch(twentyFour, /[AP]M/i);
});

test("formatClock can include seconds (debug log)", () => {
  assert.match(formatClock(ISO, { clock: "24h", date: "off" }, { seconds: true }), /13:31:00/);
  assert.doesNotMatch(formatClock(ISO, { clock: "24h", date: "off" }), /:00\b/);
});

test("formatClock renders nothing for bad input", () => {
  assert.equal(formatClock("not-a-date", { clock: "24h", date: "off" }), "");
});
