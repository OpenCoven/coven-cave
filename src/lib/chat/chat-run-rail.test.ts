// @ts-nocheck
import assert from "node:assert/strict";
import { runRailModel, runRailCommand, runRailDuration, runRailTicks } from "./chat-run-rail.ts";

const NOW = Date.parse("2026-08-09T12:00:00.000Z");

const turn = (id, tools) => ({
  id,
  role: "assistant",
  text: "",
  createdAt: "2026-08-09T11:00:00.000Z",
  tools,
});

// ── counts ──────────────────────────────────────────────────────────────────
{
  const model = runRailModel(
    [
      turn("t1", [
        { id: "a", name: "read_file", status: "ok", durationMs: 100 },
        { id: "b", name: "bash", status: "ok", durationMs: 300 },
      ]),
      turn("t2", [
        { id: "c", name: "str_replace", status: "error", durationMs: 100 },
        { id: "d", name: "grep", status: "running", durationMs: 0 },
      ]),
    ],
    { nowMs: NOW },
  );
  assert.equal(model.calls, 4, "every tool call across every turn is counted");
  assert.equal(model.done, 2, "ok calls are done");
  assert.equal(model.failed, 1, "error calls are failed");
  assert.equal(model.running, 1, "running calls are in flight");
  assert.equal(model.totalMs, 500, "total tool time sums durations");
}

// ── timeline proportions ────────────────────────────────────────────────────
{
  const model = runRailModel(
    [turn("t", [
      { id: "a", name: "bash", status: "ok", durationMs: 750 },
      { id: "b", name: "read_file", status: "ok", durationMs: 250 },
    ])],
    { nowMs: NOW },
  );
  assert.equal(model.segments.length, 2);
  assert.ok(Math.abs(model.segments[0].ratio - 0.75) < 1e-9, "a segment's width is its share of run time");
  assert.ok(Math.abs(model.segments[1].ratio - 0.25) < 1e-9);
  assert.equal(model.segments[0].category, "shell", "bash classifies as shell");
  assert.equal(model.segments[1].category, "read", "read_file classifies as read");
}
{
  // A zero-duration call must still be visible: dropping it would under-report
  // the run, and a 0-width segment is the same as not drawing it.
  const model = runRailModel(
    [turn("t", [
      { id: "a", name: "bash", status: "ok", durationMs: 1000 },
      { id: "b", name: "read_file", status: "ok", durationMs: 0 },
    ])],
    { nowMs: NOW },
  );
  assert.ok(model.segments[1].ratio > 0, "a zero-duration call still gets a visible share");
}
{
  // Every duration missing: fall back to equal shares rather than dividing by
  // zero and rendering NaN widths.
  const model = runRailModel(
    [turn("t", [
      { id: "a", name: "bash", status: "ok" },
      { id: "b", name: "bash", status: "ok" },
    ])],
    { nowMs: NOW },
  );
  assert.equal(model.totalMs, 0);
  for (const s of model.segments) assert.ok(Number.isFinite(s.ratio) && s.ratio > 0, "no NaN widths when nothing reported a duration");
}

// ── tool mix ────────────────────────────────────────────────────────────────
{
  const model = runRailModel(
    [turn("t", [
      { id: "a", name: "read_file", status: "ok", durationMs: 1 },
      { id: "b", name: "read_file", status: "ok", durationMs: 1 },
      { id: "c", name: "bash", status: "ok", durationMs: 1 },
    ])],
    { nowMs: NOW },
  );
  assert.deepEqual(
    model.mix.map((m) => [m.category, m.count]),
    [["read", 2], ["shell", 1]],
    "mix counts by category, in the shared legend order",
  );
  assert.ok(Math.abs(model.mix[0].ratio - 2 / 3) < 1e-9, "mix ratios are shares of total calls");
  assert.ok(
    model.mix.every((m) => m.count > 0),
    "categories that never occurred are absent — an empty legend row is noise",
  );
}

// ── doing now / stopped at / last step ──────────────────────────────────────
{
  const live = runRailModel(
    [turn("t", [
      { id: "a", name: "bash", status: "ok", durationMs: 10 },
      { id: "b", name: "bash", status: "running", input: '{"command":"git status --short"}', durationMs: 3400 },
    ])],
    { nowMs: NOW },
  );
  assert.equal(live.now.heading, "Doing now", "a running call reads as live");
  assert.equal(live.now.command, "git status --short", "the command is pulled out of the tool input");

  const stopped = runRailModel(
    [turn("t", [{ id: "a", name: "bash", status: "error", input: '{"command":"git worktree prune"}' }])],
    { nowMs: NOW },
  );
  assert.equal(stopped.now.heading, "Stopped at", "a failed last call reads as a stop");

  const finished = runRailModel(
    [turn("t", [{ id: "a", name: "read_file", status: "ok", input: '{"path":"src/app.ts"}' }])],
    { nowMs: NOW },
  );
  assert.equal(finished.now.heading, "Last step", "a clean finish is neither live nor stopped");
  assert.equal(finished.now.command, "src/app.ts", "a read call falls back to its path");

  assert.equal(runRailModel([], { nowMs: NOW }).now, null, "no calls means no now-panel at all");
}

// ── command extraction ──────────────────────────────────────────────────────
assert.equal(runRailCommand(undefined), null);
assert.equal(runRailCommand("   "), null);
assert.equal(runRailCommand("ls -la"), "ls -la", "a bare string input is the command");
assert.equal(runRailCommand('{"command":"echo hi"}'), "echo hi");
assert.equal(runRailCommand('{"pattern":"TODO"}'), "TODO", "a search call shows its pattern");
assert.equal(
  runRailCommand('{"path":"a.ts","command":"cat a.ts"}'),
  "cat a.ts",
  "a command outranks a bare path when both are present",
);
assert.equal(runRailCommand('{"other":1}'), null, "an object with nothing readable renders nothing, never [object Object]");
// Streaming tool input is frequently truncated mid-JSON; show the raw text
// rather than blanking the panel while a call is in flight.
assert.equal(runRailCommand('{"command":"npm ins'), '{"command":"npm ins');

// ── durations ───────────────────────────────────────────────────────────────
assert.equal(runRailDuration(820), "820ms");
assert.equal(runRailDuration(3400), "3.4s");
assert.equal(runRailDuration(55600), "56s");
assert.equal(runRailDuration(260000), "4m 20s");
assert.equal(runRailDuration(59600), "1m", "59.6s rounds to a minute, never '1m 60s'");
assert.equal(runRailDuration(44280000), "12h 18m", "the frame's OPEN readout");
assert.equal(runRailDuration(null), null);
assert.equal(runRailDuration(-1), null, "a negative duration is not rendered as a number");

// ── open time ───────────────────────────────────────────────────────────────
{
  const model = runRailModel([], { nowMs: NOW, conversationCreatedAt: "2026-08-08T23:42:00.000Z" });
  assert.equal(model.openMs, NOW - Date.parse("2026-08-08T23:42:00.000Z"));
  assert.equal(runRailModel([], { nowMs: NOW }).openMs, null, "no createdAt means no OPEN readout");
  assert.equal(
    runRailModel([], { nowMs: NOW, conversationCreatedAt: "not-a-date" }).openMs,
    null,
    "an unparseable createdAt yields null rather than NaN",
  );
  assert.equal(
    runRailModel([], { nowMs: NOW, conversationCreatedAt: "2099-01-01T00:00:00.000Z" }).openMs,
    null,
    "a future createdAt (clock skew) yields null rather than a negative age",
  );
}

// ── ticks ───────────────────────────────────────────────────────────────────
assert.deepEqual(runRailTicks(56000), [0, 14000, 28000, 42000, 56000], "five evenly spaced axis ticks");
assert.deepEqual(runRailTicks(0), [], "no ticks for a run with no measured time");

console.log("chat-run-rail.test.ts: ok");
