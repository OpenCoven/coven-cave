// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { reduce, initialState } from "./voice-call-overlay-state.ts";

test("idle → requesting-mic on START", () => {
  const next = reduce(initialState, { type: "START" });
  assert.equal(next.state, "requesting-mic");
});

test("requesting-mic → minting-session on MIC_READY", () => {
  const s = reduce(initialState, { type: "START" });
  const next = reduce(s, { type: "MIC_READY" });
  assert.equal(next.state, "minting-session");
});

test("requesting-mic → error on MIC_DENIED", () => {
  const s = reduce(initialState, { type: "START" });
  const next = reduce(s, { type: "MIC_DENIED" });
  assert.equal(next.state, "error");
  assert.equal(next.errorCode, "microphone_denied");
});

test("minting-session → connecting on SESSION_GRANTED", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  const next = reduce(s, { type: "SESSION_GRANTED", callId: "c1" });
  assert.equal(next.state, "connecting");
  assert.equal(next.callId, "c1");
});

test("minting-session → error with vault hint on SESSION_FAILED with missingKey", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  const next = reduce(s, {
    type: "SESSION_FAILED",
    errorCode: "vault_key_unresolved",
    missingKey: "OPENAI_API_KEY",
    hint: "Set OPENAI_API_KEY",
  });
  assert.equal(next.state, "error");
  assert.equal(next.errorCode, "vault_key_unresolved");
  assert.equal(next.missingKey, "OPENAI_API_KEY");
});

test("connecting → live on CONNECTED", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  s = reduce(s, { type: "SESSION_GRANTED", callId: "c1" });
  const next = reduce(s, { type: "CONNECTED", startedAt: Date.now() });
  assert.equal(next.state, "live");
  assert.equal(typeof next.startedAt, "number");
});

test("connecting → closed on CLOSE_REQUEST (clean cancel, no error)", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  s = reduce(s, { type: "SESSION_GRANTED", callId: "c1" });
  const next = reduce(s, { type: "CLOSE_REQUEST" });
  assert.equal(next.state, "closed");
  assert.equal(next.errorCode, undefined);
});

test("live → ending on CLOSE_REQUEST", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  s = reduce(s, { type: "SESSION_GRANTED", callId: "c1" });
  s = reduce(s, { type: "CONNECTED", startedAt: 0 });
  const next = reduce(s, { type: "CLOSE_REQUEST" });
  assert.equal(next.state, "ending");
});

test("ending → closed on DISCONNECTED", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  s = reduce(s, { type: "SESSION_GRANTED", callId: "c1" });
  s = reduce(s, { type: "CONNECTED", startedAt: 0 });
  s = reduce(s, { type: "CLOSE_REQUEST" });
  const next = reduce(s, { type: "DISCONNECTED" });
  assert.equal(next.state, "closed");
});

test("live → error on PROVIDER_ERROR", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  s = reduce(s, { type: "SESSION_GRANTED", callId: "c1" });
  s = reduce(s, { type: "CONNECTED", startedAt: 0 });
  const next = reduce(s, { type: "PROVIDER_ERROR", errorCode: "connect_failed" });
  assert.equal(next.state, "error");
  assert.equal(next.errorCode, "connect_failed");
});

test("error → requesting-mic on RETRY (clears errorCode)", () => {
  const errored = reduce(reduce(initialState, { type: "START" }), { type: "MIC_DENIED" });
  const next = reduce(errored, { type: "RETRY" });
  assert.equal(next.state, "requesting-mic");
  assert.equal(next.errorCode, undefined);
});

test("muted is local-only state, toggled by MUTE_TOGGLE", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  s = reduce(s, { type: "SESSION_GRANTED", callId: "c1" });
  s = reduce(s, { type: "CONNECTED", startedAt: 0 });
  assert.equal(s.muted, false);
  s = reduce(s, { type: "MUTE_TOGGLE" });
  assert.equal(s.muted, true);
  s = reduce(s, { type: "MUTE_TOGGLE" });
  assert.equal(s.muted, false);
});
