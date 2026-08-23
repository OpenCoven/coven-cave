import assert from "node:assert/strict";
import {
  AGENTIC_DIAGNOSTIC_CODES,
  createAgenticDiagnosticRing,
} from "./agentic-diagnostics.ts";

const delivered: unknown[] = [];
const diagnostics = createAgenticDiagnosticRing(
  (event) => delivered.push(event),
  2,
);

const first = diagnostics.record({
  surface: "board",
  code: "stale_discarded",
  counts: { recommendations: 3, verificationChecks: 2 },
  timestamp: "2026-08-19T18:00:00.000Z",
  recommendationId: "customer-private-model-request",
  runId: "request-42",
} as never);

assert.deepEqual(first, {
  schemaVersion: 1,
  surface: "board",
  code: "stale_discarded",
  status: "discarded",
  counts: { recommendations: 3, verificationChecks: 2 },
  timestamp: "2026-08-19T18:00:00.000Z",
});
assert.equal(delivered.length, 1);
assert.doesNotMatch(
  JSON.stringify(first),
  /customer-private-model-request|request-42/,
  "diagnostics never retain external identifiers",
);

const sanitized = diagnostics.record({
  surface: "research",
  code: "vault_context_reduced",
  recommendationId: "Authorization: Bearer secret",
  runId: "x".repeat(97),
  counts: {
    recommendations: 999,
    verificationChecks: -1,
    ignored: 3,
  } as never,
  timestamp: "not-a-timestamp",
} as never);

assert.deepEqual(sanitized, {
  schemaVersion: 1,
  surface: "research",
  code: "vault_context_reduced",
  status: "reduced",
  counts: { recommendations: 256 },
  timestamp: sanitized?.timestamp,
});
assert.ok(sanitized);
assert.match(sanitized.timestamp, /^\d{4}-\d{2}-\d{2}T/);

diagnostics.record({
  surface: "board",
  code: "verification_blocked",
  counts: { recommendations: 1 },
});
assert.equal(diagnostics.events().length, 2, "the ring is bounded");
assert.deepEqual(
  diagnostics.events().map((event) => event.code),
  ["vault_context_reduced", "verification_blocked"],
);

for (const maximum of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
  const fallback = createAgenticDiagnosticRing(undefined, maximum);
  for (let index = 0; index < 65; index += 1) {
    fallback.record({ surface: "chat", code: "cancelled" });
  }
  assert.equal(
    fallback.events().length,
    64,
    `${String(maximum)} falls back to the bounded default`,
  );
}

assert.deepEqual(AGENTIC_DIAGNOSTIC_CODES, [
  "stale_discarded",
  "verification_blocked",
  "vault_context_reduced",
  "apply_failed",
  "cancelled",
  "generation_validation_failed",
]);

console.log("agentic-diagnostics.test.ts: ok");
