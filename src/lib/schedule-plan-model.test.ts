import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planCtaSuffix, planFromPhrase, planFromRrule, SCHEDULE_PLAN_RUN_COUNT } from "./schedule-plan-model.ts";

// A fixed frame of reference: "tomorrow at 9am" has to mean something exact.
const NOW = new Date("2026-08-25T10:00:00Z");

describe("planFromPhrase", () => {
  it("says nothing when nothing has been typed", () => {
    assert.equal(planFromPhrase("", NOW).kind, "empty");
    assert.equal(planFromPhrase("   ", NOW).kind, "empty");
  });

  it("offers a way forward instead of only refusing", () => {
    const plan = planFromPhrase("sometime-ish maybe", NOW);
    assert.equal(plan.kind, "unparsed");
    // The spec's placeholder-grammar rule: examples, not instructions. A bare
    // "invalid" leaves the user with nowhere to go.
    if (plan.kind === "unparsed") assert.match(plan.hint, /weekdays at 9am/);
  });

  it("turns a recurring phrase into a cadence sentence plus concrete fires", () => {
    const plan = planFromPhrase("weekdays at 9am", NOW, { hour12: false });
    assert.equal(plan.kind, "parsed");
    if (plan.kind !== "parsed") return;
    assert.match(plan.sentence, /weekdays at 09:00/);
    assert.equal(plan.nextRuns.length, SCHEDULE_PLAN_RUN_COUNT);
    // Every fire is a real timestamp, strictly ordered — the whole point is
    // that the user can check them.
    const times = plan.nextRuns.map((iso) => new Date(iso).getTime());
    times.forEach((t) => assert.ok(Number.isFinite(t), `${t} is a real instant`));
    assert.deepEqual(times, [...times].sort((a, b) => a - b), "fires run forwards");
  });

  it("describes a one-shot by its single fire rather than a blank cadence", () => {
    const plan = planFromPhrase("tomorrow at 9am", NOW);
    assert.equal(plan.kind, "parsed");
    if (plan.kind !== "parsed") return;
    assert.equal(plan.recurrence.type, "none");
    assert.equal(plan.sentence, "once", "a one-shot still says something");
    assert.deepEqual(plan.nextRuns, [plan.fireAt], "its fire IS its upcoming run");
  });

  it("reads the same phrase the same way every time", () => {
    // Two callers, one meaning: the model adds no parsing of its own, so the
    // cron dialog and the reminder dialog cannot drift apart.
    const a = planFromPhrase("every tuesday 4pm", NOW);
    const b = planFromPhrase("every tuesday 4pm", NOW);
    assert.deepEqual(a, b);
  });
});

describe("planCtaSuffix", () => {
  it("names the outcome once there is one to name", () => {
    assert.equal(planCtaSuffix(planFromPhrase("weekdays at 9am", NOW, { hour12: false })), "weekdays at 09:00");
  });

  it("stays silent rather than inventing a label", () => {
    assert.equal(planCtaSuffix(planFromPhrase("", NOW)), null);
    assert.equal(planCtaSuffix(planFromPhrase("gibberish", NOW)), null);
  });
});

describe("planFromRrule", () => {
  it("translates the builders' output into one plan", () => {
    const daily = planFromRrule("RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0", NOW, { hour12: false });
    assert.equal(daily.kind, "parsed");
    if (daily.kind === "parsed") assert.equal(daily.sentence, "every day at 09:00");

    const weekly = planFromRrule("RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=MO,WE,FR", NOW, { hour12: false });
    assert.equal(weekly.kind, "parsed");
    if (weekly.kind === "parsed") assert.equal(weekly.sentence, "Mon, Wed, Fri at 09:00");
  });

  it("never previews a half-built weekly rule as 'every day'", () => {
    // The builder emits BYDAY= while no day is picked, and parseCodexRrule
    // answers that with all seven — so without a guard the preview claims a
    // cadence the user never chose. Caught by driving the real dialog.
    const plan = planFromRrule("RRULE:FREQ=WEEKLY;BYHOUR=9;BYMINUTE=0;BYDAY=", NOW);
    assert.equal(plan.kind, "unparsed");
    if (plan.kind === "unparsed") assert.match(plan.hint, /pick at least one day/);
  });

  it("says so when a rule cannot be translated, rather than approximating it", () => {
    const plan = planFromRrule("RRULE:FREQ=SECONDLY;COUNT=9", NOW);
    assert.equal(plan.kind, "unparsed");
    if (plan.kind === "unparsed") assert.match(plan.hint, /can't be translated/);
  });

  it("is empty for an empty rule", () => {
    assert.equal(planFromRrule("", NOW).kind, "empty");
  });
});
