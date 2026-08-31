import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { canonicalJson, sha256Digest } from "./research-protocol/digest.ts";
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
  type ResearchRunCompletionReceiptV1,
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

const TEST_ARTIFACTS_ROOT = path.join(process.cwd(), ".test-artifacts");

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

function receiptWithValidDigest(
  receipt: ResearchRunCompletionReceiptV1,
  changes: Partial<Omit<ResearchRunCompletionReceiptV1, "integrityDigest">>,
): ResearchRunCompletionReceiptV1 {
  const { integrityDigest: _integrityDigest, ...current } = receipt;
  const unsigned = { ...current, ...changes };
  return {
    ...unsigned,
    integrityDigest: sha256Digest(canonicalJson(unsigned)),
  };
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

test("authority grants require the pending request capability and canonical scope", () => {
  const requested = requestResearchRunAuthority(createResearchRunAuthorityState(), {
    id: "request-repo-read",
    capability: "repository.read",
    scope: { repository: "coven-cave", paths: ["src", "schemas"] },
    requestedAt: "2026-08-16T20:00:30.000Z",
  });

  assert.throws(
    () => grantResearchRunAuthority(requested, {
      id: "grant-wrong-capability",
      requestId: "request-repo-read",
      capability: "repository.write",
      scope: { paths: ["src", "schemas"], repository: "coven-cave" },
      grantedAt: "2026-08-16T20:01:00.000Z",
      exercised: true,
    }),
    /capability must canonically match the pending authority request/,
  );
  assert.throws(
    () => grantResearchRunAuthority(requested, {
      id: "grant-wrong-scope",
      requestId: "request-repo-read",
      capability: "repository.read",
      scope: { paths: ["src"], repository: "coven-cave" },
      grantedAt: "2026-08-16T20:01:00.000Z",
      exercised: true,
    }),
    /scope must canonically match the pending authority request/,
  );
  assert.equal(requested.status, "awaiting_authority");
  assert.equal(requested.requests[0]?.status, "pending");
  assert.deepEqual(requested.grants, []);

  const granted = grantResearchRunAuthority(requested, {
    id: "grant-repo-read",
    requestId: "request-repo-read",
    capability: "repository.read",
    scope: { paths: ["src", "schemas"], repository: "coven-cave" },
    grantedAt: "2026-08-16T20:01:00.000Z",
    exercised: true,
  });
  assert.equal(granted.status, "running");
  assert.equal(granted.requests[0]?.status, "granted");
});

test("authority grants reject nonexistent and already-resolved requests", () => {
  const requested = requestResearchRunAuthority(createResearchRunAuthorityState(), {
    id: "request-network",
    capability: "network.query",
    scope: ["example.com"],
    requestedAt: "2026-08-16T20:00:30.000Z",
  });
  const missingRequestGrant = {
    id: "grant-missing",
    requestId: "request-other",
    capability: "network.query",
    scope: ["example.com"],
    grantedAt: "2026-08-16T20:01:00.000Z",
    exercised: true,
  };
  assert.throws(
    () => grantResearchRunAuthority(requested, missingRequestGrant),
    /must identify an existing pending authority request/,
  );

  const granted = grantResearchRunAuthority(requested, {
    ...missingRequestGrant,
    id: "grant-network",
    requestId: "request-network",
  });
  assert.throws(
    () => grantResearchRunAuthority(granted, {
      ...missingRequestGrant,
      id: "grant-network-again",
      requestId: "request-network",
    }),
    /must identify an existing pending authority request/,
  );
  assert.equal(granted.status, "running");
  assert.equal(granted.grants.length, 1);
});

test("authority requests are new pending transitions and cannot reopen a resolved id", () => {
  assert.throws(
    () => requestResearchRunAuthority(createResearchRunAuthorityState(), {
      id: "request-network",
      capability: "network.query",
      requestedAt: "2026-08-16T20:00:30.000Z",
      status: "granted",
    }),
    /new authority requests must be pending/,
  );

  const granted = authorityStateWithGrant();
  assert.throws(
    () => requestResearchRunAuthority(granted, {
      id: "request-repo-read",
      capability: "repository.read",
      scope: { repository: "coven-cave" },
      requestedAt: "2026-08-16T20:02:00.000Z",
    }),
    /authority request id already exists/,
  );
});

test("authority validation rejects grants without one matching resolved request", () => {
  const coherent = authorityStateWithGrant();
  const { resolvedAt: _resolvedAt, ...pendingRequest } = coherent.requests[0];
  assert.deepEqual(validateResearchRunAuthorityState(coherent), coherent);

  assert.throws(
    () => validateResearchRunAuthorityState({
      ...coherent,
      grants: [{ ...coherent.grants[0], capability: "repository.write" }],
    }),
    /capability must canonically match its authority request/,
  );
  assert.throws(
    () => validateResearchRunAuthorityState({
      ...coherent,
      grants: [{ ...coherent.grants[0], scope: { repository: "another-repo" } }],
    }),
    /scope must canonically match its authority request/,
  );
  assert.throws(
    () => validateResearchRunAuthorityState({
      status: "running",
      requests: [{ ...pendingRequest, status: "pending" }],
      grants: [],
    }),
    /pending requests require awaiting_authority status/,
  );
  assert.throws(
    () => validateResearchRunAuthorityState({
      status: "running",
      requests: coherent.requests,
      grants: [],
    }),
    /granted requests require exactly one matching authority grant/,
  );
  assert.throws(
    () => validateResearchRunAuthorityState({
      status: "running",
      requests: [],
      grants: coherent.grants,
    }),
    /must identify an existing granted authority request/,
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

test("completion receipt creation rejects malformed and duplicate manifest provenance", () => {
  const malformedSource = {
    ...MANIFEST.sources[0],
    digest: "not-a-digest",
  };
  assert.throws(
    () => createResearchRunCompletionReceipt(RUN, {
      sourceManifest: [malformedSource],
    }),
    /sourceManifest.*digest/i,
  );
  assert.throws(
    () => createResearchRunCompletionReceipt(RUN, {
      sourceManifest: [MANIFEST.sources[0], MANIFEST.sources[0]],
    }),
    /sourceManifest.*unique/i,
  );

  const malformedArtifact = {
    ...MANIFEST.artifacts[0],
    title: "../receipt.json",
  };
  assert.throws(
    () => createResearchRunCompletionReceipt(RUN, {
      artifactManifest: [malformedArtifact],
    }),
    /artifactManifest.*title/i,
  );
  assert.throws(
    () => createResearchRunCompletionReceipt(RUN, {
      artifactManifest: [MANIFEST.artifacts[0], MANIFEST.artifacts[0]],
    }),
    /artifactManifest.*unique/i,
  );
});

test("schema-invalid manifest provenance cannot verify with a matching receipt digest", () => {
  const receipt = createResearchRunCompletionReceipt(RUN);
  const malformedSourceReceipt = receiptWithValidDigest(receipt, {
    sourceManifest: [{
      ...receipt.sourceManifest[0],
      digest: "not-a-digest",
    }],
  });
  assert.equal(verifyResearchRunCompletionReceipt(malformedSourceReceipt), false);
  assert.throws(
    () => validateResearchRunCompletionReceipt(malformedSourceReceipt),
    /sourceManifest.*digest/i,
  );

  const duplicateArtifactReceipt = receiptWithValidDigest(receipt, {
    artifactManifest: [receipt.artifactManifest[0], receipt.artifactManifest[0]],
  });
  assert.equal(verifyResearchRunCompletionReceipt(duplicateArtifactReceipt), false);
  assert.throws(
    () => validateResearchRunCompletionReceipt(duplicateArtifactReceipt),
    /artifactManifest.*unique/i,
  );
});

test("completion receipt validation requires both manifest provenance arrays", () => {
  const receipt = createResearchRunCompletionReceipt(RUN);
  for (const field of ["sourceManifest", "artifactManifest"] as const) {
    const missing = structuredClone(receipt) as Record<string, unknown>;
    delete missing[field];
    const { integrityDigest: _integrityDigest, ...unsigned } = missing;
    missing.integrityDigest = sha256Digest(canonicalJson(unsigned));
    assert.throws(
      () => validateResearchRunCompletionReceipt(missing),
      new RegExp(`${field}.*array`, "i"),
    );
    assert.equal(verifyResearchRunCompletionReceipt(missing), false);
  }
});

test("completion receipts survive an atomic store round trip and reject tampering", async () => {
  await mkdir(TEST_ARTIFACTS_ROOT, { recursive: true });
  const root = await mkdtemp(path.join(TEST_ARTIFACTS_ROOT, "coven-receipt-"));
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

    const malformed = receiptWithValidDigest(receipt, {
      artifactManifest: [{
        ...receipt.artifactManifest[0],
        title: "../receipt.json",
      }],
    });
    await assert.rejects(
      () => saveResearchRunCompletionReceipt(malformed, root),
      /artifactManifest.*title/i,
    );
    await writeFile(
      path.join(root, `${RUN.id}.json`),
      JSON.stringify(malformed),
    );
    await assert.rejects(
      () => loadResearchRunCompletionReceipt(RUN.id, root),
      /artifactManifest.*title/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
