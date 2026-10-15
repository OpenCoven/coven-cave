import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { markResourceChanged, readEventPlaneDiagnostics, resetEventPublisherReportsForTests } from "./cave-event-plane-publisher.ts";

afterEach(() => {
  delete globalThis.__covenCaveEventPlanePublisher;
  delete globalThis.__covenCaveEventPlaneDiagnostics;
  resetEventPublisherReportsForTests();
});

test("publishes through the installed bridge", () => {
  const seen: unknown[] = [];
  globalThis.__covenCaveEventPlanePublisher = {
    enabled: true,
    markResourceChanged: (topic, entityIds) => seen.push({ topic, entityIds }),
  };
  assert.equal(markResourceChanged("board", ["card-1"]), true);
  assert.deepEqual(seen, [{ topic: "board", entityIds: ["card-1"] }]);
});

test("explicitly disabled publication is a quiet no-op", () => {
  const errors: unknown[][] = [];
  globalThis.__covenCaveEventPlanePublisher = {
    enabled: false,
    markResourceChanged: () => assert.fail("a disabled bridge must not publish"),
  };
  assert.equal(markResourceChanged("sessions", undefined, (...args) => errors.push(args)), false);
  assert.deepEqual(errors, [], "the kill switch is not a failure");
});

test("a missing bridge reports once without failing the write", () => {
  const errors: unknown[][] = [];
  const report = (...args: unknown[]) => errors.push(args);
  assert.equal(markResourceChanged("daemon", undefined, report), false);
  assert.equal(markResourceChanged("daemon", undefined, report), false);
  assert.equal(errors.length, 1, "reported once per kind and topic");
  assert.match(String(errors[0]?.[0]), /event-plane publisher unavailable/);
});

test("a malformed bridge or a throwing broker is reported, never thrown", () => {
  const errors: unknown[][] = [];
  const report = (...args: unknown[]) => errors.push(args);
  globalThis.__covenCaveEventPlanePublisher = { enabled: true } as never;
  assert.equal(markResourceChanged("runs", undefined, report), false);
  globalThis.__covenCaveEventPlanePublisher = {
    enabled: true,
    markResourceChanged: () => { throw new Error("broker stopped"); },
  };
  assert.equal(markResourceChanged("runs", undefined, report), false);
  assert.match(String(errors[0]?.[0]), /malformed/);
  assert.match(String(errors[1]?.[0]), /publish-failed/);
  assert.equal(errors[1]?.[1], "broker stopped");
});

test("entity overflow degrades to a full invalidation without throwing", () => {
  const seen: unknown[] = [];
  globalThis.__covenCaveEventPlanePublisher = {
    enabled: true,
    markResourceChanged: (topic, entityIds) => seen.push({ topic, entityIds }),
  };
  assert.equal(markResourceChanged("board", Array.from({ length: 40 }, (_, index) => `card-${index}`)), true);
  assert.deepEqual(seen, [{ topic: "board", entityIds: undefined }]);
});

test("an invalid entity id is a reported failure, not a thrown one", () => {
  const errors: unknown[][] = [];
  globalThis.__covenCaveEventPlanePublisher = { enabled: true, markResourceChanged: () => {} };
  assert.equal(markResourceChanged("board", ["x".repeat(300)], (...args) => errors.push(args)), false);
  assert.match(String(errors[0]?.[0]), /publish-failed/);
});

test("diagnostics read only known aggregate counts from the bridge (#5862)", () => {
  globalThis.__covenCaveEventPlaneDiagnostics = () => ({
    enabled: true,
    activeConnections: 1,
    readyConnections: 1,
    subscriptions: { board: 1, extra: 9 },
    invalidations: { board: 2 },
    replayGaps: 0,
    slowConsumerCloses: -3,
    covenCaveToken: "secret",
    entityIds: ["card-1"],
  }) as never;
  const diagnostics = readEventPlaneDiagnostics();
  assert.deepEqual(diagnostics, {
    enabled: true,
    activeConnections: 1,
    readyConnections: 1,
    subscriptions: { sessions: 0, board: 1, runs: 0, familiars: 0, daemon: 0 },
    invalidations: { sessions: 0, board: 2, runs: 0, familiars: 0, daemon: 0 },
    replayGaps: 0,
    slowConsumerCloses: 0,
  });
  assert.equal(JSON.stringify(diagnostics).includes("covenCaveToken"), false);
  assert.equal(JSON.stringify(diagnostics).includes("entityIds"), false);
});

test("diagnostics without the bridge, or with a throwing one, report the plane off", () => {
  assert.equal(readEventPlaneDiagnostics().enabled, false);
  globalThis.__covenCaveEventPlaneDiagnostics = () => { throw new Error("boom"); };
  assert.equal(readEventPlaneDiagnostics().enabled, false);
  assert.equal(readEventPlaneDiagnostics().activeConnections, 0);
});
