// @ts-nocheck
//
// Regression guard for the cave-state.json race condition that produced
// task chats with a missing title override (the user only saw the raw
// "Task context: …" seed prompt as the chat title because
// recordSessionFamiliar + setSessionTitle, fired via Promise.all from
// /api/board/[id]/chat, were both load→mutate→save and the second writer
// clobbered the first.
//
// The fix is an in-process state mutex (updateState in cave-config.ts).
// This test fires several concurrent state mutations in parallel and asserts
// that EVERY write survived — without the mutex, the file would end up
// missing at least one of the keys.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const previousHome = process.env.HOME;
const tempHome = await mkdtemp(path.join(os.tmpdir(), "cave-config-race-"));
process.env.HOME = tempHome;

const config = await import("./cave-config.ts");

try {
  // Mirror the exact /api/board/[id]/chat shape: two writes in Promise.all.
  await Promise.all([
    config.recordSessionFamiliar("sky-session", "echo"),
    config.setSessionTitle("sky-session", "Task: Color the Sky Blue"),
  ]);

  let state = await config.loadState();
  assert.equal(
    state.sessionFamiliar["sky-session"],
    "echo",
    "recordSessionFamiliar write must survive concurrent setSessionTitle",
  );
  assert.equal(
    state.sessionTitles["sky-session"],
    "Task: Color the Sky Blue",
    "setSessionTitle write must survive concurrent recordSessionFamiliar",
  );

  // Wider fan-out: every mutator firing simultaneously for the same session.
  // If any of them load the same snapshot and overwrite each other's keys,
  // at least one of the four assertions below will fail.
  const sid = "fanout";
  await Promise.all([
    config.recordSessionFamiliar(sid, "cody"),
    config.setSessionTitle(sid, "Task: Fanout"),
    config.archiveSessionLocal(sid),
    config.sacrificeSessionLocal(sid),
  ]);

  state = await config.loadState();
  assert.equal(state.sessionFamiliar[sid], "cody", "fanout familiar binding survived");
  assert.equal(state.sessionTitles[sid], "Task: Fanout", "fanout title override survived");
  assert.ok(state.sessionArchived[sid], "fanout archive timestamp survived");
  assert.ok(state.sessionSacrificed[sid], "fanout sacrifice timestamp survived");

  // Interleaved sessions: two distinct sessions writing in parallel must
  // both end up in state without trampling each other either.
  await Promise.all([
    config.recordSessionFamiliar("a", "fam-a"),
    config.setSessionTitle("a", "Task: A"),
    config.recordSessionFamiliar("b", "fam-b"),
    config.setSessionTitle("b", "Task: B"),
  ]);

  state = await config.loadState();
  assert.equal(state.sessionFamiliar.a, "fam-a");
  assert.equal(state.sessionTitles.a, "Task: A");
  assert.equal(state.sessionFamiliar.b, "fam-b");
  assert.equal(state.sessionTitles.b, "Task: B");

  console.log("cave-config-state-race.test.ts: ok");
} finally {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
}
