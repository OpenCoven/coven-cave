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
  assert.match(
    access,
    /requestedRunId/,
    "authorization must preserve an explicitly requested canonical run generation",
  );
  for (const source of [snapshot, route("events"), route("stream")]) {
    assert.match(
      source,
      /authorized\.value\.requestedRunId/,
      "every route must pass the exact requested run generation to the gateway",
    );
  }
});

test("replay and SSE routes preserve cursor semantics and clean up watchers", () => {
  const events = route("events");
  const stream = route("stream");
  assert.match(events, /afterSeq/);
  assert.match(events, /limit/);
  assert.match(events, /invalid event query/);
  assert.match(stream, /last-event-id/);
  assert.match(stream, /cursorRunId/);
  assert.match(stream, /requireCursorIdentity: true/);
  assert.match(stream, /event: \$\{event\}/);
  assert.match(stream, /text\/event-stream/);
  assert.match(stream, /watchResearchRunSources/);
  assert.match(
    stream,
    /subscribeBeforeInitialResearchRunRead\([\s\S]*?\(\) => replayForStream\(afterSeq, true\)/,
  );
  assert.match(stream, /stopWatching\?\.\(\)/);
  assert.match(stream, /clearInterval\(heartbeat\)/);
  assert.match(stream, /: ping/);
  assert.match(
    stream,
    /watchResearchRunSources\([\s\S]*?authorized\.value\.missionId,[\s\S]*?notify,[\s\S]*?signalWatcherFailure,[\s\S]*?requestedRunId/,
    "watcher failures must reach the stream owner instead of leaving heartbeat-only SSE open",
  );
  assert.match(
    stream,
    /signalWatcherFailure[\s\S]*?cleanup\(\)[\s\S]*?controller\.close\(\)/,
    "a watcher failure must close the SSE stream so EventSource reconnects",
  );
  assert.match(
    stream,
    /authorized\.value\.requestedRunId \?\? undefined[\s\S]*?watchResearchRunSources/,
    "SSE watcher selection must distinguish current mission aliases from exact run ids",
  );
  assert.match(
    stream,
    /!requestedRunId \|\| requestedRunId === authorizedRunId/,
    "an exact selector that still names the current run must watch mission transitions",
  );
  assert.match(
    stream,
    /page\.run\.id !== streamedRunId[\s\S]*?cursor = 0[\s\S]*?snapshotSent = false[\s\S]*?rebindWatching\(page\.run\.id\)/,
    "a live current-selector generation change must reset replay and publish a fresh snapshot",
  );
});

test("routes never proxy generic session or autoresearch streams", () => {
  for (const source of [snapshot, route("events"), route("stream")]) {
    assert.doesNotMatch(source, /sessions\/\[id\]\/events|autoloop|callDaemon/);
  }
});
