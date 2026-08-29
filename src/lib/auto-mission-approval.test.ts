// Behavioral tests for the /auto needs-approval affordance decision: when the
// status card may offer approve/deny, and what those buttons send inline.
import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVE_MISSION_MESSAGE,
  DENY_MISSION_MESSAGE,
  isAutoApprovalPending,
} from "./auto-mission-approval.ts";
import type { AutoMissionRecord, AutoTurnLike } from "./auto-mission-state.ts";

const armed: AutoMissionRecord = {
  mission: "ship the release",
  startedAt: "2026-01-01T00:00:00.000Z",
  notified: [],
};

const needsApproval: AutoTurnLike = {
  id: "t1",
  role: "assistant",
  text: '<coven:auto-status state="needs-approval" note="irreversible: force-push" />',
};

test("a live, settled needs-approval head turn is pending", () => {
  assert.equal(isAutoApprovalPending(armed, [needsApproval], "t1"), true);
});

test("a turn that is not the head is never pending — the human already answered", () => {
  assert.equal(
    isAutoApprovalPending(
      armed,
      [
        needsApproval,
        { id: "t2", role: "user", text: "yes, go ahead" },
      ],
      "t1",
    ),
    false,
  );
});

test("a still-streaming turn is not pending — the marker may not be final", () => {
  assert.equal(
    isAutoApprovalPending(armed, [{ ...needsApproval, pending: true }], "t1"),
    false,
  );
});

test("only needs-approval opens the affordance — blocked stays a wall", () => {
  const wall: AutoTurnLike = {
    id: "t1",
    role: "assistant",
    text: '<coven:auto-status state="blocked" note="no token on disk" />',
  };
  assert.equal(isAutoApprovalPending(armed, [wall], "t1"), false);
});

test("a completed mission never offers approve/deny, even at the head", () => {
  const ended: AutoMissionRecord = {
    ...armed,
    completedAt: "2026-01-01T00:10:00.000Z",
    outcome: "timed-out",
  };
  assert.equal(isAutoApprovalPending(ended, [needsApproval], "t1"), false);
});

test("no record means no affordance", () => {
  assert.equal(isAutoApprovalPending(null, [needsApproval], "t1"), false);
});

test("approve and deny both send a real inline answer, not an empty prompt", () => {
  assert.ok(APPROVE_MISSION_MESSAGE.trim().length > 0);
  assert.ok(DENY_MISSION_MESSAGE.trim().length > 0);
  assert.notEqual(APPROVE_MISSION_MESSAGE, DENY_MISSION_MESSAGE);
});
