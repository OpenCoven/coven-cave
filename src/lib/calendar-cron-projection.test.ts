import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CodexAutomation } from "./codex-automations-types.ts";
import {
  CRON_PROJECTION_CAP,
  groupProjectedRunsByDay,
  projectCronRuns,
  projectionSummary,
} from "./calendar-cron-projection.ts";

function cron(id: string, rrule: string | null, status: CodexAutomation["status"] = "ACTIVE"): CodexAutomation {
  return {
    id,
    name: id,
    kind: "codex",
    status,
    rrule,
    model: null,
    reasoningEffort: null,
    executionEnvironment: null,
    cwds: [],
    tags: [],
    familiars: [],
    prompt: "",
    skillPath: null,
    scheduleHuman: "",
  };
}

// A week-long window in local time, so the day buckets are unambiguous.
const START = new Date(2026, 7, 24, 0, 0, 0).getTime();
const END = new Date(2026, 7, 31, 0, 0, 0).getTime();

const DAILY_9 = "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0";

describe("projectCronRuns", () => {
  it("puts a daily cron on every day of the window", () => {
    const { runs, projectedCount, truncated } = projectCronRuns([cron("a", DAILY_9)], START, END);
    assert.equal(projectedCount, 1);
    assert.equal(truncated, false);
    assert.equal(runs.length, 7, "seven days, seven fires");
    runs.forEach((r) => assert.equal(new Date(r.atIso).getHours(), 9));
  });

  it("never projects a paused cron", () => {
    // A paused cron is not going to fire. Drawing it would put events on the
    // calendar that will never happen.
    const { runs, projectedCount } = projectCronRuns([cron("a", DAILY_9, "PAUSED")], START, END);
    assert.deepEqual(runs, []);
    assert.equal(projectedCount, 0);
  });

  it("skips a cron whose rule cannot be read, rather than approximating it", () => {
    const { runs } = projectCronRuns(
      [cron("exotic", "RRULE:FREQ=SECONDLY;COUNT=9"), cron("none", null)],
      START,
      END,
    );
    assert.deepEqual(runs, [], "an unreadable rule contributes nothing at all");
  });

  it("returns runs in chronological order across several crons", () => {
    const { runs } = projectCronRuns(
      [cron("late", "RRULE:FREQ=DAILY;BYHOUR=17;BYMINUTE=0"), cron("early", DAILY_9)],
      START,
      END,
    );
    const times = runs.map((r) => new Date(r.atIso).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b), "a calendar reads forwards");
  });

  it("caps a pathological schedule and SAYS it truncated", () => {
    // Every 5 minutes over a week is ~2000 fires. The cap matters less than
    // the caller being able to tell the reader the view is partial.
    const { runs, truncated } = projectCronRuns(
      [{ ...cron("chatty", DAILY_9), rrule: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0" }],
      START,
      new Date(2030, 0, 1).getTime(),
    );
    assert.ok(runs.length <= CRON_PROJECTION_CAP, "never exceeds the ceiling");
    assert.equal(truncated, true, "and admits the window was not exhausted");
  });

  it("is empty for an inverted or zero-width window", () => {
    assert.deepEqual(projectCronRuns([cron("a", DAILY_9)], END, START).runs, []);
    assert.deepEqual(projectCronRuns([cron("a", DAILY_9)], START, START).runs, []);
  });
});

describe("groupProjectedRunsByDay", () => {
  it("buckets by local calendar day", () => {
    const { runs } = projectCronRuns([cron("a", DAILY_9)], START, END);
    const byDay = groupProjectedRunsByDay(runs);
    assert.equal(byDay.size, 7);
    for (const [key, bucket] of byDay) {
      assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(bucket.length, 1);
    }
  });
});

describe("projectionSummary", () => {
  it("names how many crons reach this calendar, and agrees with itself", () => {
    const one = projectCronRuns([cron("a", DAILY_9)], START, END);
    assert.equal(projectionSummary(one), "1 active cron projects onto this calendar");

    const many = projectCronRuns(
      [cron("a", DAILY_9), cron("b", "RRULE:FREQ=DAILY;BYHOUR=17;BYMINUTE=0")],
      START,
      END,
    );
    assert.equal(projectionSummary(many), "2 active crons project onto this calendar");
  });

  it("says when the view is partial", () => {
    const projection = projectCronRuns([cron("a", DAILY_9)], START, new Date(2030, 0, 1).getTime());
    assert.match(String(projectionSummary(projection)), /showing the first \d+/);
  });

  it("renders nothing rather than a '0 active crons' line", () => {
    // An absence does not need a sentence drawing attention to it.
    assert.equal(projectionSummary({ runs: [], projectedCount: 0, truncated: false }), null);
  });
});

// Regression, found by driving the real calendar rather than by a unit test:
// the default view is Week, which draws no projected rows, yet the footer
// still read "13 active crons project onto this calendar". A surface that
// announces a projection it is not rendering is the same class of defect as a
// status it cannot know. The chrome is now scoped to the view that draws it —
// see the `effectiveView !== "agenda"` guard in calendar-view.tsx — and this
// asserts the model's half of that contract: no runs means no sentence.
describe("projection chrome contract", () => {
  it("says nothing when there is nothing drawn", () => {
    assert.equal(projectionSummary({ runs: [], projectedCount: 0, truncated: false }), null);
  });
});

describe("window boundaries", () => {
  // calendar-view computes each view's end as an EXCLUSIVE midnight (day +1,
  // week +7, month +42) and subtracts a millisecond before calling this. That
  // subtraction is only correct while the window here stays inclusive of
  // `endMs`, so pin both halves of the contract: if walkWindow is ever changed
  // to exclude the end instant, the -1 in calendar-view silently starts
  // dropping a real 23:59:59.999 occurrence and this test says so.
  const daily = [cron("c1", "FREQ=DAILY;BYHOUR=0;BYMINUTE=0")];
  const dayStart = new Date(2026, 7, 25).getTime();
  const nextMidnight = new Date(2026, 7, 26).getTime();

  it("includes an occurrence landing exactly on endMs", () => {
    const runs = projectCronRuns(daily, dayStart, nextMidnight).runs;
    assert.equal(runs.length, 2, "today's midnight and the next one");
  });

  it("excludes the next midnight when the caller subtracts a millisecond", () => {
    // This is exactly what calendar-view does, and why: without it the footer
    // counts a cron whose only run in range belongs to the next view.
    const runs = projectCronRuns(daily, dayStart, nextMidnight - 1).runs;
    assert.equal(runs.length, 1);
    assert.equal(new Date(runs[0].atIso).getDate(), 25);
  });

  it("still includes an occurrence at the very start of the window", () => {
    const runs = projectCronRuns(daily, dayStart, nextMidnight - 1).runs;
    assert.equal(new Date(runs[0].atIso).getTime(), dayStart);
  });
});
