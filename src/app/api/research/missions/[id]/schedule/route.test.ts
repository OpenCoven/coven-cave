import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseCodexRrule } from "../../../../../../lib/codex-automation-form.ts";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("mission scheduling is local-only, bounded, path guarded, and delegated to the runner", () => {
  assert.match(source, /rejectNonLocalRequest\(req\)/);
  assert.match(source, /readJsonBody<ResearchAutomationScheduleInput>\(req, MAX_SESSION_JSON_BYTES\)/);
  assert.match(source, /isValidResearchMissionId/);
  assert.match(source, /path not allowed/);
  assert.match(source, /runner\.schedule/);
});

test("RRULEs are structurally validated — a prefix check alone let garbage persist", () => {
  // The route reuses the shared codex parser for the daily/weekly shapes and
  // otherwise requires well-formed KEY=VALUE parts with known RRULE keys and
  // a known FREQ; failures are rejected 400 before the runner persists them.
  assert.match(source, /import \{ parseCodexRrule \} from "@\/lib\/codex-automation-form"/);
  assert.match(source, /parseCodexRrule\(rrule\)\.mode !== "raw"/);
  assert.match(source, /startsWith\("RRULE:"\)/);
  assert.match(source, /RRULE_KNOWN_KEYS\.has\(key\)/);
  assert.match(source, /RRULE_FREQUENCIES\.has\(freq\)/);
  assert.match(source, /unrecognized RRULE part/);
  assert.match(source, /RRULE must declare a known FREQ/);
  assert.match(source, /rruleValidationError\(parsed\.body\.rrule\)/);
  assert.match(source, /\{ status: 400 \}/);
  // Length bound matches the runner's own stored-schedule guard.
  assert.match(source, /RRULE_MAX_LENGTH = 500/);
  // Cross-module contract: the desk's only schedule producer
  // (research-mission-detail's daily rule) parses as a recognized shape, so
  // the validator's parser fast-path accepts the product's real traffic.
  assert.equal(parseCodexRrule("RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0").mode, "daily");
  // And plain garbage falls to the raw path where the structural checks live.
  assert.equal(parseCodexRrule("RRULE:garbage").mode, "raw");
});

test("errors map by kind: bad schedule 400, missing mission 404, internal failures 500", () => {
  // Thrown runner errors are classified: known precondition/bound messages →
  // 400, mission-not-found → 404, and EVERYTHING else (fs errors, bugs) →
  // 500 — internal failures must not masquerade as client errors.
  assert.match(source, /research mission not found"\) return 404/);
  assert.match(source, /VALIDATION_ERRORS\.has\(message\) \|\| message\.startsWith\("cannot schedule a "\)/);
  assert.match(source, /return 500;/);
  assert.match(source, /status: scheduleErrorStatus\(message\)/);
  // The classified messages are the runner's real validation throws, plus
  // research-mission-lifecycle's stop reasons.
  for (const known of [
    "schedules require AutoResearch mode",
    "research mission already has a schedule",
    "invalid automation schedule",
    "Iteration limit reached",
    "Wall-clock limit reached",
    "Reported spend limit reached",
  ]) {
    assert.match(source, new RegExp(known));
  }
});
