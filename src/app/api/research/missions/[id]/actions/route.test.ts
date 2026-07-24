import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { allowedResearchActions } from "../../../../../../lib/research-missions.ts";
import type { ResearchMissionStatus } from "../../../../../../lib/research-missions.ts";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("mission actions are local-only, bounded, path guarded, and serialized by the runner", () => {
  assert.match(source, /rejectNonLocalRequest\(req\)/);
  assert.match(source, /readJsonBody<ResearchMissionActionInput>\(req, MAX_SESSION_JSON_BYTES\)/);
  assert.match(source, /isValidResearchMissionId/);
  assert.match(source, /path not allowed/);
  assert.match(source, /status: 403/);
  assert.match(source, /runner\.act/);
});

test("accepted lifecycle actions derive from the domain — no contract drift", () => {
  // The route flatMaps allowedResearchActions over every mission status
  // instead of hand-copying a list, so it can only accept what the runner
  // will actually perform.
  assert.match(source, /allowedResearchActions\(\{ status \}\)/);
  assert.match(source, /MISSION_STATUSES\.flatMap/);
  assert.match(source, /"attach-source", "update-source", "reject-artifact"/);
  // "pause" is in the ResearchMissionAction union but no status ever allows
  // it (allowedResearchActions never returns it) — the old hand-copied list
  // accepted it and produced a silent no-op 200. It must not reappear.
  const statuses: ResearchMissionStatus[] = [
    "queued", "planning", "running", "checkpoint", "paused",
    "completed", "failed", "cancelled", "archived",
  ];
  const domainActions = new Set(statuses.flatMap((status) => allowedResearchActions({ status })));
  assert.ok(!domainActions.has("pause"), "domain now allows pause — revisit the route derivation");
  assert.doesNotMatch(source, /"pause"/);
  // The route's status list stays in lockstep with the domain union: every
  // status above appears verbatim in the derivation source.
  for (const status of statuses) {
    assert.match(source, new RegExp(`"${status}"`));
  }
});

test("errors map by kind: unknown action 400, client mistakes 400, missing mission 404, internal failures 500", () => {
  // Unvalidated / unknown actions are rejected before the runner runs.
  assert.match(source, /invalid research action/);
  assert.match(source, /\{ status: 400 \}/);
  // Thrown runner errors are classified: known client-input messages → 400,
  // mission-not-found → 404, and EVERYTHING else (fs errors, bugs) → 500 —
  // internal failures must not masquerade as client errors.
  assert.match(source, /research mission not found"\) return 404/);
  assert.match(source, /VALIDATION_ERRORS\.has\(message\)/);
  assert.match(source, /startsWith\('Project root "'\)/);
  assert.match(source, /startsWith\("invalid source"\)/);
  assert.match(source, /return 400;/);
  assert.match(source, /return 500;/);
  assert.match(source, /status: actionErrorStatus\(message\)/);
  // Manual runs vs an ACTIVE linked automation is a state conflict (409),
  // resolved by pausing the schedule — not a client error (cave-7had).
  assert.match(
    source,
    /if \(message === "pause the linked automation before running manually"\) return 409;/,
  );
  // The classified messages are the runner's real validation throws.
  for (const known of [
    "Source id and title are required",
    "artifact rejection reason required",
    "research artifact not found",
    "refined direction required",
    "invalid project root override",
  ]) {
    assert.match(source, new RegExp(known));
  }
});

test("publish-artifact is routable with its validation and conflict mappings", () => {
  assert.match(source, /"publish-artifact"/);
  assert.match(source, /"research mission is not settled yet"/);
  assert.match(source, /"rejected artifacts need a new working version before publishing"/);
  assert.match(source, /"research artifact file missing"/);
  assert.match(source, /"Research artifact is too large"/);
  assert.match(source, /research artifact already published/);
});
