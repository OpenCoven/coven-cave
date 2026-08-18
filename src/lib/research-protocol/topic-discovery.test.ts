import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";

import invalidTopicDiscoveryEight from "../../../schemas/research/v1/fixtures/invalid/topic-discovery-job-eight.json" with { type: "json" };
import invalidTopicDiscoveryReceiptFamiliar from "../../../schemas/research/v1/fixtures/invalid/topic-discovery-job-receipt-familiar-mismatch.json" with { type: "json" };
import invalidTopicProposalScore from "../../../schemas/research/v1/fixtures/invalid/topic-proposal-score.json" with { type: "json" };
import topicDiscoveryJobSchema from "../../../schemas/research/v1/topic-discovery-job.schema.json" with { type: "json" };
import topicProposalSchema from "../../../schemas/research/v1/topic-proposal.schema.json" with { type: "json" };
import noGroundedTopicDiscoveryJob from "../../../schemas/research/v1/fixtures/valid/topic-discovery-job-no-grounded-proposals.json" with { type: "json" };
import fourProposalTopicDiscoveryJob from "../../../schemas/research/v1/fixtures/valid/topic-discovery-job-four.json" with { type: "json" };
import sevenProposalTopicDiscoveryJob from "../../../schemas/research/v1/fixtures/valid/topic-discovery-job-seven.json" with { type: "json" };
import threeProposalTopicDiscoveryJob from "../../../schemas/research/v1/fixtures/valid/topic-discovery-job-three.json" with { type: "json" };
import twoProposalTopicDiscoveryJob from "../../../schemas/research/v1/fixtures/valid/topic-discovery-job-two.json" with { type: "json" };
import validContextPack from "../../../schemas/research/v1/fixtures/valid/context-pack.json" with { type: "json" };
import validTopicDiscoveryJob from "../../../schemas/research/v1/fixtures/valid/topic-discovery-job.json" with { type: "json" };
import validTopicProposal from "../../../schemas/research/v1/fixtures/valid/topic-proposal.json" with { type: "json" };

import { parseContextPackV1, type ContextPackV1 } from "./context-pack.ts";
import { digestProtocolObject } from "./digest.ts";
import {
  parseResearchModelReceiptV1,
  parseTopicDiscoveryJobV1,
  parseTopicProposalV1,
  topicProposalVisibleTotal,
  validateTopicDiscoveryCompositionV1,
  type TopicDiscoveryJobV1,
  type TopicProposalV1,
} from "./topic-discovery.ts";

function expectOk<T>(result: { ok: true; value: T } | { ok: false; error: { path: string; message: string } }): T {
  if (!result.ok) {
    assert.fail(`${result.error.path}: ${result.error.message}`);
  }
  return result.value;
}

function expectError(
  result: { ok: true; value: unknown } | { ok: false; error: { path: string; code: string; message: string } },
  path: string,
  code?: string,
): { path: string; code: string; message: string } {
  if (result.ok) {
    assert.fail("expected parse failure");
  }
  assert.equal(result.error.path, path);
  if (code) {
    assert.equal(result.error.code, code);
  }
  return result.error;
}

function validDiscoveryComposition(): {
  contextPack: ContextPackV1;
  job: TopicDiscoveryJobV1;
  proposals: TopicProposalV1[];
} {
  const contextPackValue = structuredClone(validContextPack) as Record<string, unknown> & {
    policy: Record<string, unknown>;
    resources: Array<Record<string, unknown>>;
  };
  contextPackValue.purpose = "topic-discovery";
  contextPackValue.policy.allowedPurposes = ["topic-discovery"];
  contextPackValue.resources[0]!.selector = structuredClone(validTopicProposal.evidence[0]!.selector);
  contextPackValue.digest = digestProtocolObject(contextPackValue);
  const contextPack = expectOk(parseContextPackV1(contextPackValue));
  const job = expectOk(
    parseTopicDiscoveryJobV1({
      ...validTopicDiscoveryJob,
      contextPackId: contextPack.id,
      contextPackDigest: contextPack.digest,
    }),
  );
  const proposal = expectOk(
    parseTopicProposalV1({
      ...validTopicProposal,
      discoveryJobId: job.id,
      contextPackId: contextPack.id,
    }),
  );
  return { contextPack, job, proposals: [proposal] };
}

test("valid topic discovery composition preserves every parsed input", () => {
  const { contextPack, job, proposals } = validDiscoveryComposition();
  const before = structuredClone({ contextPack, job, proposals });
  const result = validateTopicDiscoveryCompositionV1(contextPack, job, proposals);

  assert.deepEqual({ contextPack, job, proposals }, before);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.strictEqual(result.value, job);
  }
});

test("topic discovery composition reparses every mutable protocol input", () => {
  {
    const { contextPack, job, proposals } = validDiscoveryComposition();
    contextPack.digest = "f".repeat(64);
    expectError(
      validateTopicDiscoveryCompositionV1(contextPack, job, proposals),
      "$.digest",
      "digest_mismatch",
    );
  }

  {
    const { contextPack, job, proposals } = validDiscoveryComposition();
    contextPack.resources[0]!.selector = { type: "text-span", start: 1, end: 20 };
    expectError(
      validateTopicDiscoveryCompositionV1(contextPack, job, proposals),
      "$.digest",
      "digest_mismatch",
    );
  }

  {
    const { contextPack, job, proposals } = validDiscoveryComposition();
    (contextPack.consent as unknown as Record<string, unknown>).retention = "forever";
    contextPack.digest = digestProtocolObject(contextPack);
    expectError(
      validateTopicDiscoveryCompositionV1(contextPack, job, proposals),
      "$.consent.retention",
      "invalid_value",
    );
  }

  {
    const { contextPack, job, proposals } = validDiscoveryComposition();
    (job as unknown as Record<string, unknown>).status = "trusted-after-parse";
    expectError(
      validateTopicDiscoveryCompositionV1(contextPack, job, proposals),
      "$.status",
      "invalid_value",
    );
  }

  {
    const { contextPack, job, proposals } = validDiscoveryComposition();
    proposals[0]!.discoveryJobId = "not-an-opaque-id";
    expectError(
      validateTopicDiscoveryCompositionV1(contextPack, job, proposals),
      "$.discoveryJobId",
      "invalid_value",
    );
  }

  {
    const { contextPack, job, proposals } = validDiscoveryComposition();
    proposals[0]!.evidence[0]!.selector = { type: "text-span", start: 20, end: 1 };
    expectError(
      validateTopicDiscoveryCompositionV1(contextPack, job, proposals),
      "$.evidence[0].selector",
      "semantic_conflict",
    );
  }

  {
    const { contextPack, job, proposals } = validDiscoveryComposition();
    const secondProposal = expectOk(
      parseTopicProposalV1({
        ...proposals[0],
        id: "proposal_02",
      }),
    );
    const twoProposalJob = expectOk(
      parseTopicDiscoveryJobV1({
        ...job,
        proposalIds: [proposals[0]!.id, secondProposal.id],
      }),
    );
    secondProposal.scores.groundability = 6;
    expectError(
      validateTopicDiscoveryCompositionV1(
        contextPack,
        twoProposalJob,
        [proposals[0]!, secondProposal],
      ),
      "$.scores.groundability",
      "invalid_value",
    );
  }
});

test("proposal containers are snapshotted before protocol parsing and iteration", () => {
  {
    const { contextPack, job, proposals } = validDiscoveryComposition();
    const jobBefore = structuredClone(job);
    let iteratorCalls = 0;
    Object.defineProperty(proposals, Symbol.iterator, {
      value: function* () {
        iteratorCalls += 1;
        job.proposalIds.length = 0;
        yield proposals[0]!;
      },
      configurable: true,
    });

    expectError(
      validateTopicDiscoveryCompositionV1(contextPack, job, proposals),
      "$.proposals",
      "invalid_value",
    );
    assert.equal(iteratorCalls, 0);
    assert.deepEqual(job, jobBefore);
  }

  for (const kind of ["index accessor", "custom prototype", "Proxy"] as const) {
    const { contextPack, job, proposals } = validDiscoveryComposition();
    let accessorCalls = 0;
    let container: readonly TopicProposalV1[];
    if (kind === "index accessor") {
      const accessor = proposals.slice();
      Object.defineProperty(accessor, "0", {
        get() {
          accessorCalls += 1;
          return proposals[0];
        },
        enumerable: true,
        configurable: true,
      });
      container = accessor;
    } else if (kind === "custom prototype") {
      const customPrototype = proposals.slice();
      Object.setPrototypeOf(customPrototype, Object.create(Array.prototype));
      container = customPrototype;
    } else {
      container = new Proxy(proposals.slice(), {});
    }

    expectError(
      validateTopicDiscoveryCompositionV1(contextPack, job, container),
      "$.proposals",
      "invalid_value",
    );
    assert.equal(accessorCalls, 0, kind);
  }

  {
    const { contextPack, job, proposals } = validDiscoveryComposition();
    const frozenProposals = Object.freeze(proposals.slice());
    assert.strictEqual(
      expectOk(
        validateTopicDiscoveryCompositionV1(
          contextPack,
          job,
          frozenProposals,
        ),
      ),
      job,
    );
  }
});

test("topic discovery composition requires a discovery-purpose Context Pack and policy", () => {
  const { job, proposals } = validDiscoveryComposition();
  const researchRunPack = expectOk(parseContextPackV1(validContextPack));
  expectError(
    validateTopicDiscoveryCompositionV1(researchRunPack, job, proposals),
    "$.contextPack.purpose",
    "semantic_conflict",
  );

  const { contextPack } = validDiscoveryComposition();
  const policyDeniedPack = {
    ...contextPack,
    policy: {
      ...contextPack.policy,
      allowedPurposes: ["research-run"],
    },
  } as ContextPackV1;
  expectError(
    validateTopicDiscoveryCompositionV1(policyDeniedPack, job, proposals),
    "$.policy.allowedPurposes",
    "semantic_conflict",
  );
});

test("topic discovery composition binds the job to the Context Pack id and digest", () => {
  const { contextPack, job, proposals } = validDiscoveryComposition();
  const wrongId = expectOk(
    parseTopicDiscoveryJobV1({
      ...job,
      contextPackId: "ctx_other",
    }),
  );
  expectError(
    validateTopicDiscoveryCompositionV1(contextPack, wrongId, proposals),
    "$.contextPackId",
    "semantic_conflict",
  );

  const wrongDigest = expectOk(
    parseTopicDiscoveryJobV1({
      ...job,
      contextPackDigest: "f".repeat(64),
    }),
  );
  expectError(
    validateTopicDiscoveryCompositionV1(contextPack, wrongDigest, proposals),
    "$.contextPackDigest",
    "semantic_conflict",
  );
});

test("topic discovery composition requires the complete persisted proposal order", () => {
  const { contextPack, job, proposals } = validDiscoveryComposition();
  const secondProposal = expectOk(
    parseTopicProposalV1({
      ...proposals[0],
      id: "proposal_02",
    }),
  );

  expectError(
    validateTopicDiscoveryCompositionV1(contextPack, job, []),
    "$.proposalIds",
    "semantic_conflict",
  );
  expectError(
    validateTopicDiscoveryCompositionV1(contextPack, job, [proposals[0]!, secondProposal]),
    "$.proposalIds",
    "semantic_conflict",
  );

  const twoProposalJob = expectOk(
    parseTopicDiscoveryJobV1({
      ...job,
      proposalIds: [proposals[0]!.id, secondProposal.id],
    }),
  );
  expectError(
    validateTopicDiscoveryCompositionV1(
      contextPack,
      twoProposalJob,
      [secondProposal, proposals[0]!],
    ),
    "$.proposalIds[0]",
    "semantic_conflict",
  );
});

test("topic discovery composition binds every proposal to its job and Context Pack", () => {
  const { contextPack, job, proposals } = validDiscoveryComposition();
  const wrongJob = expectOk(
    parseTopicProposalV1({
      ...proposals[0],
      discoveryJobId: "topicjob_other",
    }),
  );
  expectError(
    validateTopicDiscoveryCompositionV1(contextPack, job, [wrongJob]),
    "$.proposals[0].discoveryJobId",
    "semantic_conflict",
  );

  const wrongPack = expectOk(
    parseTopicProposalV1({
      ...proposals[0],
      contextPackId: "ctx_other",
    }),
  );
  expectError(
    validateTopicDiscoveryCompositionV1(contextPack, job, [wrongPack]),
    "$.proposals[0].contextPackId",
    "semantic_conflict",
  );
});

test("topic discovery composition resolves evidence resources and sealed selectors", () => {
  const { contextPack, job, proposals } = validDiscoveryComposition();
  for (const field of ["evidence", "counterevidence"] as const) {
    const proposalValue = structuredClone(proposals[0]!);
    proposalValue[field] = [
      {
        ...structuredClone(proposals[0]!.evidence[0]!),
        resourceId: "resource_missing",
      },
    ];
    const invalidProposal = expectOk(
      parseTopicProposalV1(proposalValue),
    );
    expectError(
      validateTopicDiscoveryCompositionV1(contextPack, job, [invalidProposal]),
      `$.proposals[0].${field}[0].resourceId`,
      "semantic_conflict",
    );
  }

  const selectorMismatch = expectOk(
    parseTopicProposalV1({
      ...proposals[0],
      evidence: [
        {
          ...proposals[0]!.evidence[0],
          selector: { type: "text-span", start: 0, end: 19 },
        },
      ],
    }),
  );
  expectError(
    validateTopicDiscoveryCompositionV1(contextPack, job, [selectorMismatch]),
    "$.proposals[0].evidence[0].selector",
    "semantic_conflict",
  );
});

test("topic discovery selector equality is canonical JSON equality, not identity or key order", () => {
  const { contextPack, job, proposals } = validDiscoveryComposition();
  const resourceSelector = {
    type: "text-span" as const,
    start: 0,
    end: 20,
    alpha: 1,
    nested: { left: true, right: false },
  };
  const evidenceSelector = {
    nested: { right: false, left: true },
    alpha: 1,
    end: 20,
    start: 0,
    type: "text-span" as const,
  };
  const packValue = {
    ...contextPack,
    resources: [
      {
        ...contextPack.resources[0],
        selector: resourceSelector,
      },
    ],
  };
  packValue.digest = digestProtocolObject(packValue);
  const reorderedPack = expectOk(parseContextPackV1(packValue));
  const reboundJob = expectOk(
    parseTopicDiscoveryJobV1({
      ...job,
      contextPackDigest: reorderedPack.digest,
    }),
  );
  const reorderedProposal = expectOk(
    parseTopicProposalV1({
      ...proposals[0],
      evidence: [
        {
          ...proposals[0]!.evidence[0],
          selector: evidenceSelector,
        },
      ],
    }),
  );

  assert.notEqual(reorderedPack.resources[0]!.selector, reorderedProposal.evidence[0]!.selector);
  assert.equal(
    validateTopicDiscoveryCompositionV1(reorderedPack, reboundJob, [reorderedProposal]).ok,
    true,
  );
});

test("topic discovery job lifecycle timestamps are monotonic at nanosecond precision", () => {
  const { startedAt: _startedAt, ...jobWithoutStart } = validTopicDiscoveryJob;
  expectError(
    parseTopicDiscoveryJobV1({
      ...validTopicDiscoveryJob,
      requestedAt: "2026-08-15T20:00:00.000000002Z",
      startedAt: "2026-08-15T20:00:00.000000001Z",
    }),
    "$.startedAt",
    "semantic_conflict",
  );
  expectError(
    parseTopicDiscoveryJobV1({
      ...validTopicDiscoveryJob,
      startedAt: "2026-08-15T20:06:00.000000002Z",
      finishedAt: "2026-08-15T20:06:00.000000001Z",
    }),
    "$.finishedAt",
    "semantic_conflict",
  );
  expectError(
    parseTopicDiscoveryJobV1({
      ...jobWithoutStart,
      status: "cancelled",
      requestedAt: "2026-08-15T20:06:00.000000002Z",
      finishedAt: "2026-08-15T20:06:00.000000001Z",
      proposalIds: [],
    }),
    "$.finishedAt",
    "semantic_conflict",
  );

  assert.equal(
    parseTopicDiscoveryJobV1({
      ...validTopicDiscoveryJob,
      requestedAt: "2026-08-15T20:00:00.000000001Z",
      startedAt: "2026-08-15T20:00:00.000000001Z",
      finishedAt: "2026-08-15T20:00:00.000000002Z",
    }).ok,
    true,
  );
});

test("topic proposal creation stays within its discovery job lifecycle", () => {
  const { contextPack, job, proposals } = validDiscoveryComposition();
  const beforeRequest = expectOk(
    parseTopicProposalV1({
      ...proposals[0],
      createdAt: "2026-08-15T19:59:59.999999999Z",
    }),
  );
  expectError(
    validateTopicDiscoveryCompositionV1(contextPack, job, [beforeRequest]),
    "$.proposals[0].createdAt",
    "semantic_conflict",
  );

  const betweenRequestAndStart = expectOk(
    parseTopicProposalV1({
      ...proposals[0],
      createdAt: "2026-08-15T20:00:59.999999999Z",
    }),
  );
  expectError(
    validateTopicDiscoveryCompositionV1(contextPack, job, [betweenRequestAndStart]),
    "$.proposals[0].createdAt",
    "semantic_conflict",
  );

  const atStart = expectOk(
    parseTopicProposalV1({
      ...proposals[0],
      createdAt: job.startedAt,
    }),
  );
  assert.equal(
    validateTopicDiscoveryCompositionV1(contextPack, job, [atStart]).ok,
    true,
  );

  const afterFinish = expectOk(
    parseTopicProposalV1({
      ...proposals[0],
      createdAt: "2026-08-15T20:06:00.000000001Z",
    }),
  );
  expectError(
    validateTopicDiscoveryCompositionV1(contextPack, job, [afterFinish]),
    "$.proposals[0].createdAt",
    "semantic_conflict",
  );

  const atFinish = expectOk(
    parseTopicProposalV1({
      ...proposals[0],
      createdAt: job.finishedAt,
    }),
  );
  assert.equal(
    validateTopicDiscoveryCompositionV1(contextPack, job, [atFinish]).ok,
    true,
  );

  const { startedAt: _startedAt, ...jobWithoutStartValue } = job;
  const jobWithoutStart = expectOk(parseTopicDiscoveryJobV1(jobWithoutStartValue));
  const atRequest = expectOk(
    parseTopicProposalV1({
      ...proposals[0],
      createdAt: jobWithoutStart.requestedAt,
    }),
  );
  assert.equal(
    validateTopicDiscoveryCompositionV1(contextPack, jobWithoutStart, [atRequest]).ok,
    true,
  );

  const leapSecondJob = expectOk(
    parseTopicDiscoveryJobV1({
      ...job,
      requestedAt: "2026-06-30T23:59:59.999999999Z",
      startedAt: "2026-06-30T23:59:60.000000001Z",
      finishedAt: "2026-07-01T00:00:00.000000001Z",
    }),
  );
  const beforeLeapSecondStart = expectOk(
    parseTopicProposalV1({
      ...proposals[0],
      createdAt: "2026-06-30T23:59:60Z",
    }),
  );
  expectError(
    validateTopicDiscoveryCompositionV1(
      contextPack,
      leapSecondJob,
      [beforeLeapSecondStart],
    ),
    "$.proposals[0].createdAt",
    "semantic_conflict",
  );
  const atLeapSecondStart = expectOk(
    parseTopicProposalV1({
      ...proposals[0],
      createdAt: leapSecondJob.startedAt,
    }),
  );
  assert.equal(
    validateTopicDiscoveryCompositionV1(
      contextPack,
      leapSecondJob,
      [atLeapSecondStart],
    ).ok,
    true,
  );
});

test("valid fixtures satisfy schemas and parse", () => {
  assert.ok(Value.Check(topicDiscoveryJobSchema, validTopicDiscoveryJob));
  assert.ok(Value.Check(topicProposalSchema, validTopicProposal));

  const job = expectOk(parseTopicDiscoveryJobV1(validTopicDiscoveryJob));
  const proposal = expectOk(parseTopicProposalV1(validTopicProposal));

  assert.equal((job.futureExtension as { preserve: boolean }).preserve, true);
  assert.equal((job.modelReceipt?.futureExtension as { preserve: boolean }).preserve, true);
  assert.equal((proposal.futureExtension as { preserve: boolean }).preserve, true);
});

test("topic discovery model receipt must identify the job familiar", () => {
  const { expectedSchemaValid, ...mismatchedReceiptJob } = invalidTopicDiscoveryReceiptFamiliar;

  assert.equal(expectedSchemaValid, true);
  assert.equal(Value.Check(topicDiscoveryJobSchema, mismatchedReceiptJob), true);
  expectError(
    parseTopicDiscoveryJobV1(mismatchedReceiptJob),
    "$.modelReceipt.familiarId",
    "semantic_conflict",
  );
});

test("topicProposalVisibleTotal applies the Section 10.3 weights in integer hundredths", () => {
  const scores = {
    groundability: 4,
    decisionValue: 3,
    unresolvedness: 2,
    recurrence: 1,
    novelty: 4,
    timeliness: 2,
    familiarFit: 4,
    feasibility: 3,
    humanResonance: 4,
    riskPenalty: 2,
    visibleTotal: 2.64,
  };

  assert.equal(topicProposalVisibleTotal(scores), 2.64);
  assert.equal(expectOk(parseTopicProposalV1({ ...validTopicProposal, scores })).scores.visibleTotal, 2.64);
});

test("topicProposalVisibleTotal exposes each exact weight and its bounded range", () => {
  const zeros = {
    groundability: 0,
    decisionValue: 0,
    unresolvedness: 0,
    recurrence: 0,
    novelty: 0,
    timeliness: 0,
    familiarFit: 0,
    feasibility: 0,
    humanResonance: 0,
    riskPenalty: 0,
    visibleTotal: 0,
  };
  const expectedWeights = {
    groundability: 0.18,
    decisionValue: 0.16,
    unresolvedness: 0.13,
    recurrence: 0.10,
    novelty: 0.10,
    timeliness: 0.08,
    familiarFit: 0.08,
    feasibility: 0.08,
    humanResonance: 0.09,
  } as const;

  for (const [key, weight] of Object.entries(expectedWeights)) {
    assert.equal(topicProposalVisibleTotal({ ...zeros, [key]: 1 }), weight, key);
  }
  assert.equal(topicProposalVisibleTotal({ ...zeros, riskPenalty: 1 }), -0.20);
  assert.equal(
    topicProposalVisibleTotal({
      ...zeros,
      groundability: 4,
      decisionValue: 4,
      unresolvedness: 4,
      recurrence: 4,
      novelty: 4,
      timeliness: 4,
      familiarFit: 4,
      feasibility: 4,
      humanResonance: 4,
    }),
    4,
  );
  assert.equal(topicProposalVisibleTotal({ ...zeros, riskPenalty: 4 }), -0.8);
});

test("proposal visibleTotal schema and parser require hundredth precision in the weighted range", () => {
  const tooPrecise = {
    ...validTopicProposal,
    scores: { ...validTopicProposal.scores, visibleTotal: 2.641 },
  };

  assert.equal(Value.Check(topicProposalSchema, tooPrecise), false);
  expectError(parseTopicProposalV1(tooPrecise), "$.scores.visibleTotal", "invalid_value");
});

test("proposal visibleTotal mismatches reject with semantic_conflict", () => {
  expectError(
    parseTopicProposalV1({
      ...validTopicProposal,
      scores: { ...validTopicProposal.scores, visibleTotal: 2.63 },
    }),
    "$.scores.visibleTotal",
    "semantic_conflict",
  );
});

test("completed jobs accept one through seven grounded proposalIds", () => {
  // Generators target 3–7 cards; completed wire jobs may contain 1–2 when
  // partial validation rejects some generated proposals.
  for (const job of [
    validTopicDiscoveryJob,
    twoProposalTopicDiscoveryJob,
    threeProposalTopicDiscoveryJob,
    fourProposalTopicDiscoveryJob,
    sevenProposalTopicDiscoveryJob,
  ]) {
    assert.equal(Value.Check(topicDiscoveryJobSchema, job), true);
    expectOk(parseTopicDiscoveryJobV1(job));
  }
});

test("completed jobs reject zero or more than seven proposalIds", () => {
  const emptyCompletedJob = {
    ...validTopicDiscoveryJob,
    proposalIds: [],
  };

  assert.equal(Value.Check(topicDiscoveryJobSchema, emptyCompletedJob), false);
  expectError(parseTopicDiscoveryJobV1(emptyCompletedJob), "$.proposalIds", "semantic_conflict");

  assert.equal(Value.Check(topicDiscoveryJobSchema, invalidTopicDiscoveryEight), false);
  expectError(
    parseTopicDiscoveryJobV1(invalidTopicDiscoveryEight),
    "$.proposalIds",
    "semantic_conflict",
  );
});

test("all rejected proposals produce a failed no_grounded_proposals job", () => {
  assert.equal(Value.Check(topicDiscoveryJobSchema, noGroundedTopicDiscoveryJob), true);
  const job = expectOk(parseTopicDiscoveryJobV1(noGroundedTopicDiscoveryJob));
  assert.equal(job.status, "failed");
  assert.deepEqual(job.proposalIds, []);
  assert.equal(job.failure?.code, "no_grounded_proposals");
});

test("proposal cardinality bounds apply only to completed jobs", () => {
  const { finishedAt: _finishedAt, ...inProgress } = validTopicDiscoveryJob;
  for (const job of [
    {
      ...inProgress,
      status: "queued" as const,
      proposalIds: ["proposal_01"],
    },
    {
      ...inProgress,
      status: "running" as const,
      proposalIds: Array.from({ length: 8 }, (_, index) => `proposal_${index + 1}`),
    },
  ]) {
    assert.equal(Value.Check(topicDiscoveryJobSchema, job), true);
    expectOk(parseTopicDiscoveryJobV1(job));
  }
});

test("running job without startedAt rejects", () => {
  const { startedAt: _startedAt, finishedAt: _finishedAt, ...baseJob } = validTopicDiscoveryJob;
  const runningJob = { ...baseJob, status: "running" as const };

  assert.equal(Value.Check(topicDiscoveryJobSchema, runningJob), false);
  expectError(parseTopicDiscoveryJobV1(runningJob), "$.startedAt", "missing_field");
});

test("running job forbids finishedAt and failure", () => {
  const runningWithFinishedAt = {
    ...validTopicDiscoveryJob,
    status: "running" as const,
  };
  assert.equal(Value.Check(topicDiscoveryJobSchema, runningWithFinishedAt), false);
  expectError(parseTopicDiscoveryJobV1(runningWithFinishedAt), "$.finishedAt", "semantic_conflict");

  const { finishedAt: _finishedAt, ...runningBase } = validTopicDiscoveryJob;
  const runningWithFailure = {
    ...runningBase,
    status: "running" as const,
    failure: { code: "runtime_error", message: "Retry later", retryable: true },
  };
  assert.equal(Value.Check(topicDiscoveryJobSchema, runningWithFailure), false);
  expectError(parseTopicDiscoveryJobV1(runningWithFailure), "$.failure", "semantic_conflict");
});

test("queued job accepts startedAt but forbids finishedAt and failure", () => {
  const runtimeFailure = { code: "runtime_error", message: "Retry later", retryable: true };
  const { finishedAt: _finishedAt, ...queuedBase } = validTopicDiscoveryJob;

  const queuedWithStartedAt = {
    ...queuedBase,
    status: "queued" as const,
    startedAt: validTopicDiscoveryJob.startedAt,
  };
  assert.equal(Value.Check(topicDiscoveryJobSchema, queuedWithStartedAt), true);
  const parsedQueuedWithStartedAt = expectOk(parseTopicDiscoveryJobV1(queuedWithStartedAt));
  assert.equal(parsedQueuedWithStartedAt.startedAt, validTopicDiscoveryJob.startedAt);

  const queuedWithFinishedAt = {
    ...queuedBase,
    status: "queued" as const,
    finishedAt: validTopicDiscoveryJob.finishedAt,
  };
  assert.equal(Value.Check(topicDiscoveryJobSchema, queuedWithFinishedAt), false);
  expectError(parseTopicDiscoveryJobV1(queuedWithFinishedAt), "$.finishedAt", "semantic_conflict");

  const queuedWithFailure = {
    ...queuedBase,
    status: "queued" as const,
    failure: runtimeFailure,
  };
  assert.equal(Value.Check(topicDiscoveryJobSchema, queuedWithFailure), false);
  expectError(parseTopicDiscoveryJobV1(queuedWithFailure), "$.failure", "semantic_conflict");
});

test("completed and failed jobs remain valid", () => {
  assert.equal(Value.Check(topicDiscoveryJobSchema, validTopicDiscoveryJob), true);
  expectOk(parseTopicDiscoveryJobV1(validTopicDiscoveryJob));

  const validFailedJob = {
    ...validTopicDiscoveryJob,
    status: "failed" as const,
    failure: { code: "runtime_error", message: "Retry later", retryable: true },
  };
  assert.equal(Value.Check(topicDiscoveryJobSchema, validFailedJob), true);
  expectOk(parseTopicDiscoveryJobV1(validFailedJob));
});

test("completed, failed, and cancelled jobs without finishedAt reject", () => {
  const cases = [
    { status: "completed", extra: {} },
    {
      status: "failed",
      extra: { failure: { code: "runtime_error", message: "Retry later", retryable: true } },
    },
    { status: "cancelled", extra: {} },
  ] as const;

  for (const { status, extra } of cases) {
    const { finishedAt: _finishedAt, ...baseJob } = validTopicDiscoveryJob;
    const job = { ...baseJob, status, ...extra };

    assert.equal(Value.Check(topicDiscoveryJobSchema, job), false);
    expectError(parseTopicDiscoveryJobV1(job), "$.finishedAt", "missing_field");
  }
});

test("completed job with failure rejects and cancelled job with failure rejects", () => {
  const completedWithFailure = {
    ...validTopicDiscoveryJob,
    failure: { code: "runtime_error", message: "Retry later", retryable: true },
  };
  assert.equal(Value.Check(topicDiscoveryJobSchema, completedWithFailure), false);
  expectError(parseTopicDiscoveryJobV1(completedWithFailure), "$.failure", "semantic_conflict");

  const cancelledWithFailure = {
    ...validTopicDiscoveryJob,
    status: "cancelled" as const,
    failure: { code: "runtime_error", message: "Retry later", retryable: true },
  };
  assert.equal(Value.Check(topicDiscoveryJobSchema, cancelledWithFailure), false);
  expectError(parseTopicDiscoveryJobV1(cancelledWithFailure), "$.failure", "semantic_conflict");

  const failedWithoutFailure = {
    ...validTopicDiscoveryJob,
    status: "failed" as const,
  };
  assert.equal(Value.Check(topicDiscoveryJobSchema, failedWithoutFailure), false);
  expectError(parseTopicDiscoveryJobV1(failedWithoutFailure), "$.failure", "missing_field");
});

test("receipt usage semantics enforce nullability/reporting rules", () => {
  const validNullUsage = expectOk(
    parseResearchModelReceiptV1(
      {
        ...validTopicDiscoveryJob.modelReceipt,
        usage: {
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          reportedByRuntime: false,
        },
      },
      "$.receipt",
    ),
  );
  assert.equal(validNullUsage.usage.reportedByRuntime, false);

  const validReportedUsage = expectOk(
    parseResearchModelReceiptV1(
      {
        ...validTopicDiscoveryJob.modelReceipt,
        usage: {
          inputTokens: 1,
          outputTokens: null,
          costUsd: null,
          reportedByRuntime: true,
        },
      },
      "$.receipt",
    ),
  );
  assert.equal(validReportedUsage.usage.inputTokens, 1);

  expectError(
    parseResearchModelReceiptV1(
      {
        ...validTopicDiscoveryJob.modelReceipt,
        usage: {
          inputTokens: 1,
          outputTokens: null,
          costUsd: null,
          reportedByRuntime: false,
        },
      },
      "$.receipt",
    ),
    "$.receipt.usage",
    "semantic_conflict",
  );

  expectError(
    parseResearchModelReceiptV1(
      {
        ...validTopicDiscoveryJob.modelReceipt,
        usage: {
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          reportedByRuntime: true,
        },
      },
      "$.receipt",
    ),
    "$.receipt.usage",
    "semantic_conflict",
  );
});

test("standalone model receipt parser rejects accessors without invoking them", () => {
  let calls = 0;
  const receipt = { ...validTopicDiscoveryJob.modelReceipt };
  Object.defineProperty(receipt, "familiarId", {
    get() {
      calls += 1;
      return validTopicDiscoveryJob.modelReceipt.familiarId;
    },
    enumerable: true,
    configurable: true,
  });

  expectError(parseResearchModelReceiptV1(receipt, "$.receipt"), "$.receipt", "invalid_value");
  assert.equal(calls, 0);
});

test("unknown additive fields survive at top and nested levels", () => {
  const proposal = expectOk(
    parseTopicProposalV1({
      ...validTopicProposal,
      topMarker: "proposal",
      evidence: [
        {
          ...validTopicProposal.evidence[0],
          note: "keep",
          selector: { ...validTopicProposal.evidence[0].selector, marker: true },
        },
      ],
      scores: { ...validTopicProposal.scores, rubricVersion: 2 },
      suggested: { ...validTopicProposal.suggested, owner: "sage" },
    }),
  );

  assert.equal(proposal.topMarker, "proposal");
  assert.equal(proposal.evidence[0].note, "keep");
  assert.equal(proposal.evidence[0].selector.marker, true);
  assert.equal(proposal.scores.rubricVersion, 2);
  assert.equal(proposal.suggested.owner, "sage");

  const job = expectOk(
    parseTopicDiscoveryJobV1({
      ...validTopicDiscoveryJob,
      topMarker: "job",
      modelReceipt: {
        ...validTopicDiscoveryJob.modelReceipt,
        note: "keep",
        usage: { ...validTopicDiscoveryJob.modelReceipt.usage, marker: 1 },
      },
    }),
  );

  assert.equal(job.topMarker, "job");
  assert.equal(job.modelReceipt?.note, "keep");
  assert.equal(job.modelReceipt?.usage.marker, 1);
});

test("custom-prototype top-level objects are rejected", () => {
  const proposal = Object.create({ schema: validTopicProposal.schema });
  Object.assign(proposal, {
    id: validTopicProposal.id,
    discoveryJobId: validTopicProposal.discoveryJobId,
    contextPackId: validTopicProposal.contextPackId,
    title: validTopicProposal.title,
    question: validTopicProposal.question,
    whyNow: validTopicProposal.whyNow,
    evidence: validTopicProposal.evidence,
    counterevidence: validTopicProposal.counterevidence,
    scores: validTopicProposal.scores,
    suggested: validTopicProposal.suggested,
    uncertainty: validTopicProposal.uncertainty,
    relatedMissionIds: validTopicProposal.relatedMissionIds,
    createdAt: validTopicProposal.createdAt,
  });
  expectError(parseTopicProposalV1(proposal), "$", "invalid_value");

  const job = Object.create({ schema: validTopicDiscoveryJob.schema });
  Object.assign(job, {
    id: validTopicDiscoveryJob.id,
    contextPackId: validTopicDiscoveryJob.contextPackId,
    contextPackDigest: validTopicDiscoveryJob.contextPackDigest,
    familiarId: validTopicDiscoveryJob.familiarId,
    status: validTopicDiscoveryJob.status,
    requestedAt: validTopicDiscoveryJob.requestedAt,
    startedAt: validTopicDiscoveryJob.startedAt,
    finishedAt: validTopicDiscoveryJob.finishedAt,
    proposalIds: validTopicDiscoveryJob.proposalIds,
    modelReceipt: validTopicDiscoveryJob.modelReceipt,
  });
  expectError(parseTopicDiscoveryJobV1(job), "$", "invalid_value");
});

test("invalid score fixture rejects", () => {
  assert.equal(Value.Check(topicProposalSchema, invalidTopicProposalScore), false);
  expectError(parseTopicProposalV1(invalidTopicProposalScore), "$.scores.groundability", "invalid_value");
});
