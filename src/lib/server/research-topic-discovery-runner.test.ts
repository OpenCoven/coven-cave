import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { digestProtocolObject } from "../research-protocol/digest.ts";
import {
  parseTopicDiscoveryJobV1,
  parseTopicProposalV1,
  type ResearchModelReceiptV1,
  type TopicDiscoveryJobV1,
} from "../research-protocol/topic-discovery.ts";
import {
  createContextPackStore,
  type ContextPackStore,
} from "./research-context-pack-store.ts";
import { createTopicDiscoveryRunner, TopicDiscoveryRunnerError } from "./research-topic-discovery-runner.ts";
import {
  createTopicDiscoveryStore,
  TOPIC_DISCOVERY_MAX_ATTEMPTS,
} from "./research-topic-discovery-store.ts";

function tempRoot(prefix: string): string {
  return path.join(tmpdir(), `${prefix}-${process.pid}-${Math.random().toString(36).slice(2)}`);
}

const FIXED_NOW = "2026-08-28T10:00:00.000Z";
const BLOB_TEXT = "The quick brown fox jumps over the lazy dog.";
const BLOB_DIGEST = createHash("sha256").update(BLOB_TEXT).digest("hex");
const RESOURCE_ID = "resource_fixture";
const PACK_ID = "ctx_fixture";
const JOB_ID = "topicjob_fixture";

const MODEL_RECEIPT: ResearchModelReceiptV1 = {
  familiarId: "charm",
  runtime: "codex",
  effectiveModel: "openai/gpt-5",
  modelSource: "familiar-default",
  providerBilling: "user-connected",
  usage: { inputTokens: null, outputTokens: null, costUsd: null, reportedByRuntime: false },
};

async function sealPack(root: string, purpose: "topic-discovery" | "research-run" = "topic-discovery") {
  const blobBytes = new TextEncoder().encode(BLOB_TEXT);
  const createdAt = "2026-08-28T09:00:00.000Z";
  const pack: Record<string, unknown> = {
    schema: "opencoven.context-pack/v1",
    id: PACK_ID,
    digest: "",
    createdAt,
    createdBy: { client: "coven-cave" },
    purpose,
    subject: { familiarId: "charm" },
    consent: {
      selectionMode: "explicit",
      allowRemoteQueries: false,
      allowRemoteContent: false,
      artifactContentSync: false,
      retention: "run-only",
    },
    resources: [
      {
        id: RESOURCE_ID,
        kind: "saved-resource",
        uri: "https://example.com/a",
        digest: BLOB_DIGEST,
        localBlobDigest: BLOB_DIGEST,
        selector: { type: "whole-resource" },
        trust: "imported-source",
        sensitivity: "public",
        capturedAt: createdAt,
        mediaType: "text/plain",
      },
    ],
    policy: { treatResourceTextAsData: true, toolAuthority: "none", allowedPurposes: [purpose] },
    transforms: { secretScanVersion: "v0-none" },
  };
  pack.digest = digestProtocolObject(pack);
  const receipt = {
    version: 1,
    packId: PACK_ID,
    createdAt,
    resources: [
      {
        packResourceId: RESOURCE_ID,
        sourceResourceId: "saved-link-abc",
        snapshotId: "snap-1",
        sourceSelector: { type: "whole-resource" },
        sourceRevision: 1,
        sourceNormalizedBlobDigest: BLOB_DIGEST,
      },
    ],
  };
  const packStore = createContextPackStore({ root });
  await packStore.publishPack({
    pack: pack as never,
    blobs: new Map([[BLOB_DIGEST, blobBytes]]),
    receipt: receipt as never,
  });
  return { packStore, packDigest: pack.digest as string };
}

function rawCandidate(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: `Topic ${index}`,
    question: `Question ${index}?`,
    whyNow: "now",
    scores: {
      groundability: 3,
      decisionValue: 2,
      unresolvedness: 2,
      recurrence: 2,
      novelty: 2,
      timeliness: 2,
      familiarFit: 2,
      feasibility: 2,
      humanResonance: 2,
      riskPenalty: 0,
      visibleTotal: 999, // must be ignored and recomputed
    },
    evidence: [
      { resourceId: RESOURCE_ID, selector: { type: "whole-resource" }, excerpt: BLOB_TEXT, excerptDigest: BLOB_DIGEST },
    ],
    counterevidence: [],
    uncertainty: "low",
    relatedMissionIds: [],
    suggested: { mode: "brief", deliverable: "a report", sourceTarget: 3, wallClockMinutes: 30 },
    ...overrides,
  };
}

function fakeExecutor(candidates: unknown, onExecute?: () => void | Promise<unknown>) {
  let executions = 0;
  return {
    get executions() {
      return executions;
    },
    async execute() {
      executions += 1;
      if (onExecute) await onExecute();
      return { output: { candidates }, modelReceipt: MODEL_RECEIPT };
    },
  };
}

function jobFixture(overrides: Partial<TopicDiscoveryJobV1> = {}): TopicDiscoveryJobV1 {
  return {
    schema: "opencoven.topic-discovery-job/v1",
    id: JOB_ID,
    contextPackId: PACK_ID,
    contextPackDigest: "a".repeat(64),
    familiarId: "charm",
    status: "queued",
    requestedAt: FIXED_NOW,
    proposalIds: [],
    ...overrides,
  };
}

test("createJob runs the pipeline over a sealed pack and returns 3-7 proposals", async () => {
  const root = tempRoot("tdr-happy");
  const { packStore } = await sealPack(root);
  const store = createTopicDiscoveryStore({ root });
  const executor = fakeExecutor([rawCandidate(1), rawCandidate(2), rawCandidate(3), rawCandidate(4)]);

  const runner = createTopicDiscoveryRunner({ root, store, packStore, executor, now: () => FIXED_NOW });
  const result = await runner.createJob({ version: 1, contextPackId: PACK_ID, familiarId: "charm" });

  assert.equal(result.job.status, "completed");
  assert.equal(result.proposals.length, 4);
  assert.equal(result.job.proposalIds.length, 4);
  assert.equal(executor.executions, 1);
  for (const proposal of result.proposals) {
    const parsed = parseTopicProposalV1(proposal);
    assert.ok(parsed.ok, "proposal must round-trip the portable parser");
    if (parsed.ok) {
      assert.equal(parsed.value.contextPackId, PACK_ID);
      // Cave recomputes the total (218 hundredths / 100 = 2.18), never trusting
      // the model's raw "visibleTotal": 999.
      assert.equal(parsed.value.scores.visibleTotal, 2.18);
    }
  }
  const job = (await store.getJob(result.job.id))!;
  assert.equal(job.status, "completed");
  assert.equal((await store.listProposals(job.id)).length, 4);
});

test("createJob refuses a research-run-only pack with purpose_not_allowed", async () => {
  const root = tempRoot("tdr-purpose");
  const { packStore } = await sealPack(root, "research-run");
  const store = createTopicDiscoveryStore({ root });
  const runner = createTopicDiscoveryRunner({ root, store, packStore, executor: fakeExecutor([]), now: () => FIXED_NOW });
  await assert.rejects(
    () => runner.createJob({ version: 1, contextPackId: PACK_ID, familiarId: "charm" }),
    (err: unknown) => err instanceof TopicDiscoveryRunnerError && err.code === "purpose_not_allowed",
  );
});

test("a candidate with one bad evidence ref is dropped", async () => {
  const root = tempRoot("tdr-badevidence");
  const { packStore } = await sealPack(root);
  const store = createTopicDiscoveryStore({ root });
  const candidates = [
    rawCandidate(1),
    rawCandidate(2),
    rawCandidate(3, {
      evidence: [
        { resourceId: RESOURCE_ID, selector: { type: "whole-resource" }, excerpt: "wrong text", excerptDigest: BLOB_DIGEST },
      ],
    }),
    rawCandidate(4),
  ];
  const runner = createTopicDiscoveryRunner({ root, store, packStore, executor: fakeExecutor(candidates), now: () => FIXED_NOW });
  const result = await runner.createJob({ version: 1, contextPackId: PACK_ID, familiarId: "charm" });
  assert.equal(result.job.status, "completed");
  assert.equal(result.proposals.length, 3);
});

test("fewer than 3 grounded candidates fails with no_grounded_proposals", async () => {
  const root = tempRoot("tdr-nogrounded");
  const { packStore } = await sealPack(root);
  const store = createTopicDiscoveryStore({ root });
  const candidates = [
    rawCandidate(1),
    rawCandidate(2, {
      evidence: [
        { resourceId: "resource_missing", selector: { type: "whole-resource" }, excerpt: BLOB_TEXT, excerptDigest: BLOB_DIGEST },
      ],
    }),
    rawCandidate(3, {
      evidence: [
        { resourceId: RESOURCE_ID, selector: { type: "whole-resource" }, excerpt: "wrong text", excerptDigest: BLOB_DIGEST },
      ],
    }),
  ];
  const runner = createTopicDiscoveryRunner({ root, store, packStore, executor: fakeExecutor(candidates), now: () => FIXED_NOW });
  const result = await runner.createJob({ version: 1, contextPackId: PACK_ID, familiarId: "charm" });
  assert.equal(result.job.status, "failed");
  assert.equal(result.job.failure?.code, "no_grounded_proposals");
  assert.equal(result.job.failure?.retryable, false);
  assert.equal(result.proposals.length, 0);
});

test("duplicate candidates are deduplicated by normalized title+question", async () => {
  const root = tempRoot("tdr-dedupe");
  const { packStore } = await sealPack(root);
  const store = createTopicDiscoveryStore({ root });
  const candidates = [
    rawCandidate(1, { title: "Same", question: "Same?" }),
    rawCandidate(2, { title: "  same  ", question: "same?" }),
    rawCandidate(3),
    rawCandidate(4),
  ];
  const runner = createTopicDiscoveryRunner({ root, store, packStore, executor: fakeExecutor(candidates), now: () => FIXED_NOW });
  const result = await runner.createJob({ version: 1, contextPackId: PACK_ID, familiarId: "charm" });
  assert.equal(result.job.status, "completed");
  assert.equal(result.proposals.length, 3);
});

test("a pack deleted mid-run fails the job with context_pack_unavailable", async () => {
  const root = tempRoot("tdr-deleted");
  const { packStore } = await sealPack(root);
  const store = createTopicDiscoveryStore({ root });
  const executor = fakeExecutor([rawCandidate(1), rawCandidate(2), rawCandidate(3)], () =>
    (packStore as ContextPackStore).deletePack(PACK_ID),
  );
  const runner = createTopicDiscoveryRunner({ root, store, packStore, executor, now: () => FIXED_NOW });
  const result = await runner.createJob({ version: 1, contextPackId: PACK_ID, familiarId: "charm" });
  assert.equal(result.job.status, "failed");
  assert.equal(result.job.failure?.code, "context_pack_unavailable");
});

test("reconcile requeues a stale running job and fails an attempts-exhausted job", async () => {
  const root = tempRoot("tdr-reconcile");
  const { packStore, packDigest } = await sealPack(root);
  const store = createTopicDiscoveryStore({ root });
  await store.createJob(jobFixture({ contextPackDigest: packDigest, status: "running", startedAt: "2026-08-28T10:00:00.000Z" }));
  await store.putLease(JOB_ID, {
    version: 1,
    owner: "999@dead",
    attempt: 1,
    leaseExpiresAt: "2026-08-28T09:00:00.000Z", // expired
  });
  const exhausted = jobFixture({ id: "topicjob_exhausted", contextPackDigest: packDigest, status: "running", startedAt: "2026-08-28T10:00:00.000Z" });
  await store.createJob(exhausted);
  await store.putLease("topicjob_exhausted", {
    version: 1,
    owner: "999@dead",
    attempt: TOPIC_DISCOVERY_MAX_ATTEMPTS,
    leaseExpiresAt: "2026-08-28T09:00:00.000Z",
  });

  const runner = createTopicDiscoveryRunner({ root, store, packStore, executor: fakeExecutor([]), now: () => FIXED_NOW });
  const result = await runner.reconcile();
  assert.equal(result.requeued, 1);
  assert.equal(result.failed, 1);
  assert.equal((await store.getJob(JOB_ID))?.status, "queued");
  assert.equal((await store.getJob("topicjob_exhausted"))?.status, "failed");
  assert.equal((await store.getJob("topicjob_exhausted"))?.failure?.code, "attempts_exhausted");
});

test("cancelJob transitions a queued job to cancelled with no failure", async () => {
  const root = tempRoot("tdr-cancel");
  const { packStore, packDigest } = await sealPack(root);
  const store = createTopicDiscoveryStore({ root });
  await store.createJob(jobFixture({ contextPackDigest: packDigest }));
  const runner = createTopicDiscoveryRunner({ root, store, packStore, executor: fakeExecutor([]), now: () => FIXED_NOW });
  const cancelled = await runner.cancelJob(JOB_ID);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.failure, undefined);
  assert.equal((await store.getJob(JOB_ID))?.status, "cancelled");
  // cancel is idempotent only for non-terminal jobs; a terminal job refuses.
  await assert.rejects(
    () => runner.cancelJob(JOB_ID),
    (err: unknown) => err instanceof TopicDiscoveryRunnerError && err.code === "job_not_cancellable",
  );
});

test("two concurrent runJob calls resolve to a single execution", async () => {
  const root = tempRoot("tdr-concurrent");
  const { packStore, packDigest } = await sealPack(root);
  const store = createTopicDiscoveryStore({ root });
  await store.createJob(jobFixture({ contextPackDigest: packDigest }));
  const executor = fakeExecutor([rawCandidate(1), rawCandidate(2), rawCandidate(3)]);
  const runner = createTopicDiscoveryRunner({ root, store, packStore, executor, now: () => FIXED_NOW });
  const [a, b] = await Promise.all([runner.runJob(JOB_ID), runner.runJob(JOB_ID)]);
  assert.equal(executor.executions, 1);
  assert.ok(a.job.status === "completed" || b.job.status === "completed");
  assert.equal((await store.getJob(JOB_ID))?.status, "completed");
});

test("the persisted completed job round-trips the portable parser", async () => {
  const root = tempRoot("tdr-parse");
  const { packStore } = await sealPack(root);
  const store = createTopicDiscoveryStore({ root });
  const runner = createTopicDiscoveryRunner({ root, store, packStore, executor: fakeExecutor([rawCandidate(1), rawCandidate(2), rawCandidate(3)]), now: () => FIXED_NOW });
  const result = await runner.createJob({ version: 1, contextPackId: PACK_ID, familiarId: "charm" });
  const parsed = parseTopicDiscoveryJobV1(await store.getJob(result.job.id));
  assert.ok(parsed.ok);
  if (parsed.ok) {
    assert.equal(parsed.value.status, "completed");
    assert.equal(parsed.value.proposalIds.length, 3);
    assert.ok(parsed.value.modelReceipt);
  }
});

console.log("research topic discovery runner: ok");
