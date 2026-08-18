import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";

import invalidTopicDiscoveryEight from "../../../schemas/research/v1/fixtures/invalid/topic-discovery-job-eight.json" with { type: "json" };
import invalidTopicDiscoveryReceiptFamiliar from "../../../schemas/research/v1/fixtures/invalid/topic-discovery-job-receipt-familiar-mismatch.json" with { type: "json" };
import invalidTopicProposalScore from "../../../schemas/research/v1/fixtures/invalid/topic-proposal-score.json" with { type: "json" };
import topicDiscoveryJobSchema from "../../../schemas/research/v1/topic-discovery-job.schema.json" with { type: "json" };
import topicProposalSchema from "../../../schemas/research/v1/topic-proposal.schema.json" with { type: "json" };
import sevenProposalTopicDiscoveryJob from "../../../schemas/research/v1/fixtures/valid/topic-discovery-job-seven.json" with { type: "json" };
import twoProposalTopicDiscoveryJob from "../../../schemas/research/v1/fixtures/valid/topic-discovery-job-two.json" with { type: "json" };
import validTopicDiscoveryJob from "../../../schemas/research/v1/fixtures/valid/topic-discovery-job.json" with { type: "json" };
import validTopicProposal from "../../../schemas/research/v1/fixtures/valid/topic-proposal.json" with { type: "json" };

import {
  parseResearchModelReceiptV1,
  parseTopicDiscoveryJobV1,
  parseTopicProposalV1,
  topicProposalVisibleTotal,
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

test("valid fixtures satisfy schemas and parse", () => {
  assert.ok(Value.Check(topicDiscoveryJobSchema, validTopicDiscoveryJob));
  assert.ok(Value.Check(topicProposalSchema, validTopicProposal));

  const job = expectOk(parseTopicDiscoveryJobV1(validTopicDiscoveryJob));
  const proposal = expectOk(parseTopicProposalV1(validTopicProposal));

  assert.equal((job.futureExtension as { preserve: boolean }).preserve, true);
  assert.equal((job.modelReceipt?.futureExtension as { preserve: boolean }).preserve, true);
  assert.equal((proposal.futureExtension as { preserve: boolean }).preserve, true);
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

test("completed jobs accept one, two, or seven proposalIds", () => {
  for (const job of [
    validTopicDiscoveryJob,
    twoProposalTopicDiscoveryJob,
    sevenProposalTopicDiscoveryJob,
  ]) {
    assert.equal(Value.Check(topicDiscoveryJobSchema, job), true);
    expectOk(parseTopicDiscoveryJobV1(job));
  }
});

test("discovery model receipt must identify the job familiar", () => {
  const { expectedSchemaValid, ...fixture } = invalidTopicDiscoveryReceiptFamiliar;
  assert.equal(expectedSchemaValid, true);
  assert.equal(Value.Check(topicDiscoveryJobSchema, fixture), true);
  expectError(
    parseTopicDiscoveryJobV1(fixture),
    "$.modelReceipt.familiarId",
    "semantic_conflict",
  );
});

test("completed jobs reject zero or eight proposalIds", () => {
  for (const job of [{ ...validTopicDiscoveryJob, proposalIds: [] }, invalidTopicDiscoveryEight]) {
    assert.equal(Value.Check(topicDiscoveryJobSchema, job), false);
    expectError(parseTopicDiscoveryJobV1(job), "$.proposalIds", "semantic_conflict");
  }
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
