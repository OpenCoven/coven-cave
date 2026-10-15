import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  EVENT_BACKOFF_MAX_MS,
  createCaveEventPlaneClient,
  type CaveEventInvalidation,
  type CaveEventSocket,
} from "./cave-event-plane-client.ts";
import type { CaveEventPlaneCapability, CaveEventRolloutMode } from "./cave-event-plane-protocol.ts";

const fixture = JSON.parse(
  readFileSync(new URL("../../apps/ios/CovenCave/CovenCaveTests/Fixtures/cave-event-plane-v1.json", import.meta.url), "utf8"),
);
const OPEN = 1;

class FakeSocket implements CaveEventSocket {
  readyState = 0;
  sent: string[] = [];
  closeReason: string | null = null;
  closeCode: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  constructor(url: string) { this.url = url; }
  send(data: string) { this.sent.push(data); }
  close(code = 1000, reason = "") {
    this.readyState = 3;
    this.closeCode = code;
    this.closeReason = reason;
  }
  open() {
    this.readyState = OPEN;
    this.onopen?.();
  }
  message(value: unknown) { this.onmessage?.({ data: typeof value === "string" ? value : JSON.stringify(value) }); }
  serverClose(code = 1006, reason = "") {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  json(index = -1) { return JSON.parse(this.sent.at(index) ?? "null"); }
  types() { return this.sent.map((raw) => JSON.parse(raw).type); }
}

class FakeClock {
  now = 1_000_000;
  private timers: { id: number; at: number; callback: () => void }[] = [];
  private next = 1;
  setTimeout = (callback: () => void, ms: number) => {
    const id = this.next++;
    this.timers.push({ id, at: this.now + ms, callback });
    return id;
  };
  clearTimeout = (handle: unknown) => {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  };
  advance(ms: number) {
    const target = this.now + ms;
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const due = this.timers[0];
      if (!due || due.at > target) break;
      this.timers.shift();
      this.now = due.at;
      due.callback();
    }
    this.now = target;
  }
  pending() { return this.timers.length; }
}

function capabilityFor(web: CaveEventRolloutMode, enabled = true): CaveEventPlaneCapability {
  return { ...fixture.capability, enabled, rolloutMode: { web, ios: "off" } };
}

function createFixture(options: { webMode?: CaveEventRolloutMode; enabled?: boolean; random?: number } = {}) {
  const clock = new FakeClock();
  const sockets: FakeSocket[] = [];
  let visible = true;
  const visibilityListeners = new Set<() => void>();
  let capabilityReads = 0;
  const calls: { topic: string; entityIds?: readonly string[] }[] = [];
  const listener = Object.assign(
    (event: CaveEventInvalidation) => calls.push({ topic: event.topic, ...(event.entityIds ? { entityIds: event.entityIds } : {}) }),
    { calls },
  );
  const client = createCaveEventPlaneClient({
    fetchCapability: async () => {
      capabilityReads += 1;
      return capabilityFor(options.webMode ?? "primary", options.enabled ?? true);
    },
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    socketUrl: (path) => `ws://127.0.0.1:3000${path}`,
    now: () => clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    random: () => options.random ?? 0.5,
    visibility: {
      isVisible: () => visible,
      onChange(fn) {
        visibilityListeners.add(fn);
        return () => visibilityListeners.delete(fn);
      },
    },
    clientId: "test-web",
  });
  const setVisible = (value: boolean) => {
    visible = value;
    for (const fn of visibilityListeners) fn();
  };
  return {
    client,
    clock,
    sockets,
    listener,
    capabilityReads: () => capabilityReads,
    visibility: { hide: () => setVisible(false), show: () => setVisible(true) },
  };
}

/** Let the capability fetch's promise chain settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function readyFixture(topics: string[], options: Parameters<typeof createFixture>[0] = {}) {
  const fx = createFixture(options);
  const offs = topics.map((topic) => fx.client.subscribe(topic as never, fx.listener));
  await settle();
  const socket = fx.sockets[0]!;
  socket.open();
  socket.message({ ...fixture.ready, topics, versions: Object.fromEntries(topics.map((t) => [t, 0])) });
  return { ...fx, socket, offs };
}

test("zero subscribers create zero sockets and read nothing", async () => {
  const fx = createFixture();
  fx.clock.advance(60_000);
  await settle();
  assert.equal(fx.sockets.length, 0);
  assert.equal(fx.capabilityReads(), 0);
  assert.equal(fx.client.state(), "idle");
});

test("the first subscriber opens one socket, says hello, and is ready after the barrier", async () => {
  const fx = createFixture();
  fx.client.subscribe("sessions", fx.listener);
  fx.client.subscribe("sessions", () => {});
  await settle();
  assert.equal(fx.sockets.length, 1, "one socket per manager");
  assert.equal(fx.sockets[0]!.url, "ws://127.0.0.1:3000/api/events-ws");
  assert.equal(fx.client.state(), "connecting");
  fx.sockets[0]!.open();
  assert.deepEqual(fx.sockets[0]!.json(), { type: "hello", protocol: 1, clientId: "test-web", topics: ["sessions"] });
  assert.equal(fx.client.topicReady("sessions"), false, "not ready before the barrier");
  fx.sockets[0]!.message({ ...fixture.ready, topics: ["sessions"], versions: { sessions: 3 } });
  assert.equal(fx.client.state(), "ready");
  assert.equal(fx.client.topicReady("sessions"), true);
});

test("the last unsubscribe closes after the grace period", async () => {
  const fx = await readyFixture(["sessions"]);
  fx.offs[0]!();
  fx.clock.advance(14_999);
  assert.equal(fx.socket.readyState, OPEN);
  fx.clock.advance(1);
  assert.equal(fx.socket.closeReason, "idle");
  assert.equal(fx.client.state(), "idle");
});

test("a resubscribe within the grace period keeps the same socket", async () => {
  const fx = await readyFixture(["sessions"]);
  fx.offs[0]!();
  fx.clock.advance(5_000);
  fx.client.subscribe("sessions", fx.listener);
  fx.clock.advance(20_000);
  assert.equal(fx.sockets.length, 1);
  assert.equal(fx.socket.closeReason, null);
});

test("topic changes send the complete set, and a late topic waits for the new barrier", async () => {
  const fx = await readyFixture(["sessions"]);
  const offBoard = fx.client.subscribe("board", fx.listener);
  assert.deepEqual(fx.socket.json(), { type: "subscribe", protocol: 1, topics: ["sessions", "board"] });
  assert.equal(fx.client.topicReady("board"), false);
  assert.equal(fx.client.topicReady("sessions"), true, "an installed topic stays ready");
  fx.socket.message({ ...fixture.ready, topics: ["sessions", "board"], versions: { sessions: 3, board: 8 } });
  assert.equal(fx.client.topicReady("board"), true);
  offBoard();
  assert.deepEqual(fx.socket.json().topics, ["sessions"]);
  assert.equal(fx.client.topicReady("board"), false);
});

test("primary mode coalesces invalidations over 100 ms and unions entity ids", async () => {
  const fx = await readyFixture(["board"]);
  fx.socket.message(fixture.invalidate);
  fx.socket.message({ ...fixture.invalidate, seq: 44, version: 10, entityIds: ["card-2"] });
  fx.clock.advance(99);
  assert.equal(fx.listener.calls.length, 0);
  fx.clock.advance(1);
  assert.deepEqual(fx.listener.calls, [{ topic: "board", entityIds: ["card-1", "card-2"] }]);
  assert.equal(fx.client.diagnostics().coalesced, 1);
});

test("an id-less invalidation, or too many ids, refreshes the whole topic", async () => {
  const fx = await readyFixture(["board"]);
  fx.socket.message(fixture.invalidate);
  fx.socket.message({ ...fixture.invalidate, seq: 44, version: 10, entityIds: undefined });
  fx.clock.advance(100);
  assert.deepEqual(fx.listener.calls, [{ topic: "board" }]);
  for (let i = 0; i < 3; i += 1) {
    fx.socket.message({
      ...fixture.invalidate,
      seq: 50 + i,
      version: 20 + i,
      entityIds: Array.from({ length: 20 }, (_, n) => `card-${i}-${n}`),
    });
  }
  fx.clock.advance(100);
  assert.deepEqual(fx.listener.calls.at(-1), { topic: "board" }, "past 32 ids the topic is refreshed whole");
});

test("shadow mode records invalidations without notifying refresh owners", async () => {
  const fx = await readyFixture(["board"], { webMode: "shadow" });
  fx.socket.message(fixture.invalidate);
  fx.clock.advance(100);
  assert.equal(fx.listener.calls.length, 0);
  assert.equal(fx.client.diagnostics().invalidationsObserved.board, 1);
  assert.equal(fx.client.rolloutMode(), "shadow");
});

test("a disabled plane or an off mode connects nothing", async () => {
  for (const options of [{ enabled: false }, { webMode: "off" as const }]) {
    const fx = createFixture(options);
    fx.client.subscribe("board", fx.listener);
    await settle();
    assert.equal(fx.sockets.length, 0);
    assert.equal(fx.client.state(), "disabled");
    assert.equal(fx.client.topicReady("board"), false);
  }
});

test("hidden clients hold dirty topics and flush once on show", async () => {
  const fx = await readyFixture(["board"]);
  fx.visibility.hide();
  fx.socket.message(fixture.invalidate);
  fx.clock.advance(500);
  assert.equal(fx.listener.calls.length, 0);
  fx.visibility.show();
  assert.deepEqual(fx.listener.calls, [{ topic: "board", entityIds: ["card-1"] }]);
  fx.visibility.show();
  assert.equal(fx.listener.calls.length, 1, "a clean topic is not refreshed again");
});

test("duplicate or older sequences are ignored", async () => {
  const fx = await readyFixture(["board"]);
  fx.socket.message(fixture.invalidate);
  fx.socket.message(fixture.invalidate);
  fx.socket.message({ ...fixture.invalidate, seq: 40 });
  assert.equal(fx.client.diagnostics().invalidationsObserved.board, 1);
});

test("acknowledgements are cumulative and sent at most once a second", async () => {
  const fx = await readyFixture(["board"]);
  fx.socket.message({ ...fixture.invalidate, seq: 43 });
  assert.deepEqual(fx.socket.json(), { type: "ack", protocol: 1, epoch: "boot-a", seq: 43 });
  fx.socket.message({ ...fixture.invalidate, seq: 44 });
  fx.socket.message({ ...fixture.invalidate, seq: 45 });
  assert.equal(fx.socket.types().filter((type) => type === "ack").length, 1, "throttled");
  fx.clock.advance(1_000);
  assert.deepEqual(fx.socket.json(), { type: "ack", protocol: 1, epoch: "boot-a", seq: 45 });
});

test("a reconnect resumes from the in-memory cursor", async () => {
  const fx = await readyFixture(["board"]);
  fx.socket.message({ ...fixture.invalidate, seq: 43 });
  fx.socket.serverClose(1006);
  assert.equal(fx.client.state(), "backing-off");
  assert.equal(fx.client.topicReady("board"), false, "a lost connection is not healthy");
  fx.clock.advance(500);
  const next = fx.sockets[1]!;
  next.open();
  assert.deepEqual(next.json(), {
    type: "hello", protocol: 1, clientId: "test-web", topics: ["board"], resume: { epoch: "boot-a", seq: 43 },
  });
});

test("replayed and resynced topics are delivered only after the barrier", async () => {
  const fx = await readyFixture(["board", "sessions"]);
  fx.socket.serverClose(1006);
  fx.clock.advance(500);
  const next = fx.sockets[1]!;
  next.open();
  next.message({ ...fixture.resyncRequired, topics: ["sessions"] });
  next.message({ ...fixture.invalidate, epoch: "boot-b", seq: 1, version: 1 });
  fx.clock.advance(200);
  assert.equal(fx.listener.calls.length, 0, "held until ready");
  next.message({ ...fixture.ready, epoch: "boot-b", seq: 1, topics: ["board", "sessions"], versions: { board: 1, sessions: 0 } });
  fx.clock.advance(100);
  assert.deepEqual(fx.listener.calls.map((call) => call.topic).sort(), ["board", "sessions"]);
  assert.equal(fx.client.diagnostics().resyncs, 1);
});

test("backoff doubles from 500 ms to a 30 s cap with jitter", async () => {
  const fx = createFixture({ random: 1 });
  fx.client.subscribe("board", fx.listener);
  await settle();
  const delays: number[] = [];
  for (let i = 0; i < 9; i += 1) {
    fx.sockets.at(-1)!.serverClose(1006);
    const delay = fx.client.diagnostics().currentBackoffMs;
    delays.push(delay);
    // Exactly the backoff: the next attempt starts, and closes before its
    // own connect timeout could add another.
    fx.clock.advance(delay);
  }
  assert.deepEqual(delays.slice(0, 4), [600, 1200, 2400, 4800], "×1.2 at the top of the jitter band");
  assert.equal(delays.at(-1), EVENT_BACKOFF_MAX_MS, "never past the cap");
  const low = createFixture({ random: 0 });
  low.client.subscribe("board", low.listener);
  await settle();
  low.sockets[0]!.serverClose(1006);
  assert.equal(low.client.diagnostics().currentBackoffMs, 400, "×0.8 at the bottom");
});

test("a connect that never opens times out after 8 s and backs off", async () => {
  const fx = createFixture();
  fx.client.subscribe("board", fx.listener);
  await settle();
  fx.clock.advance(7_999);
  assert.equal(fx.client.state(), "connecting");
  fx.clock.advance(1);
  assert.equal(fx.sockets[0]!.closeReason, "connect timeout");
  assert.equal(fx.client.state(), "backing-off");
});

test("foreground retries at once without a second connection", async () => {
  const fx = await readyFixture(["board"]);
  fx.socket.serverClose(1006);
  fx.visibility.show();
  assert.equal(fx.sockets.length, 2, "one immediate attempt");
  fx.visibility.show();
  assert.equal(fx.sockets.length, 2, "no parallel connection");
});

test("the final unsubscribe cancels a pending backoff", async () => {
  const fx = await readyFixture(["board"]);
  fx.socket.serverClose(1006);
  fx.offs[0]!();
  fx.clock.advance(EVENT_BACKOFF_MAX_MS);
  assert.equal(fx.sockets.length, 1);
  assert.equal(fx.client.state(), "idle");
});

test("an invalid server message degrades and reconnects; a protocol refusal re-reads the capability", async () => {
  const fx = await readyFixture(["board"]);
  fx.socket.message(fixture.malformed.unknownTopic);
  assert.equal(fx.socket.closeCode, 4402);
  assert.equal(fx.client.diagnostics().invalidServerMessages, 1);
  assert.equal(fx.client.state(), "backing-off");
  fx.clock.advance(1_000);
  const second = fx.sockets[1]!;
  second.open();
  second.serverClose(4400, "unsupported protocol");
  const readsBefore = fx.capabilityReads();
  fx.clock.advance(EVENT_BACKOFF_MAX_MS);
  await settle();
  assert.equal(fx.capabilityReads(), readsBefore + 1);
  assert.ok(fx.client.diagnostics().fallbackActivations >= 1);
});

test("state changes notify useSyncExternalStore subscribers", async () => {
  const fx = createFixture();
  let changes = 0;
  fx.client.onChange(() => { changes += 1; });
  fx.client.subscribe("board", fx.listener);
  await settle();
  fx.sockets[0]!.open();
  fx.sockets[0]!.message({ ...fixture.ready, topics: ["board"], versions: { board: 0 } });
  assert.ok(changes >= 2, `changes: ${changes}`);
});

test("dispose closes everything", async () => {
  const fx = await readyFixture(["board"]);
  fx.client.dispose();
  assert.equal(fx.socket.closeReason, "disposed");
  assert.equal(fx.client.state(), "idle");
  assert.equal(fx.clock.pending(), 0);
});

test("polls avoided are counted for diagnostics (#5862)", () => {
  const fx = createFixture();
  assert.equal(fx.client.diagnostics().pollsAvoided, 0);
  fx.client.notePollAvoided();
  fx.client.notePollAvoided();
  assert.equal(fx.client.diagnostics().pollsAvoided, 2);
});
