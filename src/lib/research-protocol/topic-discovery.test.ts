import assert from "node:assert/strict";
import { test } from "node:test";
import { Value } from "typebox/value";

import invalidTopicProposalScore from "../../../schemas/research/v1/fixtures/invalid/topic-proposal-score.json" with { type: "json" };
import topicDiscoveryJobSchema from "../../../schemas/research/v1/topic-discovery-job.schema.json" with { type: "json" };
import topicProposalSchema from "../../../schemas/research/v1/topic-proposal.schema.json" with { type: "json" };
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

  assert.deepEqual(job.futureExtension, { preserve: true });
  assert.deepEqual(job.modelReceipt?.futureExtension, { preserve: true });
  assert.deepEqual(proposal.futureExtension, { preserve: true });
});

test("topicProposalVisibleTotal returns 25 and matching proposal parses", () => {
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
    visibleTotal: 25,
  };

  assert.equal(topicProposalVisibleTotal(scores), 25);
  assert.equal(expectOk(parseTopicProposalV1({ ...validTopicProposal, scores })).scores.visibleTotal, 25);
});

test("proposal visibleTotal mismatches reject with semantic_conflict", () => {
  expectError(
    parseTopicProposalV1({
      ...validTopicProposal,
      scores: { ...validTopicProposal.scores, visibleTotal: 26 },
    }),
    "$.scores.visibleTotal",
    "semantic_conflict",
  );
});

test("completed job with empty proposalIds rejects", () => {
  const emptyCompletedJob = {
    ...validTopicDiscoveryJob,
    proposalIds: [],
  };

  assert.equal(Value.Check(topicDiscoveryJobSchema, emptyCompletedJob), false);
  expectError(parseTopicDiscoveryJobV1(emptyCompletedJob), "$.proposalIds", "semantic_conflict");
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

test("inherited required fields do not count", () => {
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
  expectError(parseTopicProposalV1(proposal), "$.schema", "missing_field");

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
  expectError(parseTopicDiscoveryJobV1(job), "$.schema", "missing_field");
});

test("invalid score fixture rejects", () => {
  assert.equal(Value.Check(topicProposalSchema, invalidTopicProposalScore), false);
  expectError(parseTopicProposalV1(invalidTopicProposalScore), "$.scores.groundability", "invalid_value");
});
