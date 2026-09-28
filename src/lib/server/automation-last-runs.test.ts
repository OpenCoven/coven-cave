// @ts-nocheck
// #5687: one request answers every Schedules row's last-run badge.
import assert from "node:assert/strict";
import test from "node:test";
import { CovenAutomationsUnavailableError } from "../coven-automations-types.ts";
import { MAX_LAST_RUN_IDS, parseLastRunIds, readLastRuns } from "./automation-last-runs.ts";

const run = (automationId, id) => ({
  id,
  automationId,
  runtime: "coven-code",
  status: "succeeded",
  exitCode: 0,
  logJson: "{\"summary\":\"ok\"}",
  startedAt: "2026-09-28T09:00:00Z",
  finishedAt: "2026-09-28T09:01:00Z",
});

test("ids are de-duplicated, trimmed and bounded", () => {
  assert.deepEqual(parseLastRunIds(new URLSearchParams("id=a&id=%20b%20&id=a&id=")), { ok: true, ids: ["a", "b"] });
  const many = new URLSearchParams(Array.from({ length: MAX_LAST_RUN_IDS + 1 }, (_, i) => ["id", `a${i}`]));
  assert.deepEqual(parseLastRunIds(many), { ok: false, error: `expected at most ${MAX_LAST_RUN_IDS} automation ids` });
  const long = parseLastRunIds(new URLSearchParams({ id: "x".repeat(201) }));
  assert.equal(long.ok, false);
  assert.match(long.error, /at most 200 characters/);
});

test("control characters are rejected before trimming could hide them", () => {
  for (const query of ["id=a%0Ab", "id=a%0A", "id=%09a", "id=a%7F"]) {
    const parsed = parseLastRunIds(new URLSearchParams(query));
    assert.equal(parsed.ok, false, query);
    assert.match(parsed.error, /control characters/, query);
  }
});

test("each automation gets its newest run, asked for with limit 1", async () => {
  const asked = [];
  const result = await readLastRuns(["a", "b"], async (id, limit) => {
    asked.push([id, limit]);
    return id === "a" ? [run("a", "r2"), run("a", "r1")] : [];
  });
  assert.deepEqual(asked, [["a", 1], ["b", 1]]);
  assert.equal(result.ok, true);
  assert.equal(result.runs.a.id, "r2");
  assert.equal(result.runs.a.automationName, "a");
  assert.equal(result.runs.a.summary, "{\"summary\":\"ok\"}");
  assert.equal(result.runs.b, null, "an automation that never ran has no badge");
});

test("one failing automation only loses its own badge", async () => {
  const result = await readLastRuns(["a", "b"], async (id) => {
    if (id === "b") throw new CovenAutomationsUnavailableError("unknown routine", false);
    return [run("a", "r1")];
  });
  assert.equal(result.ok, true);
  assert.equal(result.runs.a.id, "r1");
  assert.equal(result.runs.b, null);
});

test("an offline daemon is reported as degraded", async () => {
  const result = await readLastRuns(["a", "b"], async () => {
    throw new CovenAutomationsUnavailableError("daemon unreachable", true);
  });
  assert.deepEqual(result, { ok: false, degraded: true, error: "daemon unreachable" });
});

test("an automation named __proto__ is a key, not a prototype", async () => {
  const result = await readLastRuns(["__proto__"], async () => [run("__proto__", "r1")]);
  assert.equal(result.ok, true);
  assert.equal(Object.keys(result.runs).includes("__proto__"), true);
  assert.equal(JSON.parse(JSON.stringify(result)).runs.__proto__.id, "r1");
});
