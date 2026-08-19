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
  verifyAutoApplicableRecommendation,
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
    ...overrides,
  };
}

function autoPayload(kind: string): Record<string, unknown> {
  switch (kind) {
    case "canonicalize-reference":
      return { canonicalUrl: "https://example.invalid/reference", referenceId: "reference-42" };
    case "deduplicate-reference":
      return { canonicalReferenceId: "reference-42", duplicateReferenceId: "reference-43" };
    case "identifier-normalization":
      return { entityId: "card-42", normalizedIdentifier: "card-42" };
    case "recompute-readonly-projection":
      return { entityId: "card-42", projection: "dependency-summary" };
    default:
      throw new Error(`missing auto payload fixture for ${kind}`);
  }
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
assert.deepEqual(
  extracted[0]?.verification,
  { status: "proposal", checks: [] },
  "model output always enters as an unverified proposal",
);
assert.deepEqual(
  extracted[0]?.application,
  { mode: "review", requiresApproval: true, reversible: false },
  "model output always enters review mode",
);
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
  assert.equal(parseAgenticRecommendationsOutput(output([recommendation({
    id: `rec-${kind}`,
    kind,
    payload: AUTO_APPLY_RECOMMENDATION_KINDS.includes(kind as never)
      ? autoPayload(kind)
      : { targetId: "card-42" },
  })]))[0]?.kind, kind);
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
  output([recommendation({
    verification: {
      status: "verified",
      checks: [{ id: "model-claimed-check", state: "passed", detail: "A model cannot verify itself." }],
    },
  })]),
  "invalid_recommendation",
);
expectRejected(
  output([{
    ...recommendation(),
    adapterChecks: [{ id: "model-claimed-check", state: "passed", detail: "A model cannot verify itself." }],
  }]),
  "invalid_recommendation",
);
expectRejected(
  output([recommendation({
    application: { mode: "auto-apply", requiresApproval: false, reversible: true },
  })]),
  "invalid_recommendation",
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
  "Authorization: Basic authentication is disabled",
  "Commit 0123456789abcdef0123456789abcdef01234567",
  JSON.stringify({ commit: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }),
  '{ "safe": "value" }',
];
for (const [index, label] of safeEvidenceLabels.entries()) {
  const parsed = parseAgenticRecommendationsOutput(output([recommendation({
    id: `safe-evidence-${index}`,
    evidenceRefs: [{ id: "issue-8", kind: "github", label }],
  })]))[0]!;
  assert.equal(parsed.evidenceRefs[0]?.label, label, "safe evidence text survives strict parsing");
}
const gitCommitOid = "0123456789abcdef0123456789abcdef01234567";
const safeGitHubCommitEvidence = parseAgenticRecommendationsOutput(output([recommendation({
  id: "safe-github-commit-evidence",
  evidenceRefs: [{ id: gitCommitOid, kind: "github", label: `Commit SHA ${gitCommitOid}` }],
})]))[0]!;
assert.equal(
  safeGitHubCommitEvidence.evidenceRefs[0]?.id,
  gitCommitOid,
  "an exact Git OID is safe GitHub evidence",
);
const safeGitHubSha256Evidence = parseAgenticRecommendationsOutput(output([recommendation({
  id: "safe-github-sha256-evidence",
  evidenceRefs: [{ id: "a".repeat(64), kind: "github", label: "GitHub SHA-256 evidence" }],
})]))[0]!;
assert.equal(
  safeGitHubSha256Evidence.evidenceRefs[0]?.id,
  "a".repeat(64),
  "a SHA-256 OID is exempt only when the evidence is explicitly GitHub evidence",
);
for (const kind of ["task", "dependency", "saved-link"] as const) {
  for (const credentialShapedId of ["a".repeat(40), "a".repeat(64)]) {
    expectRejected(
      output([recommendation({
        id: `credential-shaped-${kind}-${credentialShapedId.length}-id`,
        evidenceRefs: [{ id: credentialShapedId, kind, label: `${kind} evidence` }],
      })]),
      "secret_evidence",
    );
  }
}
expectRejected(
  output([recommendation({
    id: `ghp_${"a".repeat(36)}`,
    evidenceRefs: [{ id: `ghp_${"a".repeat(36)}`, kind: "github", label: `Commit SHA ${gitCommitOid}` }],
  })]),
  "secret_evidence",
);
for (const secretText of [`Bearer ${"a".repeat(32)}`, `ghp_${"a".repeat(36)}`]) {
  expectRejected(
    output([recommendation({
      id: "safe-github-commit-with-extra-text",
      evidenceRefs: [{ id: gitCommitOid, kind: "github", label: `Commit SHA ${gitCommitOid}; ${secretText}` }],
    })]),
    "secret_evidence",
  );
}
expectRejected(
  output([recommendation({
    id: "unscoped-hex-evidence",
    evidenceRefs: [{ id: "issue-8", kind: "github", label: "a".repeat(64) }],
  })]),
  "secret_evidence",
);

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
let laterPropertyDescriptorReads = 0;
const oversizedContext = new Proxy({}, {
  ownKeys: () => ["aOversized", "zLater"],
  getOwnPropertyDescriptor: (_target, key) => {
    if (key === "zLater") laterPropertyDescriptorReads += 1;
    return {
      configurable: true,
      enumerable: true,
      value: key === "aOversized" ? "x".repeat(16 * 1024) : "must-not-be-read",
      writable: true,
    };
  },
});
assert.throws(
  () => contextFingerprint(oversizedContext),
  /context is too large to fingerprint/,
  "oversized canonical context rejects with the bounded safe error",
);
assert.equal(
  laterPropertyDescriptorReads,
  0,
  "canonicalization stops before inspecting later values after exceeding the UTF-8 budget",
);

// Auto-application has a small, exact allowlist with strict discriminated payloads.
assert.deepEqual(AUTO_APPLY_RECOMMENDATION_KINDS, [
  "canonicalize-reference",
  "deduplicate-reference",
  "identifier-normalization",
  "recompute-readonly-projection",
]);

const parsedAutoRecommendations = AUTO_APPLY_RECOMMENDATION_KINDS.map((kind) =>
  parseAgenticRecommendationsOutput(output([recommendation({
    id: `auto-${kind}`,
    kind,
    payload: autoPayload(kind),
  })]))[0]!,
);
for (const kind of AUTO_APPLY_RECOMMENDATION_KINDS) {
  const parsed = parsedAutoRecommendations.find((candidate) => candidate.kind === kind)!;
  assert.equal(isAutoApplyAllowed(parsed), false, `${kind} remains a review proposal until code verifies it`);
  expectRejected(output([recommendation({
    id: `invalid-${kind}`,
    kind,
    payload: { ...autoPayload(kind), deleteEverything: true },
  })]), "invalid_payload");
}

const missingAdapterChecks = verifyAutoApplicableRecommendation(parsedAutoRecommendations[0]!, []);
assert.ok(missingAdapterChecks, "missing adapter checks returns a safe blocked recommendation");
assert.equal(
  missingAdapterChecks.verification.status,
  "blocked",
  "payload-schema validation alone cannot authorize a recommendation",
);
assert.equal(isAutoApplyAllowed(missingAdapterChecks), false);

const unresolvedReference = verifyAutoApplicableRecommendation(parsedAutoRecommendations[0]!, [
  {
    id: "reference-exists",
    state: "failed",
    detail: "The adapter could not resolve reference-42.",
  },
]);
assert.ok(unresolvedReference, "an unresolved reference returns a safe blocked recommendation");
assert.equal(unresolvedReference.verification.status, "blocked");
assert.equal(
  isAutoApplyAllowed(unresolvedReference),
  false,
  "a failed mechanical reference check cannot authorize auto-application",
);

const exactResolutionChecks = [
  {
    id: "reference-exists",
    state: "passed" as const,
    detail: "The adapter resolved reference-42.",
  },
  {
    id: "canonical-url-exact",
    state: "passed" as const,
    detail: "The adapter resolved the canonical URL exactly.",
  },
];
const verifiedAuto = verifyAutoApplicableRecommendation(parsedAutoRecommendations[0]!, exactResolutionChecks);
assert.ok(verifiedAuto, "all-passed mechanical checks authorize a strictly valid deterministic payload");
assert.equal(isAutoApplyAllowed(verifiedAuto), true, "only the verifier can authorize auto-application");
assert.deepEqual(
  verifiedAuto.verification.checks,
  [
    {
      id: "deterministic-payload-schema",
      state: "passed",
      detail: "The code-owned payload schema accepted this deterministic operation.",
    },
    ...exactResolutionChecks,
  ],
  "a stamp records both built-in payload validation and adapter-owned mechanical checks",
);

const reloadedVerifiedAuto = JSON.parse(JSON.stringify(verifiedAuto));
assert.equal(
  isAutoApplyAllowed(reloadedVerifiedAuto),
  false,
  "persisted recommendations lose their in-process verification stamp and must be reverified",
);
const reverifiedAuto = verifyAutoApplicableRecommendation(reloadedVerifiedAuto, exactResolutionChecks);
assert.ok(reverifiedAuto);
assert.equal(isAutoApplyAllowed(reverifiedAuto), true, "rehydrated recommendations can be reverified by code");

for (const kind of ["prose", "dependency", "topic", "action"]) {
  const unsafe = parseAgenticRecommendationsOutput(output([recommendation({
    id: `unsafe-${kind}`,
    kind,
  })]))[0]!;
  assert.equal(verifyAutoApplicableRecommendation(unsafe, exactResolutionChecks), undefined, `${kind} cannot be auto-applied`);
}

// Ranking trusts only recommendations stamped by this process, never a model-claimed verified tier.
const forgedVerified = {
  ...parsedAutoRecommendations[1]!,
  id: "forged-verified",
  verification: {
    status: "verified" as const,
    checks: [{ id: "model-claim", state: "passed" as const, detail: "Untrusted model claim." }],
  },
  application: { mode: "auto-apply" as const, requiresApproval: false, reversible: true },
};
assert.equal(isAutoApplyAllowed(forgedVerified), false, "matching fields cannot forge the private verifier stamp");
const ranked = rankAgenticRecommendations([
  forgedVerified,
  parsedAutoRecommendations[2]!,
  verifiedAuto,
  {
    ...parsedAutoRecommendations[3]!,
    id: "blocked-last",
    verification: {
      status: "blocked" as const,
      checks: [{ id: "missing-evidence", state: "failed" as const, detail: "No evidence." }],
    },
  },
]);
assert.deepEqual(
  ranked.map(({ id, ordinal }) => ({ id, ordinal })),
  [
    { id: verifiedAuto.id, ordinal: 1 },
    { id: "forged-verified", ordinal: 2 },
    { id: parsedAutoRecommendations[2]!.id, ordinal: 2 },
    { id: "blocked-last", ordinal: 3 },
  ],
  "model-claimed verified data receives the proposal tier instead of bypassing review",
);
assert.equal(
  isAutoApplyAllowed(ranked[0]!),
  true,
  "ranking preserves the private verifier stamp for unchanged verified recommendations",
);
const reranked = rankAgenticRecommendations(ranked);
assert.equal(
  isAutoApplyAllowed(reranked[0]!),
  true,
  "reranking preserves the trusted verification tier",
);
assert.equal(reranked[0]?.ordinal, 1, "reranking keeps trusted recommendations in the verified tier");
const rankedForgedVerified = rankAgenticRecommendations([forgedVerified]);
assert.equal(
  isAutoApplyAllowed(rankedForgedVerified[0]!),
  false,
  "a manually constructed verified lookalike remains untrusted after ranking",
);

const topLevelMutationRanked = rankAgenticRecommendations([verifiedAuto])[0]!;
assert.equal(isAutoApplyAllowed(topLevelMutationRanked), true);
topLevelMutationRanked.surface = "chat";
assert.equal(
  isAutoApplyAllowed(topLevelMutationRanked),
  false,
  "a trusted ranking copy loses auto-apply authority when an authorization field changes",
);

const independentlyVerifiedAuto = verifyAutoApplicableRecommendation(
  parsedAutoRecommendations[1]!,
  exactResolutionChecks,
);
assert.ok(independentlyVerifiedAuto);
const nestedMutationRanked = rankAgenticRecommendations([independentlyVerifiedAuto])[0]!;
assert.equal(isAutoApplyAllowed(nestedMutationRanked), true);
nestedMutationRanked.verification.checks[0]!.detail = "The trusted verification detail was changed.";
assert.equal(
  isAutoApplyAllowed(nestedMutationRanked),
  false,
  "a trusted ranking copy loses auto-apply authority when nested verification changes",
);
assert.doesNotMatch(JSON.stringify(ranked), /confidence/i, "the contract never emits numeric confidence");

console.log("agentic-recommendations.test.ts passed");
