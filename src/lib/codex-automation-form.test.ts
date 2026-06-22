import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseCodexRrule,
  buildCodexRrule,
  splitAutomationPrompt,
  composeAutomationPrompt,
  slugifyAutomationId,
} from "./codex-automation-form.ts";

test("rrule daily round-trips", () => {
  const p = parseCodexRrule("RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=30");
  assert.equal(p.mode, "daily");
  assert.equal(p.time, "09:30");
  assert.equal(buildCodexRrule("daily", "09:30", [], ""), "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=30");
});

test("rrule weekly round-trips with days", () => {
  const p = parseCodexRrule("RRULE:FREQ=WEEKLY;BYHOUR=8;BYMINUTE=0;BYDAY=MO,WE,FR");
  assert.equal(p.mode, "weekly");
  assert.deepEqual(p.days, ["MO", "WE", "FR"]);
  assert.match(buildCodexRrule("weekly", "08:00", ["MO", "WE", "FR"], ""), /FREQ=WEEKLY;.*BYDAY=MO,WE,FR/);
});

test("prompt split/compose round-trips structured sections", () => {
  const composed = composeAutomationPrompt("Audit the repo", "A markdown report", true);
  const s = splitAutomationPrompt(composed);
  assert.match(s.goals, /Audit the repo/);
  assert.match(s.deliverables, /markdown report/);
});

test("slugifyAutomationId kebabs + falls back", () => {
  assert.equal(slugifyAutomationId("Nightly Release Review!"), "nightly-release-review");
  assert.equal(slugifyAutomationId("   "), "automation");
});
