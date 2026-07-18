// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  matchStuckCreatedRows,
  parseDaemonTime,
} from "./stuck-created-sweep.ts";

// --- parseDaemonTime: daemon emits nanosecond fractions Date.parse doesn't
// guarantee — the parser truncates to milliseconds and never throws.
{
  const ms = parseDaemonTime("2026-07-12T07:53:11.123456789Z");
  assert.equal(ms, Date.parse("2026-07-12T07:53:11.123Z"), "nanosecond fraction truncates to ms");
  assert.equal(
    parseDaemonTime("2026-07-12T07:53:11Z"),
    Date.parse("2026-07-12T07:53:11Z"),
    "fraction-free timestamps pass through",
  );
  assert.ok(Number.isNaN(parseDaemonTime("not-a-time")), "garbage parses to NaN, not a throw");
}

const CWD = "/Users/x/.coven/workspaces/familiars/astra";
const row = (over = {}) => ({
  id: "aaaaaaaa-1111-2222-3333-444444444444",
  project_root: CWD,
  title: "ping",
  status: "created",
  created_at: "2026-07-12T07:53:11.000000000Z",
  ...over,
});
const OPTS = { cwd: CWD, prompt: "ping", sinceMs: Date.parse("2026-07-12T07:53:00Z") };

// --- the exact cave-zef7 shape: two identical "created" rows, same second,
// same familiar workspace — both match.
{
  const ids = matchStuckCreatedRows([row({ id: "a1" }), row({ id: "a2" })], OPTS);
  assert.deepEqual(ids, ["a1", "a2"], "group-chat fan-out leak: both rows swept");
}

// --- every axis must agree; each mismatch alone disqualifies the row.
{
  assert.deepEqual(matchStuckCreatedRows([row({ status: "running" })], OPTS), [], "non-created status never matches");
  assert.deepEqual(matchStuckCreatedRows([row({ status: "completed" })], OPTS), [], "completed history is untouchable");
  assert.deepEqual(
    matchStuckCreatedRows([row({ project_root: "/Users/x/.coven/workspaces/familiars/cody" })], OPTS),
    [],
    "another familiar's workspace never matches (parallel fan-out siblings stay safe)",
  );
  assert.deepEqual(
    matchStuckCreatedRows([row({ created_at: "2026-07-12T07:52:00Z" })], OPTS),
    [],
    "rows created before the turn window never match",
  );
  assert.deepEqual(
    matchStuckCreatedRows([row({ created_at: "garbage" })], OPTS),
    [],
    "unparsable created_at is skipped, not swept",
  );
}

// --- title semantics: the daemon stores the prompt head as the title, so the
// title must be a non-empty prefix of the prompt this turn actually sent.
{
  const longPrompt = "Runtime filesystem boundary:\n- This is the local workspace for astra and much more text";
  assert.deepEqual(
    matchStuckCreatedRows(
      [row({ title: "Runtime filesystem boundary:\n- This is the local" })],
      { ...OPTS, prompt: longPrompt },
    ),
    [row().id],
    "truncated title matches as a prefix of the full prompt",
  );
  assert.deepEqual(
    matchStuckCreatedRows([row({ title: "pong" })], OPTS),
    [],
    "a different prompt's row never matches",
  );
  assert.deepEqual(matchStuckCreatedRows([row({ title: "" })], OPTS), [], "empty title never matches");
  assert.deepEqual(
    matchStuckCreatedRows([row()], { ...OPTS, prompt: "   " }),
    [],
    "blank prompt sweeps nothing",
  );
}

// --- route wiring pins: the sweep must stay on the no-handshake failure path
// of NEW chats only, and must never run for resumes, cancels, or ssh runtimes.
{
  const route = readFileSync(
    new URL("../../app/api/chat/send/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    route,
    /if \(!cancelledByUser && !body\.sessionId && !sessionId && !sshRuntime\) \{\s*const swept = await sweepStuckCreatedSessions\(\{/,
    "sweep is gated on: not cancelled, new chat, no stream handshake, local runtime",
  );
  assert.match(
    route,
    /sinceMs: turnSpawnStartMs - 5000,/,
    "sweep window opens just before the first spawn attempt",
  );
  assert.match(
    route,
    /const turnSpawnStartMs = Date\.now\(\);\s*await runAttempt\(args\);/,
    "turn window anchor is captured immediately before the first attempt",
  );
}

// --- sweeper source pins: real deletion goes through `coven sacrifice`, and
// the local tombstone always lands even when the CLI call fails.
{
  const sweep = readFileSync(new URL("./stuck-created-sweep.ts", import.meta.url), "utf8");
  assert.match(sweep, /"sacrifice", id, "--yes"/, "daemon row is deleted via coven sacrifice");
  assert.match(sweep, /await sacrificeSessionLocal\(id\);/, "local tombstone hides the ghost row regardless");
  assert.match(
    sweep,
    /SESSION_ID_RE\.test\(id\)/,
    "ids are validated before reaching argv",
  );
}

console.log("stuck-created-sweep.test.ts: ok");
