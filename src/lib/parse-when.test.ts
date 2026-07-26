// @ts-nocheck
import assert from "node:assert/strict";
import { parseWhen, splitWhenAndText } from "./parse-when.ts";

// Fixed clock: Tuesday 2026-07-14 10:00 local. Every expectation below is
// computed in local time (the semantics the user types in).
const NOW = new Date(2026, 6, 14, 10, 0, 0, 0);
assert.equal(NOW.getDay(), 2, "fixture sanity: Jul 14 2026 is a Tuesday");

const iso = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi, 0, 0).toISOString();

function fireAt(input) {
  const p = parseWhen(input, NOW);
  assert.ok(p, `should parse: "${input}"`);
  return p;
}

// ── Offsets ("in …") ─────────────────────────────────────────────────────────
{
  assert.equal(fireAt("in 30m").fireAt, new Date(NOW.getTime() + 30 * 60_000).toISOString());
  assert.equal(fireAt("in 2h").fireAt, new Date(NOW.getTime() + 2 * 3_600_000).toISOString());
  assert.equal(fireAt("in 2 hours").fireAt, new Date(NOW.getTime() + 2 * 3_600_000).toISOString());
  assert.equal(fireAt("in 90 minutes").fireAt, new Date(NOW.getTime() + 90 * 60_000).toISOString());
  assert.equal(fireAt("in an hour").fireAt, new Date(NOW.getTime() + 3_600_000).toISOString());
  assert.equal(fireAt("in a minute").fireAt, new Date(NOW.getTime() + 60_000).toISOString());
  assert.equal(fireAt("in half an hour").fireAt, new Date(NOW.getTime() + 30 * 60_000).toISOString());
  assert.equal(fireAt("in 1h30m").fireAt, new Date(NOW.getTime() + 90 * 60_000).toISOString());
  assert.equal(fireAt("in 1 week").fireAt, new Date(NOW.getTime() + 7 * 86_400_000).toISOString());
  assert.equal(fireAt("in 30m").recurrence.type, "none");
  assert.equal(parseWhen("in 0m", NOW), null, "zero offset fails closed");
}

// ── Same/next day ────────────────────────────────────────────────────────────
{
  assert.equal(fireAt("today 5pm").fireAt, iso(2026, 6, 14, 17, 0));
  assert.equal(fireAt("today at 17:30").fireAt, iso(2026, 6, 14, 17, 30));
  assert.equal(parseWhen("today 9am", NOW), null, "past time today fails closed");
  assert.equal(fireAt("tonight").fireAt, iso(2026, 6, 14, 20, 0));
  assert.equal(fireAt("tomorrow 9am").fireAt, iso(2026, 6, 15, 9, 0));
  assert.equal(fireAt("tomorrow at 9am").fireAt, iso(2026, 6, 15, 9, 0));
  assert.equal(fireAt("tomorrow noon").fireAt, iso(2026, 6, 15, 12, 0));
  assert.equal(fireAt("at 9am").fireAt, iso(2026, 6, 15, 9, 0), "past 'at' rolls to tomorrow");
  assert.equal(fireAt("at 5pm").fireAt, iso(2026, 6, 14, 17, 0));
  assert.equal(fireAt("at midnight").fireAt, iso(2026, 6, 15, 0, 0));
}

// ── Weekdays (one-shot) ──────────────────────────────────────────────────────
{
  assert.equal(fireAt("friday 4pm").fireAt, iso(2026, 6, 17, 16, 0));
  assert.equal(fireAt("wednesday 9am").fireAt, iso(2026, 6, 15, 9, 0), "full day names parse");
  assert.equal(fireAt("saturday 10am").fireAt, iso(2026, 6, 18, 10, 0));
  assert.equal(fireAt("next wednesday at 4pm").fireAt, iso(2026, 6, 15, 16, 0));
  assert.equal(fireAt("thurs 17:30").fireAt, iso(2026, 6, 16, 17, 30));
  assert.equal(fireAt("tuesday 9am").fireAt, iso(2026, 6, 21, 9, 0), "past today's time → next week");
  assert.equal(fireAt("friday 4pm").recurrence.type, "none", "bare day is one-shot, not weekly");
}

// ── Calendar dates ───────────────────────────────────────────────────────────
{
  assert.equal(fireAt("jul 20 9am").fireAt, iso(2026, 6, 20, 9, 0));
  assert.equal(fireAt("july 20th at 5pm").fireAt, iso(2026, 6, 20, 17, 0));
  assert.equal(fireAt("on jul 20").fireAt, iso(2026, 6, 20, 9, 0), "date without time defaults 9:00");
  assert.equal(fireAt("7/20 17:00").fireAt, iso(2026, 6, 20, 17, 0));
  assert.equal(fireAt("jan 5").fireAt, iso(2027, 0, 5, 9, 0), "past date rolls to next year");
  assert.equal(parseWhen("feb 30", NOW), null, "impossible dates fail closed");
}

// ── Recurrences ──────────────────────────────────────────────────────────────
{
  const int = fireAt("every 30m");
  assert.deepEqual(int.recurrence, { type: "interval", everyMs: 30 * 60_000 });
  assert.deepEqual(fireAt("every 2 hours").recurrence, { type: "interval", everyMs: 2 * 3_600_000 });
  assert.deepEqual(fireAt("every hour").recurrence, { type: "interval", everyMs: 3_600_000 });

  const daily = fireAt("every day 9am");
  assert.deepEqual(daily.recurrence, { type: "daily", hour: 9, minute: 0 });
  assert.equal(daily.fireAt, iso(2026, 6, 15, 9, 0), "fireAt = next occurrence");
  assert.deepEqual(fireAt("daily at noon").recurrence, { type: "daily", hour: 12, minute: 0 });

  assert.deepEqual(fireAt("every weekday 9am").recurrence, { type: "weekly", days: [1, 2, 3, 4, 5], hour: 9, minute: 0 });
  assert.deepEqual(fireAt("weekdays at 9am").recurrence, { type: "weekly", days: [1, 2, 3, 4, 5], hour: 9, minute: 0 });
  assert.deepEqual(fireAt("every weekend 10am").recurrence, { type: "weekly", days: [0, 6], hour: 10, minute: 0 });

  assert.deepEqual(fireAt("every tuesday 4pm").recurrence, { type: "weekly", days: [2], hour: 16, minute: 0 });
  assert.deepEqual(fireAt("mon,wed,fri 8:30").recurrence, { type: "weekly", days: [1, 3, 5], hour: 8, minute: 30 });
  assert.deepEqual(fireAt("every mon and wed at 8am").recurrence, { type: "weekly", days: [1, 3], hour: 8, minute: 0 });
  assert.deepEqual(fireAt("every tue, thu 9:15").recurrence, { type: "weekly", days: [2, 4], hour: 9, minute: 15 });
}

// ── Time-first reorder ───────────────────────────────────────────────────────
{
  assert.deepEqual(fireAt("9am every weekday").recurrence, { type: "weekly", days: [1, 2, 3, 4, 5], hour: 9, minute: 0 });
  assert.deepEqual(fireAt("noon every day").recurrence, { type: "daily", hour: 12, minute: 0 });
}

// ── Fail-closed ──────────────────────────────────────────────────────────────
{
  assert.equal(parseWhen("", NOW), null);
  assert.equal(parseWhen("whenever", NOW), null);
  assert.equal(parseWhen("today 25:00", NOW), null, "invalid hour");
  assert.equal(parseWhen("today 9:75", NOW), null, "invalid minute");
  assert.equal(parseWhen("every blursday 9am", NOW), null);
  assert.equal(parseWhen("13pm", NOW), null);
}

// ── splitWhenAndText ─────────────────────────────────────────────────────────
{
  const s1 = splitWhenAndText("in 30m check the build", NOW);
  assert.equal(s1.text, "check the build");
  assert.ok(s1.when);

  const s2 = splitWhenAndText("tomorrow at 9am review PRs", NOW);
  assert.equal(s2.text, "review PRs");
  assert.equal(s2.when?.fireAt, iso(2026, 6, 15, 9, 0));

  const s3 = splitWhenAndText("every mon and wed at 8am standup notes", NOW);
  assert.equal(s3.text, "standup notes");
  assert.deepEqual(s3.when?.recurrence, { type: "weekly", days: [1, 3], hour: 8, minute: 0 });

  const s4 = splitWhenAndText("review the queue", NOW);
  assert.equal(s4.when, null);
  assert.equal(s4.text, "review the queue");
}

console.log("parse-when.test.ts: ok");
