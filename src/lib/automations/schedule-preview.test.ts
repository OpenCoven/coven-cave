import assert from "node:assert/strict";
import test from "node:test";
import { canonicalPreviewZone, formatUtcOffset, previewSchedule } from "./schedule-preview.ts";

// Every case passes its own instant: the preview never reads the wall clock.
const october = Date.parse("2026-10-18T05:00:00.000Z");

test("a daily rule runs at the same wall time in the routine's zone, not the viewer's", () => {
  const preview = previewSchedule("FREQ=DAILY;BYHOUR=9", "America/Chicago", october);
  assert.equal(preview.kind, "parsed");
  if (preview.kind !== "parsed") return;
  assert.equal(preview.zone, "America/Chicago");
  assert.deepEqual(preview.occurrences.map((occurrence) => occurrence.at), [
    "2026-10-18T14:00:00.000Z", "2026-10-19T14:00:00.000Z", "2026-10-20T14:00:00.000Z",
    "2026-10-21T14:00:00.000Z", "2026-10-22T14:00:00.000Z",
  ]);
  assert.ok(preview.occurrences.every((occurrence) => occurrence.offsetMinutes === -300 && !occurrence.repeated));
});

test("the next clock change is reported even when it falls after the listed runs", () => {
  const preview = previewSchedule("FREQ=DAILY;BYHOUR=9", "America/Chicago", october);
  assert.deepEqual(preview.kind === "parsed" && preview.warnings, [
    { kind: "offset-change", at: "2026-11-01T15:00:00.000Z", fromOffsetMinutes: -300, toOffsetMinutes: -360 },
  ]);
});

test("a run in the repeated hour is flagged, and the earlier instant is the one listed", () => {
  const preview = previewSchedule("FREQ=WEEKLY;BYHOUR=1;BYDAY=SU", "America/Chicago", Date.parse("2026-10-26T00:00:00.000Z"));
  assert.equal(preview.kind, "parsed");
  if (preview.kind !== "parsed") return;
  assert.deepEqual(preview.occurrences[0], { at: "2026-11-01T06:00:00.000Z", offsetMinutes: -300, repeated: true });
  assert.deepEqual(preview.warnings[0], { kind: "repeated", date: "2026-11-01", at: "2026-11-01T06:00:00.000Z" });
});

test("a run in the skipped hour is not invented; it is a warning for Coven to resolve", () => {
  const preview = previewSchedule("FREQ=WEEKLY;BYHOUR=2;BYDAY=SU", "America/Chicago", Date.parse("2027-03-01T00:00:00.000Z"));
  assert.equal(preview.kind, "parsed");
  if (preview.kind !== "parsed") return;
  assert.ok(!preview.occurrences.some((occurrence) => occurrence.at.startsWith("2027-03-14")));
  assert.deepEqual(preview.occurrences.slice(0, 2).map((occurrence) => occurrence.at), ["2027-03-07T08:00:00.000Z", "2027-03-21T07:00:00.000Z"]);
  assert.deepEqual(preview.warnings[0], { kind: "nonexistent", date: "2027-03-14" });
});

test("UTC, Coven's `utc` spelling and weekly day sets", () => {
  const utc = previewSchedule("RRULE:FREQ=WEEKLY;BYHOUR=3;BYDAY=MO,FR", "utc", october, { count: 3 });
  assert.equal(utc.kind, "parsed");
  if (utc.kind !== "parsed") return;
  assert.equal(utc.zone, "UTC");
  assert.deepEqual(utc.occurrences.map((occurrence) => occurrence.at), [
    "2026-10-19T03:00:00.000Z", "2026-10-23T03:00:00.000Z", "2026-10-26T03:00:00.000Z",
  ]);
  assert.deepEqual(utc.warnings, [], "UTC never changes its clocks");
});

test("a run already past today is skipped", () => {
  const preview = previewSchedule("FREQ=DAILY;BYHOUR=9", "UTC", Date.parse("2026-10-18T09:00:00.000Z"), { count: 1 });
  assert.deepEqual(preview.kind === "parsed" && preview.occurrences.map((occurrence) => occurrence.at), ["2026-10-19T09:00:00.000Z"]);
});

test("rules Coven does not run and zones the runtime does not know are reported, not approximated", () => {
  assert.deepEqual(previewSchedule("FREQ=HOURLY", "UTC", october), { kind: "unparsed" });
  assert.deepEqual(previewSchedule("", "UTC", october), { kind: "unparsed" });
  assert.deepEqual(previewSchedule("FREQ=DAILY;BYHOUR=9", "Mars/Olympus_Mons", october), { kind: "invalid-zone", zone: "Mars/Olympus_Mons" });
  assert.equal(canonicalPreviewZone("utc"), "UTC");
  assert.equal(canonicalPreviewZone("Europe/London"), "Europe/London");
});

test("offsets read the way people write them", () => {
  assert.equal(formatUtcOffset(0), "UTC");
  assert.equal(formatUtcOffset(-300), "UTC−5");
  assert.equal(formatUtcOffset(330), "UTC+5:30");
});
