import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import type { ResearchRunV1 } from "./research-protocol/research-run.ts";
import type { RunManifestV1 } from "./research-protocol/run-manifest.ts";
import {
  completeResearchRunAuthority,
  createResearchRunAuthorityState,
  createResearchRunCompletionReceipt,
  grantResearchRunAuthority,
  requestResearchRunAuthority,
  serializeResearchRunAuthorityState,
  serializeResearchRunCompletionReceipt,
  validateResearchRunAuthorityState,
  validateResearchRunCompletionReceipt,
  verifyResearchRunCompletionReceipt,
} from "./research-run-authority-receipt.ts";
import {
  loadResearchRunCompletionReceipt,
  saveResearchRunCompletionReceipt,
} from "./server/research-run-receipt-store.ts";

const MANIFEST = JSON.parse(
  await readFile(
    new URL("../../schemas/research/v1/fixtures/valid/run-manifest-final-local.json", import.meta.url),
    "utf8",
  ),
) as RunManifestV1;

const RUN: ResearchRunV1 = {
  schema: "opencoven.research-run/v1",
  id: MANIFEST.runId,
  context: {
    contextPackId: "ctx_local_01",
    contextPackDigest: "a".repeat(64),
    topicProposalId: "proposal_local_01",
  },
  acceptedTopic: {
    proposalId: "proposal_local_01",
    question: "How should a durable receipt identify its evidence?",
    editedByUser: false,
  },
  execution: {
    location: "local",
    modelExecution: "cave-device",
    modelBinding: {
      familiarId: "sage",
      selection: "pinned",
      model: "gpt-5.6-sol",
    },
    strategy: "single-agent",
  },
  privacy: {
    remoteQueries: false,
    remoteContent: false,
    artifactContentSync: false,
    retention: "7-days",
    allowMemoryPromotion: false,
  },
  bounds: {
    wallClockMinutes: 45,
    maxIterations: 4,
    sourceTarget: 8,
    checkpointEvery: 2,
    stopWhenCostUnavailable: true,
  },
  status: "completed",
  createdAt: "2026-08-16T19:59:00.000Z",
  updatedAt: "2026-08-16T20:06:00.000Z",
  nextEventSequence: 2,
  artifactManifest: MANIFEST,
};

function authorityStateWithGrant() {
  const requested = requestResearchRunAuthority(createResearchRunAuthorityState(), {
    id: "request-repo-read",
    capability: "repository.read",
    scope: { repository: "coven-cave" },
    reason: "Read the selected research source",
    requestedAt: "2026-08-16T20:00:30.000Z",
  });
  return grantResearchRunAuthority(requested, {
    id: "grant-repo-read",
    requestId: "request-repo-read",
    capability: "repository.read",
    scope: { repository: "coven-cave" },
    mode: "once",
    grantedAt: "2026-08-16T20:01:00.000Z",
    exercised: true,
  });
}

test("authority state makes a permission wait explicit and records its grant", () => {
  const requested = requestResearchRunAuthority(createResearchRunAuthorityState(), {
    id: "request-network",
    capability: "network.query",
    scope: ["example.com"],
    requestedAt: "2026-08-16T20:00:30.000Z",
  });
  assert.equal(requested.status, "awaiting_authority");
  assert.equal(requested.requests[0]?.status, "pending");

  const granted = grantResearchRunAuthority(requested, {
    id: "grant-network",
    requestId: "request-network",
    capability: "network.query",
    scope: ["example.com"],
    grantedAt: "2026-08-16T20:01:00.000Z",
    exercised: true,
  });
  assert.equal(granted.status, "running");
  assert.equal(granted.requests[0]?.status, "granted");
  assert.equal(granted.grants[0]?.requestId, "request-network");

  const completed = completeResearchRunAuthority(granted);
  assert.equal(completed.status, "completed");
  assert.deepEqual(
    validateResearchRunAuthorityState(JSON.parse(serializeResearchRunAuthorityState(completed))),
    completed,
  );
});

test("completion receipts contain manifest provenance and a deterministic integrity digest", () => {
  const receipt = createResearchRunCompletionReceipt(RUN, {
    authority: authorityStateWithGrant(),
    planRevisionHistory: [
      {
        revision: 2,
        digest: "b".repeat(64),
        at: "2026-08-16T20:02:00.000Z",
        reason: "Narrowed the source target",
      },
      {
        revision: 1,
        digest: "a".repeat(64),
        at: "2026-08-16T20:00:10.000Z",
      },
    ],
    skillId: "research.synthesis",
    skillVersion: "1.4.0",
    runtime: "cave-device:gpt-5.6-sol",
    citationCount: 6,
    partialFailures: [
      {
        code: "source_unavailable",
        message: "One optional source was unavailable",
        retryable: true,
        at: "2026-08-16T20:03:00.000Z",
        phase: "challenge",
      },
    ],
    completedAt: "2026-08-16T20:04:00.000Z",
  });

  assert.deepEqual(
    {
      runId: receipt.runId,
      familiarId: receipt.familiarId,
      skill: [receipt.skillId, receipt.skillVersion],
      runtime: receipt.runtime,
      timestamps: [receipt.createdAt, receipt.startedAt, receipt.completedAt],
      planRevisions: receipt.planRevisionHistory.map((item) => item.revision),
      grants: receipt.grantsExercised.map((item) => item.id),
      sources: receipt.sourceManifest.length,
      artifacts: receipt.artifactManifest.length,
      citations: receipt.citationCount,
      partialFailures: receipt.partialFailures.length,
    },
    {
      runId: RUN.id,
      familiarId: "sage",
      skill: ["research.synthesis", "1.4.0"],
      runtime: "cave-device:gpt-5.6-sol",
      timestamps: [
        "2026-08-16T19:59:00.000Z",
        "2026-08-16T19:59:00.000Z",
        "2026-08-16T20:04:00.000Z",
      ],
      planRevisions: [1, 2],
      grants: ["grant-repo-read"],
      sources: 1,
      artifacts: 1,
      citations: 6,
      partialFailures: 1,
    },
  );
  assert.equal(verifyResearchRunCompletionReceipt(receipt), true);

  const serialized = serializeResearchRunCompletionReceipt(receipt);
  const parsed = validateResearchRunCompletionReceipt(JSON.parse(serialized));
  assert.deepEqual(parsed, receipt);
  assert.equal(
    createResearchRunCompletionReceipt(RUN, {
      authority: authorityStateWithGrant(),
      planRevisionHistory: receipt.planRevisionHistory,
      skillId: receipt.skillId,
      skillVersion: receipt.skillVersion,
      runtime: receipt.runtime,
      citationCount: receipt.citationCount,
      partialFailures: receipt.partialFailures,
      completedAt: receipt.completedAt,
    }).integrityDigest,
    receipt.integrityDigest,
  );

  const tampered = JSON.parse(serialized) as Record<string, unknown>;
  tampered.citationCount = 7;
  assert.equal(verifyResearchRunCompletionReceipt(tampered), false);
});

test("completion receipts survive an atomic store round trip and reject tampering", async () => {
  const root = await mkdtemp(path.join(process.env.TMPDIR || "/tmp", "coven-receipt-"));
  try {
    const receipt = createResearchRunCompletionReceipt(RUN, {
      authority: authorityStateWithGrant(),
      skillId: "research.synthesis",
      skillVersion: "1.4.0",
      runtime: "cave-device:gpt-5.6-sol",
      citationCount: 2,
      completedAt: "2026-08-16T20:04:00.000Z",
    });
    await saveResearchRunCompletionReceipt(receipt, root);
    assert.equal(
      await readFile(path.join(root, `${RUN.id}.json`), "utf8"),
      serializeResearchRunCompletionReceipt(receipt),
    );
    assert.deepEqual(await loadResearchRunCompletionReceipt(RUN.id, root), receipt);

    const tampered = JSON.parse(
      await readFile(path.join(root, `${RUN.id}.json`), "utf8"),
    ) as Record<string, unknown>;
    tampered.runtime = "tampered";
    await writeFile(
      path.join(root, `${RUN.id}.json`),
      JSON.stringify(tampered),
    );
    await assert.rejects(
      () => loadResearchRunCompletionReceipt(RUN.id, root),
      /integrity validation/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
