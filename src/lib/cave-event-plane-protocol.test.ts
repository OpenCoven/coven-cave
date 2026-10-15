import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CAVE_EVENT_CLOSE,
  CAVE_EVENT_PATH,
  CAVE_EVENT_PROTOCOL,
  CAVE_EVENT_TOPICS,
  CaveEventProtocolError,
  MAX_EVENT_ENTITY_IDS,
  MAX_EVENT_MESSAGE_BYTES,
  eventPlaneCapabilityFromEnv,
  isEventPlaneEnabled,
  normalizeEntityIds,
  normalizeTopics,
  parseEventClientMessage,
  parseEventServerMessage,
} from "./cave-event-plane-protocol.ts";

// One golden contract for TypeScript and Swift (#5830). The Swift client
// decodes the same file, so a change here is a change to both.
const fixture = JSON.parse(
  readFileSync(new URL("../../apps/ios/CovenCave/CovenCaveTests/Fixtures/cave-event-plane-v1.json", import.meta.url), "utf8"),
);
const raw = (value: unknown) => JSON.stringify(value);

test("protocol v1 decodes the shared golden messages", () => {
  assert.deepEqual(parseEventClientMessage(raw(fixture.hello)), fixture.hello);
  assert.deepEqual(parseEventClientMessage(raw(fixture.subscribe)), fixture.subscribe);
  assert.deepEqual(parseEventClientMessage(raw(fixture.ack)), fixture.ack);
  assert.deepEqual(parseEventServerMessage(raw(fixture.ready)), fixture.ready);
  assert.deepEqual(parseEventServerMessage(raw(fixture.invalidate)), fixture.invalidate);
  assert.deepEqual(parseEventServerMessage(raw(fixture.resyncRequired)), fixture.resyncRequired);
});

test("the fixture's constants match the module", () => {
  assert.deepEqual(fixture.closeCodes, CAVE_EVENT_CLOSE);
  assert.equal(fixture.capability.protocolVersion, CAVE_EVENT_PROTOCOL);
  assert.equal(fixture.capability.path, CAVE_EVENT_PATH);
  assert.deepEqual(fixture.capability.topics, [...CAVE_EVENT_TOPICS]);
});

test("unknown topics and protocols fail closed", () => {
  assert.throws(() => parseEventServerMessage(raw(fixture.malformed.unknownTopic)), /unknown event topic/);
  assert.throws(
    () => parseEventClientMessage(raw(fixture.malformed.unsupportedProtocol)),
    (error: unknown) =>
      error instanceof CaveEventProtocolError
      && /unsupported event protocol/.test(error.message)
      && error.closeCode === CAVE_EVENT_CLOSE.protocol,
  );
  assert.throws(() => parseEventClientMessage(raw({ ...fixture.subscribe, topics: ["sessions", "secrets"] })), /unknown event topic/);
});

test("malformed frames map to the invalid-frame close code", () => {
  const cases: unknown[] = [
    "not json",
    raw([]),
    raw({ ...fixture.hello, type: "shout" }),
    raw({ ...fixture.hello, clientId: "" }),
    raw({ ...fixture.hello, topics: ["board", "board"] }),
    raw({ ...fixture.hello, resume: { epoch: "boot-a", seq: -1 } }),
    raw({ ...fixture.ack, seq: 1.5 }),
    raw({ ...fixture.ack, seq: Number.MAX_SAFE_INTEGER + 2 }),
    new Uint8Array([1, 2, 3]),
  ];
  for (const frame of cases) {
    assert.throws(
      () => parseEventClientMessage(frame),
      (error: unknown) => error instanceof CaveEventProtocolError && error.closeCode === CAVE_EVENT_CLOSE.invalidFrame,
      `refused: ${String(frame).slice(0, 60)}`,
    );
  }
  assert.throws(() => parseEventServerMessage(raw({ ...fixture.resyncRequired, reason: "bored" })), /resync reason/);
  assert.throws(
    () => parseEventServerMessage(raw({ ...fixture.ready, versions: { runs: 1 } })),
    /unsubscribed topic/,
    "a ready barrier reports versions only for its installed topics",
  );
});

test("protocol bounds reject oversized input", () => {
  assert.throws(() => parseEventClientMessage("x".repeat(MAX_EVENT_MESSAGE_BYTES + 1)), /16 KiB/);
  assert.throws(
    () => normalizeEntityIds(Array.from({ length: MAX_EVENT_ENTITY_IDS + 1 }, (_, i) => `id-${i}`)),
    /at most 32 entity ids/,
  );
  assert.throws(() => normalizeEntityIds(["é".repeat(129)]), /at most 256 bytes/, "the id bound counts UTF-8 bytes");
  assert.deepEqual(normalizeEntityIds(["a", "a", "b"]), ["a", "b"]);
  assert.equal(normalizeEntityIds([]), undefined, "no ids is a full invalidation");
  assert.deepEqual(normalizeTopics(["board", "sessions"]), ["board", "sessions"], "caller order is kept");
});

test("the capability is off unless explicitly enabled, and modes fail closed", () => {
  assert.equal(isEventPlaneEnabled({}), false);
  assert.equal(isEventPlaneEnabled({ COVEN_CAVE_EVENT_PLANE_ENABLED: "0" }), false);
  assert.equal(isEventPlaneEnabled({ COVEN_CAVE_EVENT_PLANE_ENABLED: "yes" }), false);
  assert.equal(isEventPlaneEnabled({ COVEN_CAVE_EVENT_PLANE_ENABLED: "1" }), true);
  assert.deepEqual(eventPlaneCapabilityFromEnv({}).rolloutMode, { web: "off", ios: "off" });
  assert.deepEqual(
    eventPlaneCapabilityFromEnv({
      COVEN_CAVE_EVENT_PLANE_ENABLED: "1",
      COVEN_CAVE_EVENT_WEB_MODE: "shadow",
      COVEN_CAVE_EVENT_IOS_MODE: "turbo",
    }),
    { ...fixture.capability, rolloutMode: { web: "shadow", ios: "off" } },
  );
});

// ── Final conformance (#5869) ─────────────────────────────────────────────────
// Literal pins, so a change to the module and the fixture together still fails
// here. The Swift twin is CaveEventWireTests' testFinalConformancePins.

test("the wire constants are pinned literally", () => {
  assert.equal(CAVE_EVENT_PROTOCOL, 1);
  assert.equal(CAVE_EVENT_PATH, "/api/events-ws");
  assert.deepEqual([...CAVE_EVENT_TOPICS], ["sessions", "board", "runs", "familiars", "daemon"]);
  assert.deepEqual({ ...CAVE_EVENT_CLOSE }, { protocol: 4400, invalidFrame: 4402, slowConsumer: 4408 });
});

test("every malformed fixture is refused", () => {
  const entries = Object.entries(fixture.malformed as Record<string, unknown>);
  assert.ok(entries.length >= 2);
  for (const [name, message] of entries) {
    assert.throws(
      () => {
        try {
          parseEventServerMessage(raw(message));
        } catch (serverError) {
          parseEventClientMessage(raw(message));
          throw serverError;
        }
      },
      CaveEventProtocolError,
      `${name} must be refused`,
    );
  }
});

test("web and iOS rollout modes are independent", () => {
  const modes = ["off", "shadow", "primary"] as const;
  for (const web of modes) {
    for (const ios of modes) {
      const capability = eventPlaneCapabilityFromEnv({
        COVEN_CAVE_EVENT_PLANE_ENABLED: "1",
        COVEN_CAVE_EVENT_WEB_MODE: web,
        COVEN_CAVE_EVENT_IOS_MODE: ios,
      });
      assert.deepEqual(capability.rolloutMode, { web, ios });
    }
  }
});

test("ready is valid after hello and after a replacement subscribe", async () => {
  const { createEventBroker } = await import("./server/cave-event-broker.ts");
  const broker = createEventBroker({ newEpoch: () => "boot-a", setInterval: () => 0, clearInterval: () => {} });
  const sent: string[] = [];
  const handlers = broker.attach({
    bufferedAmount: 0,
    send: (data) => sent.push(data),
    close: () => {},
    ping: () => {},
    terminate: () => {},
  });
  handlers.message(Buffer.from(raw({ type: "hello", protocol: 1, clientId: "conformance", topics: ["board"] })), false);
  handlers.message(Buffer.from(raw(fixture.subscribe)), false);
  const readies = sent.map((frame) => parseEventServerMessage(frame)).filter((message) => message.type === "ready");
  assert.equal(readies.length, 2);
  assert.deepEqual(readies[0]!.topics, ["board"]);
  assert.deepEqual(readies[1]!.topics, fixture.subscribe.topics, "the replacement set, not a union");
  broker.shutdown();
});
