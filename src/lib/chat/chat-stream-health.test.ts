import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chatStreamHealthReducer,
  EMPTY_CHAT_STREAM_CLIENT_HEALTH,
  streamHealthSummary,
} from "./chat-stream-health.ts";

describe("chatStreamHealthReducer", () => {
  it("tracks connect, event, resume, gap, and settle with transcript resync", () => {
    const dirty = chatStreamHealthReducer(EMPTY_CHAT_STREAM_CLIENT_HEALTH, {
      type: "degrade",
      at: "2026-07-19T22:36:25.641-05:00",
      error: "stale run",
    });
    let state = chatStreamHealthReducer(dirty, {
      type: "connect",
      runId: "run-1",
      at: "2026-07-19T22:36:26.641-05:00",
    });
    assert.equal(state.lastError, null);
    assert.equal(state.needsTranscriptResync, false);
    state = chatStreamHealthReducer(state, {
      type: "event",
      cursor: 10,
      at: "2026-07-19T22:36:27.641-05:00",
    });
    state = chatStreamHealthReducer(state, {
      type: "resume",
      at: "2026-07-19T22:36:28.641-05:00",
      error: "webview disconnected",
    });
    state = chatStreamHealthReducer(state, {
      type: "gap",
      at: "2026-07-19T22:36:29.641-05:00",
    });
    state = chatStreamHealthReducer(state, {
      type: "event",
      cursor: 11,
      at: "2026-07-19T22:36:29.741-05:00",
    });
    assert.equal(state.phase, "degraded");
    assert.equal(streamHealthSummary(state).tone, "danger");
    assert.equal(streamHealthSummary(state).label, "Degraded");
    state = chatStreamHealthReducer(state, {
      type: "settle",
      at: "2026-07-19T22:36:30.641-05:00",
    });

    assert.equal(state.phase, "settled");
    assert.equal(state.runId, "run-1");
    assert.equal(state.cursor, 11);
    assert.equal(state.resumeAttempts, 1);
    assert.equal(state.lastError, "webview disconnected");
    assert.equal(state.gapDetected, true);
    assert.equal(state.needsTranscriptResync, true);
    assert.equal(streamHealthSummary(state).label, "Settled with transcript resync");
  });

  it("marks degraded streams as danger and stopped streams as muted without resync", () => {
    const degraded = chatStreamHealthReducer(EMPTY_CHAT_STREAM_CLIENT_HEALTH, {
      type: "degrade",
      at: "2026-07-19T22:36:26.641-05:00",
      error: "backend timeout",
    });
    const stopped = chatStreamHealthReducer(EMPTY_CHAT_STREAM_CLIENT_HEALTH, {
      type: "stop",
      at: "2026-07-19T22:36:26.641-05:00",
    });

    assert.equal(degraded.phase, "degraded");
    assert.equal(degraded.needsTranscriptResync, true);
    assert.equal(streamHealthSummary(degraded).tone, "danger");
    assert.equal(stopped.phase, "stopped");
    assert.equal(stopped.needsTranscriptResync, false);
    assert.equal(streamHealthSummary(stopped).tone, "muted");
  });

  it("treats stale cursors as no-ops while allowing repeated cursors to refresh lastEventAt", () => {
    assert.deepEqual(streamHealthSummary(EMPTY_CHAT_STREAM_CLIENT_HEALTH), {
      label: "Idle",
      tone: "muted",
    });
    const advanced = chatStreamHealthReducer(EMPTY_CHAT_STREAM_CLIENT_HEALTH, {
      type: "event",
      cursor: 8,
      at: "2026-07-19T22:36:26.641-05:00",
    });
    const regressed = chatStreamHealthReducer(advanced, {
      type: "event",
      cursor: 3,
      at: "2026-07-19T22:36:27.641-05:00",
    });
    const repeated = chatStreamHealthReducer(advanced, {
      type: "event",
      cursor: 8,
      at: "2026-07-19T22:36:28.641-05:00",
    });
    const reset = chatStreamHealthReducer(regressed, { type: "reset" });

    assert.equal(regressed.cursor, 8);
    assert.strictEqual(regressed, advanced);
    assert.notStrictEqual(repeated, advanced);
    assert.equal(repeated.cursor, 8);
    assert.equal(repeated.lastEventAt, "2026-07-19T22:36:28.641-05:00");
    assert.equal(reset, EMPTY_CHAT_STREAM_CLIENT_HEALTH);
  });

  it("hydrates the exact persisted health snapshot", () => {
    const persisted = Object.freeze({
      phase: "resuming" as const,
      runId: "run-restored",
      cursor: 17,
      resumeAttempts: 2,
      gapDetected: true,
      needsTranscriptResync: true,
      lastEventAt: "2026-07-20T00:01:00.000-05:00",
      lastErrorAt: "2026-07-20T00:00:59.000-05:00",
      lastError: "webview disconnected",
    });

    const hydrated = chatStreamHealthReducer(EMPTY_CHAT_STREAM_CLIENT_HEALTH, {
      type: "hydrate",
      health: persisted,
    });

    assert.strictEqual(hydrated, persisted);
  });
});
