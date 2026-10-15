import assert from "node:assert/strict";
import { test } from "node:test";
import { CAVE_EVENT_CLOSE } from "../cave-event-plane-protocol.ts";
import {
  boundedPositiveInt,
  createEventBroker,
  summarizeEventPlaneDiagnostics,
  type EventBrokerOptions,
  type EventSocket,
  type EventSocketHandlers,
} from "./cave-event-broker.ts";

class FakeSocket implements EventSocket {
  bufferedAmount = 0;
  sent: string[] = [];
  closes: { code: number; reason: string }[] = [];
  pings = 0;
  terminated = false;
  handlers!: EventSocketHandlers;
  send(data: string) { this.sent.push(data); }
  close(code: number, reason: string) { this.closes.push({ code, reason }); }
  ping() { this.pings += 1; }
  terminate() { this.terminated = true; }
  receive(value: unknown, isBinary = false) {
    this.handlers.message(typeof value === "string" ? Buffer.from(value) : value, isBinary);
  }
  json(index = -1) { return JSON.parse(this.sent.at(index) ?? "null"); }
  lastClose() { return this.closes.at(-1); }
}

function fixture(options: EventBrokerOptions = {}) {
  let beat: (() => void) | null = null;
  let epochs = 0;
  const broker = createEventBroker({
    newEpoch: () => `boot-${++epochs}`,
    setInterval: (callback) => { beat = callback; return 1; },
    clearInterval: () => { beat = null; },
    ...options,
  });
  const connect = () => {
    const socket = new FakeSocket();
    socket.handlers = broker.attach(socket);
    return socket;
  };
  return { broker, connect, beat: () => beat?.() };
}

const hello = (topics: string[], resume?: { epoch: string; seq: number }) =>
  JSON.stringify({ type: "hello", protocol: 1, clientId: "test-client", topics, ...(resume ? { resume } : {}) });

test("hello installs topics and returns the ready barrier", () => {
  const { broker, connect } = fixture();
  const socket = connect();
  socket.receive(hello(["board"]));
  assert.deepEqual(socket.json(), {
    type: "ready", protocol: 1, epoch: broker.epoch(), seq: 0, topics: ["board"], versions: { board: 0 },
  });
});

test("a replacement subscribe returns a new barrier with the installed set", () => {
  const { broker, connect } = fixture();
  const socket = connect();
  socket.receive(hello(["sessions"]));
  broker.publish("board");
  socket.receive(JSON.stringify({ type: "subscribe", protocol: 1, topics: ["board"] }));
  assert.deepEqual(socket.json(), {
    type: "ready", protocol: 1, epoch: broker.epoch(), seq: 1, topics: ["board"], versions: { board: 1 },
  });
  assert.equal(socket.sent.length, 2, "the board event before the subscribe was not sent to a sessions-only client");
});

test("sequences are global and versions are per topic; fan-out is topic-filtered", () => {
  const { broker, connect } = fixture();
  const board = connect();
  const sessions = connect();
  board.receive(hello(["board"]));
  sessions.receive(hello(["sessions"]));
  broker.publish("board", ["card-1"]);
  broker.publish("sessions");
  broker.publish("board");
  assert.deepEqual(board.sent.slice(1).map((raw) => JSON.parse(raw)), [
    { type: "invalidate", protocol: 1, epoch: "boot-1", seq: 1, topic: "board", version: 1, entityIds: ["card-1"] },
    { type: "invalidate", protocol: 1, epoch: "boot-1", seq: 3, topic: "board", version: 2 },
  ]);
  assert.deepEqual(sessions.sent.slice(1).map((raw) => JSON.parse(raw)), [
    { type: "invalidate", protocol: 1, epoch: "boot-1", seq: 2, topic: "sessions", version: 1 },
  ]);
  const diagnostics = broker.diagnostics();
  assert.equal(diagnostics.seq, 3);
  assert.equal(diagnostics.versions.board, 2);
  assert.equal(diagnostics.delivered.board, 2);
  assert.equal(diagnostics.subscriptions.board, 1);
});

test("a resume cursor replays retained events for the subscribed topics, then the barrier", () => {
  const { broker, connect } = fixture();
  broker.publish("board");
  broker.publish("runs");
  broker.publish("board", ["card-2"]);
  const socket = connect();
  socket.receive(hello(["board"], { epoch: "boot-1", seq: 1 }));
  assert.deepEqual(socket.sent.map((raw) => JSON.parse(raw).type), ["invalidate", "ready"]);
  assert.equal(socket.json(0).seq, 3);
  assert.equal(broker.diagnostics().replayed, 1);
});

test("a cursor from another boot, or older than the ring, gets resync-required", () => {
  const { broker, connect } = fixture({ ringCountLimit: 2 });
  for (let i = 0; i < 5; i += 1) broker.publish("board");
  const restarted = connect();
  restarted.receive(hello(["board"], { epoch: "boot-0", seq: 2 }));
  assert.deepEqual(restarted.json(0), {
    type: "resync-required", protocol: 1, epoch: "boot-1", seq: 5, topics: ["board"], reason: "server-restarted",
  });
  assert.equal(restarted.json().type, "ready");
  const behind = connect();
  behind.receive(hello(["board"], { epoch: "boot-1", seq: 1 }));
  assert.equal(behind.json(0).reason, "replay-gap", "events 2 and 3 were evicted");
  const current = connect();
  current.receive(hello(["board"], { epoch: "boot-1", seq: 3 }));
  assert.deepEqual(current.sent.map((raw) => JSON.parse(raw).seq), [4, 5, 5], "4 and 5 replay, then ready at 5");
  const diagnostics = broker.diagnostics();
  assert.equal(diagnostics.restartResyncs, 1);
  assert.equal(diagnostics.replayGaps, 1);
  assert.equal(diagnostics.ringEvents, 2);
});

test("the replay ring is bounded by bytes as well as count", () => {
  const { broker } = fixture({ ringByteLimit: 400 });
  for (let i = 0; i < 20; i += 1) broker.publish("board", [`card-${i}`]);
  const diagnostics = broker.diagnostics();
  assert.ok(diagnostics.ringBytes <= 400, `ring bytes ${diagnostics.ringBytes}`);
  assert.ok(diagnostics.ringEvents < 20);
});

test("an impossible cursor is refused", () => {
  const { connect } = fixture();
  const socket = connect();
  socket.receive(hello(["board"], { epoch: "boot-1", seq: 9 }));
  assert.deepEqual(socket.lastClose(), { code: CAVE_EVENT_CLOSE.invalidFrame, reason: "impossible resume cursor" });
});

test("acknowledgements are cumulative and checked", () => {
  const { broker, connect } = fixture();
  const socket = connect();
  socket.receive(hello(["board"]));
  broker.publish("board");
  broker.publish("board");
  socket.receive(JSON.stringify({ type: "ack", protocol: 1, epoch: "boot-1", seq: 2 }));
  socket.receive(JSON.stringify({ type: "ack", protocol: 1, epoch: "boot-1", seq: 1 }));
  assert.equal(broker.diagnostics().acknowledgements, 1, "a lower ack doesn't move the cursor back");
  socket.receive(JSON.stringify({ type: "ack", protocol: 1, epoch: "boot-1", seq: 7 }));
  assert.deepEqual(socket.lastClose(), { code: CAVE_EVENT_CLOSE.invalidFrame, reason: "invalid acknowledgement" });
});

test("unsupported protocols close before any broker detail is disclosed", () => {
  const { connect } = fixture();
  const socket = connect();
  socket.receive(JSON.stringify({ type: "hello", protocol: 2, clientId: "future", topics: ["board"] }));
  assert.equal(socket.sent.length, 0);
  const close = socket.lastClose();
  assert.equal(close?.code, CAVE_EVENT_CLOSE.protocol);
  assert.doesNotMatch(close?.reason ?? "", /epoch|sequence|seq|version|boot/i);
});

test("binary, oversized, malformed and out-of-order frames are refused", () => {
  const { broker, connect } = fixture();
  const cases: [unknown, boolean, string][] = [
    [Buffer.from("{}"), true, "binary frames are not accepted"],
    ["x".repeat(17 * 1024), false, "frame too large"],
    ["{not json", false, "invalid frame"],
    [JSON.stringify({ type: "subscribe", protocol: 1, topics: ["board"] }), false, "hello required"],
  ];
  for (const [frame, isBinary, reason] of cases) {
    const socket = connect();
    socket.receive(frame, isBinary);
    assert.deepEqual(socket.lastClose(), { code: CAVE_EVENT_CLOSE.invalidFrame, reason });
  }
  const twice = connect();
  twice.receive(hello(["board"]));
  twice.receive(hello(["board"]));
  assert.deepEqual(twice.lastClose(), { code: CAVE_EVENT_CLOSE.invalidFrame, reason: "duplicate hello" });
  assert.equal(broker.diagnostics().connections, 0, "every refused client was forgotten");
});

test("heartbeats terminate a client that missed a pong and a socket that never said hello", () => {
  const { broker, connect, beat } = fixture();
  const answering = connect();
  answering.receive(hello(["board"]));
  const deaf = connect();
  deaf.receive(hello(["board"]));
  const silent = connect();
  beat();
  answering.handlers.pong();
  // A browser answers pings by itself, so a socket can stay alive without
  // ever saying hello. It still loses its slot.
  silent.handlers.pong();
  beat();
  assert.equal(deaf.terminated, true, "no pong since the last ping");
  assert.equal(answering.terminated, false);
  assert.deepEqual(silent.lastClose(), { code: CAVE_EVENT_CLOSE.invalidFrame, reason: "hello required" });
  assert.equal(broker.diagnostics().connections, 1);
  assert.equal(broker.diagnostics().closures.heartbeat, 1);
});

test("a slow consumer is closed before the send, and closed sockets are forgotten", () => {
  const { broker, connect } = fixture({ bufferedAmountLimit: 10 });
  const slow = connect();
  slow.receive(hello(["board"]));
  slow.bufferedAmount = 11;
  broker.publish("board");
  assert.equal(slow.sent.length, 1, "only the ready barrier");
  assert.deepEqual(slow.lastClose(), { code: CAVE_EVENT_CLOSE.slowConsumer, reason: "slow consumer" });
  const leaving = connect();
  leaving.receive(hello(["board"]));
  leaving.handlers.closed();
  assert.equal(broker.diagnostics().connections, 0);
  assert.equal(broker.diagnostics().closures.slowConsumer, 1);
});

test("shutdown closes every client", () => {
  const { broker, connect } = fixture();
  const socket = connect();
  socket.receive(hello(["board"]));
  broker.shutdown();
  assert.deepEqual(socket.lastClose(), { code: 1001, reason: "server shutting down" });
  assert.equal(broker.diagnostics().connections, 0);
});

test("boundedPositiveInt accepts only positive safe integers and clamps", () => {
  assert.equal(boundedPositiveInt(undefined, 2048, 16384), 2048);
  assert.equal(boundedPositiveInt("abc", 2048, 16384), 2048);
  assert.equal(boundedPositiveInt("0", 2048, 16384), 2048);
  assert.equal(boundedPositiveInt("-5", 2048, 16384), 2048);
  assert.equal(boundedPositiveInt("1.5", 2048, 16384), 2048);
  assert.equal(boundedPositiveInt("4096", 2048, 16384), 4096);
  assert.equal(boundedPositiveInt("999999", 2048, 16384), 16384);
});

test("the diagnostics summary is aggregate counts only (#5862)", () => {
  const { broker, connect } = fixture({ bufferedAmountLimit: 10 });
  const ready = connect();
  ready.receive(hello(["board"]));
  connect(); // open, no hello yet
  const slow = connect();
  slow.receive(hello(["sessions"]));
  slow.bufferedAmount = 11;
  broker.publish("board", ["card-secret"]);
  broker.publish("sessions");
  const summary = summarizeEventPlaneDiagnostics(broker.diagnostics());
  assert.deepEqual(summary, {
    enabled: true,
    activeConnections: 2,
    readyConnections: 1,
    subscriptions: { sessions: 0, board: 1, runs: 0, familiars: 0, daemon: 0 },
    invalidations: { sessions: 1, board: 1, runs: 0, familiars: 0, daemon: 0 },
    replayGaps: 0,
    slowConsumerCloses: 1,
  });
  const text = JSON.stringify(summary);
  assert.equal(text.includes("card-secret"), false, "no entity ids");
  assert.equal(text.includes("boot-1"), false, "no epoch");
});

test("a disabled plane summarizes as off with zero counts", () => {
  const summary = summarizeEventPlaneDiagnostics(null);
  assert.equal(summary.enabled, false);
  assert.equal(summary.activeConnections, 0);
  assert.deepEqual(Object.values(summary.invalidations), [0, 0, 0, 0, 0]);
});
