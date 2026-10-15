/**
 * A deterministic event-plane workload for the performance report (#5862).
 *
 * It drives the real broker in process with in-memory sockets: subscribers on
 * several topics, a burst of invalidations, one slow consumer and one resume
 * cursor older than the replay ring. The report then records the broker's own
 * aggregate counters, so a change that stops counting invalidations, replay
 * gaps or slow-consumer closures shows up as a moved number.
 *
 * Counters only: no epoch, cursor, entity id or payload leaves this module.
 */

import {
  createEventBroker,
  summarizeEventPlaneDiagnostics,
} from "../src/lib/server/cave-event-broker.ts";

export const EVENT_PLANE_WORKLOAD = Object.freeze({
  boardSubscribers: 32,
  sessionsSubscribers: 16,
  bothSubscribers: 15,
  slowSubscribers: 1,
  invalidations: 200,
  ringCountLimit: 64,
  topics: Object.freeze(["board", "sessions", "familiars", "daemon"]),
});

class MemorySocket {
  bufferedAmount = 0;
  sent = 0;
  handlers = null;
  send() { this.sent += 1; }
  close() {}
  ping() {}
  terminate() {}
  hello(topics, resume) {
    const message = { type: "hello", protocol: 1, clientId: "performance-report", topics, ...(resume ? { resume } : {}) };
    this.handlers.message(Buffer.from(JSON.stringify(message)), false);
  }
}

export function measureEventPlaneWorkload(workload = EVENT_PLANE_WORKLOAD) {
  const broker = createEventBroker({
    ringCountLimit: workload.ringCountLimit,
    bufferedAmountLimit: 1024,
    newEpoch: () => "performance-report",
    setInterval: () => 0,
    clearInterval: () => {},
  });
  const connect = (topics) => {
    const socket = new MemorySocket();
    socket.handlers = broker.attach(socket);
    socket.hello(topics);
    return socket;
  };
  for (let i = 0; i < workload.boardSubscribers; i += 1) connect(["board"]);
  for (let i = 0; i < workload.sessionsSubscribers; i += 1) connect(["sessions"]);
  for (let i = 0; i < workload.bothSubscribers; i += 1) connect(["board", "sessions"]);
  for (let i = 0; i < workload.slowSubscribers; i += 1) {
    const slow = connect(["daemon"]);
    slow.bufferedAmount = 4096;
  }
  for (let i = 0; i < workload.invalidations; i += 1) {
    broker.publish(workload.topics[i % workload.topics.length]);
  }
  // A client returning with a cursor the ring no longer holds.
  const returning = new MemorySocket();
  returning.handlers = broker.attach(returning);
  returning.hello(["board"], { epoch: "performance-report", seq: 1 });

  const summary = summarizeEventPlaneDiagnostics(broker.diagnostics());
  broker.shutdown();
  return {
    workload: { ...workload, topics: [...workload.topics] },
    invalidationsByTopic: summary.invalidations,
    replayGaps: summary.replayGaps,
    activeConnections: summary.activeConnections,
    subscriptions: summary.subscriptions,
    slowConsumerCloses: summary.slowConsumerCloses,
  };
}
