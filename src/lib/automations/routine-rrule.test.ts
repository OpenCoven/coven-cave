import assert from "node:assert/strict";
import test from "node:test";
import { covenRoutineRrule, sameRoutineRrule } from "./routine-rrule.ts";

test("BYMINUTE=0 is dropped: it names the same instant Coven runs on the hour", () => {
  assert.deepEqual(covenRoutineRrule("RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0"), { ok: true, rrule: "FREQ=DAILY;BYHOUR=9" });
  assert.deepEqual(covenRoutineRrule("RRULE:FREQ=WEEKLY;BYHOUR=8;BYMINUTE=00;BYDAY=MO,FR"), { ok: true, rrule: "FREQ=WEEKLY;BYHOUR=8;BYDAY=MO,FR" });
  assert.deepEqual(covenRoutineRrule("FREQ=DAILY;BYHOUR=9"), { ok: true, rrule: "FREQ=DAILY;BYHOUR=9" });
});

test("any other minute is refused with a reason a person can act on", () => {
  assert.deepEqual(covenRoutineRrule("RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=30"), {
    ok: false, error: "Coven runs routines on the hour. Pick a time on the hour (:00).",
  });
  assert.equal(covenRoutineRrule("RRULE:FREQ=DAILY;BYHOUR=9;byminute=15").ok, false);
  assert.equal(covenRoutineRrule("RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=").ok, false);
});

test("a stored rule and the form's rebuild of it compare equal", () => {
  assert.equal(sameRoutineRrule("RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0", "RRULE:FREQ=DAILY;BYHOUR=9"), true);
  assert.equal(sameRoutineRrule("RRULE:FREQ=DAILY;BYHOUR=10;BYMINUTE=0", "RRULE:FREQ=DAILY;BYHOUR=9"), false);
  assert.equal(sameRoutineRrule("RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=30", "RRULE:FREQ=DAILY;BYHOUR=9"), false);
});
