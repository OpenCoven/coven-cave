import assert from "node:assert/strict";
import test from "node:test";

import { createStreamingTurnViewModel } from "./streaming-turn-view-model.ts";

const input = (overrides: Record<string, unknown> = {}) => ({
  turnId: "assistant-1",
  visibleText: "",
  pending: true,
  lifecycle: "streaming" as const,
  failed: false,
  authoredResults: [],
  verifiedResults: [],
  progress: [],
  tools: [],
  ...overrides,
});

test("status moves from working to answering and settles honestly", () => {
  assert.equal(createStreamingTurnViewModel(input()).status, "working");
  assert.equal(createStreamingTurnViewModel(input({ visibleText: "Hello" })).status, "answering");
  assert.equal(createStreamingTurnViewModel(input({ pending: false, lifecycle: "complete" })).status, "complete");
  assert.equal(createStreamingTurnViewModel(input({ pending: false, lifecycle: "cancelled" })).status, "interrupted");
  assert.equal(createStreamingTurnViewModel(input({ pending: false, lifecycle: "failed", failed: true })).status, "failed");
});

test("current activity replaces in place without losing chronology", () => {
  const model = createStreamingTurnViewModel(
    input({
      progress: [
        { id: "scan", label: "Scanning", status: "done", createdAt: "2026-08-08T10:00:00Z" },
        { id: "tests", label: "Testing", status: "running", createdAt: "2026-08-08T10:00:01Z" },
      ],
    }),
  );

  assert.equal(model.activity.length, 2);
  assert.deepEqual(model.activity.map((event) => event.id), ["progress:scan", "progress:tests"]);
  assert.equal(model.currentActivity?.id, "progress:tests");
  assert.equal(model.currentActivity?.label, "Testing");
});

test("tool activity uses product copy and never raw arguments or names", () => {
  const model = createStreamingTurnViewModel(
    input({
      tools: [{ id: "grep-1", name: "Grep", input: '{"pattern":"secret"}', status: "running" }],
    }),
  );

  assert.equal(model.currentActivity?.label, "Searching the chat implementation…");
  assert.doesNotMatch(model.currentActivity?.label ?? "", /secret|Grep/);
});

test("trusted failure cannot be overwritten by an authored pass", () => {
  const model = createStreamingTurnViewModel(
    input({
      authoredResults: [{ id: "same", label: "Tests passed", state: "passed", source: "familiar" }],
      verifiedResults: [
        { id: "same", kind: "test", label: "Tests failed", state: "failed", source: "verified-event" },
      ],
    }),
  );

  assert.deepEqual(model.results, [
    { id: "same", label: "Tests failed", state: "failed", source: "verified-event" },
  ]);
});

test("interruption settles prose and downgrades unproved running rows while preserving passed rows", () => {
  const model = createStreamingTurnViewModel(
    input({
      visibleText: "Partial answer",
      pending: false,
      lifecycle: "cancelled",
      authoredResults: [
        { id: "visual", label: "Visual check", state: "running", source: "familiar" },
        { id: "tests", label: "Tests passed", state: "passed", source: "familiar" },
      ],
    }),
  );

  assert.equal(model.status, "interrupted");
  assert.equal(model.activeBlock, null);
  assert.equal(model.committedText, "Partial answer");
  assert.equal(model.results.find((row) => row.id === "visual")?.state, "pending");
  assert.equal(model.results.find((row) => row.id === "tests")?.state, "passed");
});

test("unknown tools fall back to Working…", () => {
  const model = createStreamingTurnViewModel(
    input({
      tools: [{ id: "read-1", name: "Read", input: '{"path":"README.md"}', status: "running" }],
    }),
  );

  assert.equal(model.currentActivity?.label, "Working…");
});

test("unknown tools stay neutral even when inputs and outputs contain activity keywords", () => {
  const model = createStreamingTurnViewModel(
    input({
      tools: [
        {
          id: "mystery-1",
          name: "Read",
          input: '{"path":"docs/review.md","command":"pnpm build && pnpm test"}',
          output: "search test build review",
          status: "running",
        },
      ],
    }),
  );

  assert.equal(model.currentActivity?.label, "Working…");
  assert.equal(model.currentActivity?.detail, undefined);
  assert.doesNotMatch(model.currentActivity?.label ?? "", /search|test|build|review|docs\/review\.md/i);
});

test("latest running progress wins over a later settled event", () => {
  const model = createStreamingTurnViewModel(
    input({
      progress: [
        { id: "tests", label: "Testing", status: "running", createdAt: "2026-08-08T10:00:00Z" },
        { id: "summary", label: "Summarized", status: "done", createdAt: "2026-08-08T10:00:01Z" },
      ],
    }),
  );

  assert.equal(model.currentActivity?.id, "progress:tests");
  assert.equal(model.currentActivity?.state, "running");
});

test("duplicate labels with distinct ids remain distinct", () => {
  const model = createStreamingTurnViewModel(
    input({
      authoredResults: [
        { id: "tests-a", label: "Focused tests passed", state: "passed", source: "familiar" },
        { id: "tests-b", label: "Focused tests passed", state: "passed", source: "familiar" },
      ],
    }),
  );

  assert.deepEqual(model.results.map((row) => row.id), ["tests-a", "tests-b"]);
});

test("verified rows win over authored rows with the same id", () => {
  const model = createStreamingTurnViewModel(
    input({
      authoredResults: [{ id: "same", label: "Build pending", state: "pending", source: "familiar" }],
      verifiedResults: [
        { id: "same", kind: "build", label: "Production build passed", state: "passed", source: "verified-event" },
      ],
    }),
  );

  assert.deepEqual(model.results, [
    { id: "same", label: "Production build passed", state: "passed", source: "verified-event" },
  ]);
});

test("empty successful turn exposes emptySuccessful", () => {
  const model = createStreamingTurnViewModel(input({ pending: false, lifecycle: "complete" }));

  assert.equal(model.status, "complete");
  assert.equal(model.emptySuccessful, true);
});

test("failure preserves passed rows, trusted failures, and downgrades unrelated running rows", () => {
  const model = createStreamingTurnViewModel(
    input({
      pending: false,
      lifecycle: "failed",
      failed: true,
      authoredResults: [
        { id: "tests", label: "Focused tests passed", state: "passed", source: "familiar" },
        { id: "visual", label: "Visual check", state: "running", source: "familiar" },
      ],
      verifiedResults: [
        { id: "build", kind: "build", label: "Production build failed", state: "failed", source: "verified-event" },
      ],
    }),
  );

  assert.deepEqual(model.results, [
    { id: "tests", label: "Focused tests passed", state: "passed", source: "familiar" },
    { id: "visual", label: "Visual check", state: "attention", source: "familiar" },
    { id: "build", label: "Production build failed", state: "failed", source: "verified-event" },
  ]);
});
