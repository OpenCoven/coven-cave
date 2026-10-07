import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { markResourceChanged, resetEventPublisherReportsForTests } from "./cave-event-plane-publisher.ts";

afterEach(() => {
  delete globalThis.__covenCaveEventPlanePublisher;
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
