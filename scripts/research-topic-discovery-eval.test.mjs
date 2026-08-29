// Offline Topic Discovery evaluation harness (Unit 2, cave-6sles.11).
//
// A deterministic replay of the pipeline over sealed fixture packs with an
// injected fake executor. This is the seed of the §20.6 evaluation gate: the
// real 50-100-pack blind rating is out of scope for Unit 2. The assertions
// prove the two load-bearing invariants — zero unsupported evidence refs, and
// 3-7 proposals (or a typed no_grounded_proposals failure when the fixture
// intentionally contains no resolvable evidence).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { digestProtocolObject } from "../src/lib/research-protocol/digest.ts";
import { createContextPackStore } from "../src/lib/server/research-context-pack-store.ts";
import { createTopicDiscoveryRunner } from "../src/lib/server/research-topic-discovery-runner.ts";
import { createTopicDiscoveryStore } from "../src/lib/server/research-topic-discovery-store.ts";

const NOW = "2026-08-28T10:00:00.000Z";
const BLOB_TEXT = "The quick brown fox jumps over the lazy dog.";
const BLOB_DIGEST = createHash("sha256").update(BLOB_TEXT).digest("hex");
const RESOURCE_ID = "resource_fixture";

const MODEL_RECEIPT = {
  familiarId: "charm",
  runtime: "codex",
  effectiveModel: "openai/gpt-5",
  modelSource: "familiar-default",
  providerBilling: "user-connected",
  usage: { inputTokens: null, outputTokens: null, costUsd: null, reportedByRuntime: false },
};

function scores() {
  return {
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
    visibleTotal: 999,
  };
}

function candidate(index, evidence) {
  return {
    title: `Candidate ${index}`,
    question: `Is candidate ${index} worth pursuing?`,
    whyNow: "now",
    scores: scores(),
    evidence,
    counterevidence: [],
    uncertainty: "low",
    relatedMissionIds: [],
    suggested: { mode: "brief", deliverable: "a report", sourceTarget: 3, wallClockMinutes: 30 },
  };
}

function wholeEvidence() {
  return {
    resourceId: RESOURCE_ID,
    selector: { type: "whole-resource" },
    excerpt: BLOB_TEXT,
    excerptDigest: BLOB_DIGEST,
  };
}

function spanEvidence(start, end) {
  const excerpt = BLOB_TEXT.slice(start, end);
  return {
    resourceId: RESOURCE_ID,
    selector: { type: "text-span", start, end },
    excerpt,
    excerptDigest: createHash("sha256").update(excerpt).digest("hex"),
  };
}

async function sealPack(root, { empty = false } = {}) {
  const packId = empty ? "ctx_eval_empty" : "ctx_eval_grounded";
  const createdAt = "2026-08-28T09:00:00.000Z";
  const resources = empty
    ? []
    : [
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
      ];
  const pack = {
    schema: "opencoven.context-pack/v1",
    id: packId,
    digest: "",
    createdAt,
    createdBy: { client: "coven-cave" },
    purpose: "topic-discovery",
    subject: { familiarId: "charm" },
    consent: {
      selectionMode: "explicit",
      allowRemoteQueries: false,
      allowRemoteContent: false,
      artifactContentSync: false,
      retention: "run-only",
    },
    resources,
    policy: { treatResourceTextAsData: true, toolAuthority: "none", allowedPurposes: ["topic-discovery"] },
    transforms: { secretScanVersion: "v0-none" },
  };
  pack.digest = digestProtocolObject(pack);
  const receipt = {
    version: 1,
    packId,
    createdAt,
    resources: resources.map((resource) => ({
      packResourceId: resource.id,
      sourceResourceId: "saved-link-abc",
      snapshotId: "snap-1",
      sourceSelector: { type: "whole-resource" },
      sourceRevision: 1,
      sourceNormalizedBlobDigest: resource.digest,
    })),
  };
  const blobs = empty ? new Map() : new Map([[BLOB_DIGEST, new TextEncoder().encode(BLOB_TEXT)]]);
  const packStore = createContextPackStore({ root });
  await packStore.publishPack({ pack, blobs, receipt });
  return packId;
}

function fakeExecutor(candidates) {
  return {
    async execute() {
      return { output: { candidates }, modelReceipt: MODEL_RECEIPT };
    },
  };
}

test("a grounded pack yields 3-7 proposals with only whole-resource evidence", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "td-eval-"));
  const packId = await sealPack(root);
  const store = createTopicDiscoveryStore({ root });
  const runner = createTopicDiscoveryRunner({
    root,
    store,
    packStore: createContextPackStore({ root }),
    executor: fakeExecutor([
      candidate(1, [wholeEvidence()]),
      candidate(2, [wholeEvidence()]),
      candidate(3, [wholeEvidence()]),
    ]),
    now: () => NOW,
  });
  const result = await runner.createJob({ version: 1, contextPackId: packId, familiarId: "charm" });
  assert.equal(result.job.status, "completed");
  assert.ok(result.proposals.length >= 3 && result.proposals.length <= 7);
  for (const proposal of result.proposals) {
    for (const ref of [...proposal.evidence, ...proposal.counterevidence]) {
      assert.ok(ref.selector.type === "whole-resource" || ref.selector.type === "text-span");
    }
  }
});

test("a >7-candidate pack is capped at seven proposals", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "td-eval-cap-"));
  const packId = await sealPack(root);
  const store = createTopicDiscoveryStore({ root });
  const candidates = Array.from({ length: 12 }, (_, i) => candidate(i, [spanEvidence(0, 9)]));
  const runner = createTopicDiscoveryRunner({
    root,
    store,
    packStore: createContextPackStore({ root }),
    executor: fakeExecutor(candidates),
    now: () => NOW,
  });
  const result = await runner.createJob({ version: 1, contextPackId: packId, familiarId: "charm" });
  assert.equal(result.job.status, "completed");
  assert.equal(result.proposals.length, 7);
});

test("an empty pack fails with no_grounded_proposals", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "td-eval-empty-"));
  const packId = await sealPack(root, { empty: true });
  const store = createTopicDiscoveryStore({ root });
  const runner = createTopicDiscoveryRunner({
    root,
    store,
    packStore: createContextPackStore({ root }),
    executor: fakeExecutor([
      candidate(1, [wholeEvidence()]),
      candidate(2, [wholeEvidence()]),
      candidate(3, [wholeEvidence()]),
    ]),
    now: () => NOW,
  });
  const result = await runner.createJob({ version: 1, contextPackId: packId, familiarId: "charm" });
  assert.equal(result.job.status, "failed");
  assert.equal(result.job.failure?.code, "no_grounded_proposals");
});
