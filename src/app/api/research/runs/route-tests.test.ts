import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = (name: string) => readFileSync(new URL(`./[id]/${name}/route.ts`, import.meta.url), "utf8");
const snapshot = readFileSync(new URL("./[id]/route.ts", import.meta.url), "utf8");
const access = readFileSync(new URL("../../../../lib/server/research-run-gateway-route.ts", import.meta.url), "utf8");

test("gateway routes use the local origin and familiar ownership gates", () => {
  for (const source of [snapshot, route("events"), route("stream")]) {
    assert.match(source, /authorizeResearchRunRequest/);
    assert.match(source, /force-dynamic/);
  }
  assert.match(access, /rejectNonLocalRequest/);
  assert.match(access, /requireFamiliar/);
  assert.match(access, /mission\.familiarId !== familiarId/);
  assert.match(access, /research run not found/);
});

test("replay and SSE routes preserve cursor semantics and clean up watchers", () => {
  const events = route("events");
  const stream = route("stream");
  assert.match(events, /afterSeq/);
  assert.match(events, /limit/);
  assert.match(events, /invalid event query/);
  assert.match(stream, /last-event-id/);
  assert.match(stream, /event: \$\{event\}/);
  assert.match(stream, /text\/event-stream/);
  assert.match(stream, /watchResearchRunSources/);
  assert.match(stream, /stopWatching\?\.\(\)/);
  assert.match(stream, /clearInterval\(heartbeat\)/);
  assert.match(stream, /: ping/);
});

test("routes never proxy generic session or autoresearch streams", () => {
  for (const source of [snapshot, route("events"), route("stream")]) {
    assert.doesNotMatch(source, /sessions\/\[id\]\/events|autoloop|callDaemon/);
  }
});
