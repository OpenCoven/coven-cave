import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSessionPulse, pulseDelta, pulseTotal } from "./session-pulse.ts";
import type { SessionRow } from "./types.ts";

const NOW = Date.parse("2026-07-06T12:00:00.000Z");

function session(updatedAt: string, familiarId = "cody"): SessionRow {
  return {
    id: `session-${updatedAt}-${familiarId}`,
    project_root: "/tmp/cave",
    harness: "codex",
    title: "Session",
    status: "complete",
    exit_code: 0,
    archived_at: null,
    created_at: updatedAt,
    updated_at: updatedAt,
    familiarId,
  } as SessionRow;
}

describe("buildSessionPulse", () => {
  it("buckets sessions into UTC days, oldest first, today last", () => {
    const pulse = buildSessionPulse(
      [
        session("2026-07-06T09:00:00.000Z"),
        session("2026-07-06T10:00:00.000Z"),
        session("2026-07-01T10:00:00.000Z"),
      ],
      "cody",
      NOW,
    );
    assert.equal(pulse.length, 14);
    assert.equal(pulse[13].key, "2026-07-06");
    assert.equal(pulse[13].count, 2);
    assert.equal(pulse.find((day) => day.key === "2026-07-01")?.count, 1);
    assert.equal(pulse[0].key, "2026-06-23");
  });

  it("ignores other familiars and unparsable timestamps", () => {
    const pulse = buildSessionPulse(
      [session("2026-07-06T09:00:00.000Z", "other"), session("not-a-date")],
      "cody",
      NOW,
    );
    assert.equal(pulseTotal(pulse), 0);
  });

  it("drops sessions outside the window", () => {
    const pulse = buildSessionPulse([session("2026-06-01T09:00:00.000Z")], "cody", NOW);
    assert.equal(pulseTotal(pulse), 0);
  });
});

describe("pulseDelta", () => {
  it("compares the newest half against the prior half", () => {
    const pulse = buildSessionPulse(
      [
        // prior week: 1 session
        session("2026-06-25T09:00:00.000Z"),
        // current week: 3 sessions
        session("2026-07-04T09:00:00.000Z"),
        session("2026-07-05T09:00:00.000Z"),
        session("2026-07-06T09:00:00.000Z"),
      ],
      "cody",
      NOW,
    );
    const delta = pulseDelta(pulse);
    assert.equal(delta.previous, 1);
    assert.equal(delta.current, 3);
    assert.equal(delta.delta, 2);
  });
});
