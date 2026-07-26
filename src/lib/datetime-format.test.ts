import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_CLOCK,
  DEFAULT_DATE,
  formatClock,
  formatChatRecency,
  formatDate,
  formatTimestamp,
  normalizeClock,
  normalizeDate,
  normalizeDensity,
  setDensityFormat,
  readDateTimePrefs,
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

test("formatChatRecency renders today/yesterday wording with exact clock", () => {
  const prefs = { clock: "24h", date: "mmdd" } as const;
  const now = new Date("2026-06-30T17:00:00").getTime();
  assert.equal(formatChatRecency("2026-06-30T11:58:00", prefs, now), "Today at 11:58");
  assert.equal(formatChatRecency("2026-06-29T11:58:00", prefs, now), "Yesterday at 11:58");
  assert.match(formatChatRecency("2026-06-28T11:58:00", prefs, now), /^[A-Za-z]+ at 11:58$/);
  assert.equal(formatChatRecency("not-a-date", prefs, now), "");
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

test("formatDate honors the date ORDERING for verbose dates (keeps month name)", () => {
  const mmdd = { clock: "12h", date: "mmdd" } as const;
  const ddmm = { clock: "12h", date: "ddmm" } as const;
  // month-first vs day-first, short month, no year
  assert.equal(formatDate(ISO, mmdd), "Jun 19");
  assert.equal(formatDate(ISO, ddmm), "19 Jun");
  // with year: US "Jun 19, 2026" vs EU "19 Jun 2026"
  assert.equal(formatDate(ISO, mmdd, { year: true }), "Jun 19, 2026");
  assert.equal(formatDate(ISO, ddmm, { year: true }), "19 Jun 2026");
  // the chat-only "off" behaves as month-first for verbose dates (still shows one)
  assert.equal(formatDate(ISO, { clock: "12h", date: "off" }), "Jun 19");
});

test("formatDate supports weekday + long month, and accepts a Date", () => {
  const out = formatDate(new Date(ISO), { clock: "12h", date: "mmdd" }, { weekday: true, month: "long" });
  assert.match(out, /^[A-Za-z]+, June 19$/, `expected "Weekday, June 19", got "${out}"`);
});

test("formatDate renders nothing for bad input", () => {
  assert.equal(formatDate("not-a-date", { clock: "12h", date: "mmdd" }), "");
});

test("density preference normalizes and round-trips through the store", () => {
  assert.equal(normalizeDensity("verbose"), "verbose");
  assert.equal(normalizeDensity("bogus"), "compact");
  setDensityFormat("verbose");
  assert.equal(readDateTimePrefs().density, "verbose");
  setDensityFormat("compact");
  assert.equal(readDateTimePrefs().density, "compact");
});
