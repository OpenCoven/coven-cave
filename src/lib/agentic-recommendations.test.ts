import assert from "node:assert/strict";
import {
  AGENTIC_EVIDENCE_KINDS,
  AGENTIC_RECOMMENDATION_KINDS,
  AGENTIC_SURFACES,
  AUTO_APPLY_RECOMMENDATION_KINDS,
  contextFingerprint,
  isAutoApplyAllowed,
  isRecommendationContextStale,
  parseAgenticRecommendationsOutput,
  rankAgenticRecommendations,
} from "./agentic-recommendations.ts";

const context = {
  cardId: "card-42",
  dependencies: ["task-11"],
  title: "Ship the verified recommendation contract",
};
const fingerprint = contextFingerprint(context);

function recommendation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "rec-1",
    surface: "board",
    kind: "action",
    payload: { targetId: "card-42" },
    rationale: "The card has enough verified context for a reviewable action.",
    inferredGoal: "Complete the contract safely.",
    rankReasons: ["verified board context", "matches the inferred goal"],
    evidenceRefs: [{ id: "task-11", kind: "task", label: "Implement agentic contract" }],
    contextFingerprint: fingerprint,
    verification: {
      status: "verified",
      checks: [{ id: "board-context", state: "passed", detail: "The task reference resolves." }],
    },
    application: { mode: "review", requiresApproval: true, reversible: true },
    ...overrides,
  };
}

function output(recommendations: Record<string, unknown>[]): string {
  return JSON.stringify({ recommendations });
}

function expectRejected(text: string, code: string): void {
  assert.throws(
    () => parseAgenticRecommendationsOutput(text),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { code?: unknown }).code, code);
      assert.doesNotMatch(error.message, /Bearer|task-11|rec-1/, "parse errors never echo model content");
      return true;
    },
  );
}

// Strict tagged/JSON extraction accepts only a complete contract payload.
const tagged = `<recommendations>\n${output([recommendation()])}\n</recommendations>`;
const extracted = parseAgenticRecommendationsOutput(tagged);
assert.equal(extracted.length, 1);
assert.equal(extracted[0]?.surface, "board");
assert.equal(extracted[0]?.verification.status, "verified");
assert.equal(extracted[0]?.evidenceRefs[0]?.kind, "task");
assert.equal(
  parseAgenticRecommendationsOutput(`\`\`\`json\n${output([recommendation({ id: "rec-fenced" })])}\n\`\`\``)[0]?.id,
  "rec-fenced",
  "a complete JSON fence is repository-consistent model output",
);
expectRejected(`Preamble\n${output([recommendation()])}`, "invalid_envelope");
expectRejected(output([{ ...recommendation(), unexpected: true }]), "invalid_recommendation");
expectRejected(
  `<recommendations>\n${output([])}\n</recommendations>`.padEnd(64 * 1024 + 1, " "),
  "output_too_large",
);

// The surface and recommendation-kind allowlists are explicit and exhaustive.
assert.deepEqual(AGENTIC_SURFACES, ["board", "research", "chat"]);
for (const surface of AGENTIC_SURFACES) {
  assert.equal(parseAgenticRecommendationsOutput(output([recommendation({ id: `rec-${surface}`, surface })]))[0]?.surface, surface);
}
for (const kind of AGENTIC_RECOMMENDATION_KINDS) {
  assert.equal(parseAgenticRecommendationsOutput(output([recommendation({ id: `rec-${kind}`, kind })]))[0]?.kind, kind);
}
assert.deepEqual(AGENTIC_EVIDENCE_KINDS, [
  "task",
  "dependency",
  "github",
  "mission",
  "saved-link",
  "vault",
  "message",
  "artifact",
]);
for (const kind of AGENTIC_EVIDENCE_KINDS) {
  const parsed = parseAgenticRecommendationsOutput(output([recommendation({
    id: `evidence-${kind}`,
    evidenceRefs: [{ id: `ref-${kind}`, kind, label: `${kind} evidence` }],
  })]))[0]!;
  assert.equal(parsed.evidenceRefs[0]?.kind, kind);
}
expectRejected(output([recommendation({ surface: "canvas" })]), "unknown_surface");
expectRejected(output([recommendation({ kind: "future-kind" })]), "unknown_kind");
expectRejected(output([recommendation({ kind: "x".repeat(65) })]), "kind_too_long");
expectRejected(output([recommendation({ confidence: 0.99 })]), "invalid_recommendation");
expectRejected(
  output([recommendation({ verification: { status: "verified", checks: [] } })]),
  "invalid_verified_checks",
);
expectRejected(
  output([recommendation({
    verification: {
      status: "verified",
      checks: [{ id: "still-running", state: "pending", detail: "The verification has not completed." }],
    },
  })]),
  "invalid_verified_checks",
);
expectRejected(
  output([recommendation({
    verification: {
      status: "verified",
      checks: [{ id: "failed-check", state: "failed", detail: "The verification failed." }],
    },
  })]),
  "invalid_verified_checks",
);

// IDs and evidence are a trust boundary, not model-authored labels to accept blindly.
expectRejected(output([recommendation(), recommendation({ id: "rec-1" })]), "duplicate_id");
expectRejected(
  output([recommendation({
    evidenceRefs: [{
      id: "issue-8",
      kind: "github",
      label: `Authorization: Bearer ${"a".repeat(32)}`,
    }],
  })]),
  "secret_evidence",
);
for (const label of [
  `Authorization: Bearer ${"a".repeat(32)}`,
  "API_KEY=synthetic-credential-value",
  JSON.stringify({ client_secret: "synthetic-credential-value" }),
]) {
  expectRejected(
    output([recommendation({
      id: `secret-evidence-${label.length}`,
      evidenceRefs: [{ id: "issue-8", kind: "github", label }],
    })]),
    "secret_evidence",
  );
}
const safeEvidenceLabels = [
  "Authorization: migrate to OAuth 2.1",
  '{ "safe": "value" }',
];
for (const [index, label] of safeEvidenceLabels.entries()) {
  const parsed = parseAgenticRecommendationsOutput(output([recommendation({
    id: `safe-evidence-${index}`,
    evidenceRefs: [{ id: "issue-8", kind: "github", label }],
  })]))[0]!;
  assert.equal(parsed.evidenceRefs[0]?.label, label, "safe evidence text survives strict parsing");
}

// Fingerprints are canonical across object key order and detect a stale recommendation.
assert.equal(
  contextFingerprint({ title: context.title, dependencies: context.dependencies, cardId: context.cardId }),
  fingerprint,
  "key ordering does not change a context fingerprint",
);
assert.notEqual(contextFingerprint({ ...context, title: "Different goal" }), fingerprint);
assert.equal(isRecommendationContextStale(extracted[0]!, context), false);
assert.equal(isRecommendationContextStale(extracted[0]!, { ...context, dependencies: [] }), true);
const nullPrototypeContext = Object.assign(Object.create(null) as Record<string, unknown>, context);
assert.equal(
  contextFingerprint(nullPrototypeContext),
  fingerprint,
  "null-prototype plain objects remain valid fingerprint contexts",
);
class ContextInstance {
  value = "context";
}
assert.throws(
  () => contextFingerprint(new Date(0)),
  /plain object/,
  "Date contexts cannot collide with an empty plain-object fingerprint",
);
assert.throws(
  () => contextFingerprint(new ContextInstance()),
  /plain object/,
  "class instances are not JSON plain-object contexts",
);
assert.throws(() => contextFingerprint({ value: () => "context" }), /function/);
assert.throws(() => contextFingerprint({ value: Symbol("context") }), /symbol/);
assert.throws(() => contextFingerprint({ value: BigInt(1) }), /bigint/);
assert.throws(() => contextFingerprint({ value: Number.NaN }), /non-finite/);
const cyclicContext: Record<string, unknown> = {};
cyclicContext.self = cyclicContext;
assert.throws(() => contextFingerprint(cyclicContext), /cycles/);

// Ranking is qualitative, dense ordinal, and preserves model order inside a tie.
const ranked = rankAgenticRecommendations(parseAgenticRecommendationsOutput(output([
  recommendation({
    id: "proposal-first",
    verification: { status: "proposal", checks: [{ id: "needs-review", state: "pending", detail: "Awaiting review." }] },
  }),
  recommendation({ id: "verified-first" }),
  recommendation({ id: "verified-second" }),
  recommendation({
    id: "blocked-last",
    verification: { status: "blocked", checks: [{ id: "missing-evidence", state: "failed", detail: "No evidence." }] },
  }),
])));
assert.deepEqual(
  ranked.map(({ id, ordinal }) => ({ id, ordinal })),
  [
    { id: "verified-first", ordinal: 1 },
    { id: "verified-second", ordinal: 1 },
    { id: "proposal-first", ordinal: 2 },
    { id: "blocked-last", ordinal: 3 },
  ],
  "qualitative tiers receive adaptive ordinal ranks with stable ties",
);
const rankedWithoutProposal = rankAgenticRecommendations(parseAgenticRecommendationsOutput(output([
  recommendation({
    id: "blocked-without-proposal",
    verification: { status: "blocked", checks: [{ id: "missing-proof", state: "failed", detail: "No proof." }] },
  }),
  recommendation({ id: "verified-without-proposal" }),
])));
assert.deepEqual(
  rankedWithoutProposal.map(({ id, ordinal }) => ({ id, ordinal })),
  [
    { id: "verified-without-proposal", ordinal: 1 },
    { id: "blocked-without-proposal", ordinal: 2 },
  ],
  "missing tiers still receive dense ordinals in deterministic tier order",
);
assert.doesNotMatch(JSON.stringify(ranked), /confidence/i, "the contract never emits numeric confidence");
const verifiedForDefensiveRanking = parseAgenticRecommendationsOutput(output([
  recommendation({ id: "genuinely-verified" }),
]))[0]!;
const defensiveRanking = rankAgenticRecommendations([
  verifiedForDefensiveRanking,
  {
    ...verifiedForDefensiveRanking,
    id: "inconsistent-verified",
    verification: { status: "verified" as const, checks: [] },
  },
  {
    ...verifiedForDefensiveRanking,
    id: "ordinary-proposal",
    verification: {
      status: "proposal" as const,
      checks: [{ id: "awaiting-review", state: "pending" as const, detail: "Awaiting review." }],
    },
  },
]);
assert.deepEqual(
  defensiveRanking.map(({ id, ordinal }) => ({ id, ordinal })),
  [
    { id: "genuinely-verified", ordinal: 1 },
    { id: "inconsistent-verified", ordinal: 2 },
    { id: "ordinary-proposal", ordinal: 2 },
  ],
  "inconsistent verified data receives the review tier rather than the verified tier",
);

// Auto-application has a small, exact, review-independent allowlist.
assert.deepEqual(AUTO_APPLY_RECOMMENDATION_KINDS, [
  "reference-canonicalization",
  "reference-deduplication",
  "identifier-normalization",
  "read-only-projection",
]);
for (const kind of AUTO_APPLY_RECOMMENDATION_KINDS) {
  const auto = recommendation({
    id: `auto-${kind}`,
    kind,
    application: { mode: "auto-apply", requiresApproval: false, reversible: true },
  });
  const parsed = parseAgenticRecommendationsOutput(output([auto]))[0]!;
  assert.equal(isAutoApplyAllowed(parsed), true, `${kind} is explicitly allowlisted`);
}
const verifiedAuto = parseAgenticRecommendationsOutput(output([recommendation({
  id: "verified-auto",
  kind: "reference-canonicalization",
  application: { mode: "auto-apply", requiresApproval: false, reversible: true },
})]))[0]!;
for (const checks of [
  [],
  [{ id: "pending-check", state: "pending" as const, detail: "Awaiting verification." }],
  [{ id: "failed-check", state: "failed" as const, detail: "Verification failed." }],
]) {
  assert.equal(
    isAutoApplyAllowed({ ...verifiedAuto, verification: { status: "verified", checks } }),
    false,
    "auto-application independently requires nonempty all-passed verification",
  );
}
for (const kind of ["prose", "dependency", "topic", "action"]) {
  const unsafe = recommendation({
    id: `unsafe-${kind}`,
    kind,
    application: { mode: "auto-apply", requiresApproval: false, reversible: true },
  });
  expectRejected(output([unsafe]), "auto_apply_forbidden");
}

console.log("agentic-recommendations.test.ts passed");
