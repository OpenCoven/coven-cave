import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  canonicalJson,
  digestProtocolObject,
  sha256Digest,
} from "./research-protocol/digest.ts";
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

const CLOUD_MANIFEST = JSON.parse(
  await readFile(
    new URL("../../schemas/research/v1/fixtures/valid/run-manifest-final-cloud.json", import.meta.url),
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

function manifestWithChanges(
  changes: Partial<RunManifestV1>,
): RunManifestV1 {
  const candidate = {
    ...structuredClone(MANIFEST),
    ...changes,
  };
  return {
    ...candidate,
    digest: digestProtocolObject(candidate),
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

test("completed authority state is terminal and cannot complete with pending requests", () => {
  const completed = completeResearchRunAuthority(authorityStateWithGrant());
  assert.throws(
    () => requestResearchRunAuthority(completed, {
      id: "request-after-completion",
      capability: "network.query",
      requestedAt: "2026-08-16T20:03:00.000Z",
    }),
    /completed authority state is terminal/,
  );

  const pending = requestResearchRunAuthority(createResearchRunAuthorityState(), {
    id: "request-pending",
    capability: "network.query",
    requestedAt: "2026-08-16T20:00:30.000Z",
  });
  assert.throws(
    () => completeResearchRunAuthority(pending),
    /pending authority requests cannot be completed/,
  );
});

test("authority grants require an explicit boolean exercised field", () => {
  const requested = requestResearchRunAuthority(createResearchRunAuthorityState(), {
    id: "request-network",
    capability: "network.query",
    requestedAt: "2026-08-16T20:00:30.000Z",
  });
  const baseGrant = {
    id: "grant-network",
    requestId: "request-network",
    capability: "network.query",
    grantedAt: "2026-08-16T20:01:00.000Z",
  };
  assert.throws(
    () => grantResearchRunAuthority(
      requested,
      baseGrant as Parameters<typeof grantResearchRunAuthority>[1],
    ),
    /exercised must be boolean/,
  );
  assert.throws(
    () => grantResearchRunAuthority(requested, {
      ...baseGrant,
      exercised: "true",
    } as unknown as Parameters<typeof grantResearchRunAuthority>[1]),
    /exercised must be boolean/,
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

test("authority validation rejects unknown fields in its closed schemas", () => {
  const coherent = completeResearchRunAuthority(authorityStateWithGrant());
  const cases: unknown[] = [
    { ...coherent, unexpected: true },
    {
      ...coherent,
      requests: [{ ...coherent.requests[0], unexpected: true }],
    },
    {
      ...coherent,
      grants: [{ ...coherent.grants[0], unexpected: true }],
    },
  ];
  for (const candidate of cases) {
    assert.throws(
      () => validateResearchRunAuthorityState(candidate),
      /unknown.*field/i,
    );
  }
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
      runtime: "cave-device",
      timestamps: [
        "2026-08-16T19:59:00.000Z",
        "2026-08-16T19:59:00.000Z",
        "2026-08-16T20:06:00.000Z",
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

test("completion receipt provenance comes from one canonically validated terminal run", () => {
  const divergences: Array<{
    label: string;
    run: ResearchRunV1;
    expected: RegExp;
  }> = [
    {
      label: "context",
      run: {
        ...structuredClone(RUN),
        context: {
          ...RUN.context!,
          contextPackDigest: "c".repeat(64),
        },
      },
      expected: /artifactManifest context must match/i,
    },
    {
      label: "model",
      run: {
        ...structuredClone(RUN),
        execution: {
          ...RUN.execution,
          modelBinding: {
            ...RUN.execution.modelBinding,
            model: "gpt-5-mini",
          },
        },
        artifactManifest: manifestWithChanges({
          modelExecutions: structuredClone(CLOUD_MANIFEST.modelExecutions),
          usage: structuredClone(CLOUD_MANIFEST.usage),
        }),
      },
      expected: /effectiveModel must equal the pinned run model/i,
    },
    {
      label: "retention",
      run: {
        ...structuredClone(RUN),
        privacy: {
          ...RUN.privacy,
          retention: "run-only",
        },
      },
      expected: /retention policy must match run privacy retention/i,
    },
    {
      label: "chronology",
      run: {
        ...structuredClone(RUN),
        updatedAt: "2026-08-16T20:00:00.000Z",
      },
      expected: /artifactManifest.*timestamp|manifest.*updatedAt|chronology/i,
    },
    {
      label: "run binding",
      run: {
        ...structuredClone(RUN),
        artifactManifest: manifestWithChanges({ runId: "run_other" }),
      },
      expected: /artifactManifest\.runId must match the enclosing run id/i,
    },
  ];

  for (const divergence of divergences) {
    assert.throws(
      () => createResearchRunCompletionReceipt(divergence.run),
      divergence.expected,
      divergence.label,
    );
  }
});

test("completion receipt manifest overrides cannot replace embedded provenance", () => {
  const alternateManifest = manifestWithChanges({
    artifacts: MANIFEST.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, title: "Alternate valid title" } : artifact),
  });
  const alternateSources = MANIFEST.sources.map((source, index) =>
    index === 0 ? { ...source, id: "ctx_alternate_01" } : source);
  const alternateArtifacts = MANIFEST.artifacts.map((artifact, index) =>
    index === 0 ? { ...artifact, title: "Alternate valid title" } : artifact);

  assert.throws(
    () => createResearchRunCompletionReceipt(RUN, { manifest: alternateManifest }),
    /manifest override must canonically equal the embedded artifactManifest/,
  );
  assert.throws(
    () => createResearchRunCompletionReceipt(RUN, { sourceManifest: alternateSources }),
    /sourceManifest override must canonically equal the embedded manifest sources/,
  );
  assert.throws(
    () => createResearchRunCompletionReceipt(RUN, { artifactManifest: alternateArtifacts }),
    /artifactManifest override must canonically equal the embedded manifest artifacts/,
  );

  assert.doesNotThrow(() =>
    createResearchRunCompletionReceipt(RUN, {
      manifest: structuredClone(MANIFEST),
      sourceManifest: structuredClone(MANIFEST.sources),
      artifactManifest: structuredClone(MANIFEST.artifacts),
    }));
});

test("completion receipt scalar provenance overrides must equal the canonical run", () => {
  const divergences = [
    { familiarId: "another-familiar" },
    { runtime: "user-hosted-executor" },
    { startedAt: "2026-08-16T20:00:00.000Z" },
    { completedAt: "2026-08-16T20:05:00.000Z" },
  ];
  for (const divergence of divergences) {
    assert.throws(
      () => createResearchRunCompletionReceipt(RUN, divergence),
      /override must match the canonical ResearchRun/,
    );
  }
});

test("completion receipts require a terminal run with an embedded final manifest", () => {
  const { artifactManifest: _artifactManifest, ...withoutManifest } = structuredClone(RUN);
  for (const status of ["queued", "publishing"] as const) {
    assert.throws(
      () => createResearchRunCompletionReceipt({
        ...withoutManifest,
        status,
      }),
      /Terminal runs require|completion receipts require a terminal ResearchRun/i,
      status,
    );
  }
  assert.throws(
    () => createResearchRunCompletionReceipt({
      ...withoutManifest,
    }),
    /Terminal runs require an embedded final artifactManifest/i,
  );
});

test("completion receipt grants derive only from matching validated authority state", () => {
  const authority = completeResearchRunAuthority(authorityStateWithGrant());
  assert.throws(
    () => createResearchRunCompletionReceipt(RUN, {
      authority,
      grantsExercised: [{
        ...authority.grants[0],
        id: "grant-forged",
        capability: "repository.write",
      }],
    } as unknown as Parameters<typeof createResearchRunCompletionReceipt>[1]),
    /grantsExercised cannot override validated authority state/,
  );

  const unexercised = completeResearchRunAuthority(grantResearchRunAuthority(
    requestResearchRunAuthority(createResearchRunAuthorityState(), {
      id: "request-network",
      capability: "network.query",
      scope: ["example.com"],
      requestedAt: "2026-08-16T20:00:30.000Z",
    }),
    {
      id: "grant-network",
      requestId: "request-network",
      capability: "network.query",
      scope: ["example.com"],
      grantedAt: "2026-08-16T20:01:00.000Z",
      exercised: false,
    },
  ));
  assert.deepEqual(
    createResearchRunCompletionReceipt(RUN, { authority: unexercised }).grantsExercised,
    [],
  );
});

test("completion receipt validation accepts only explicitly exercised grants", () => {
  const receipt = createResearchRunCompletionReceipt(RUN, {
    authority: completeResearchRunAuthority(authorityStateWithGrant()),
  });
  for (const exercised of [false, undefined, "true"] as const) {
    const grant = { ...receipt.grantsExercised[0] } as Record<string, unknown>;
    if (exercised === undefined) delete grant.exercised;
    else grant.exercised = exercised;
    const candidate = receiptWithValidDigest(receipt, {
      grantsExercised: [grant as ResearchRunCompletionReceiptV1["grantsExercised"][number]],
    });
    assert.throws(
      () => validateResearchRunCompletionReceipt(candidate),
      exercised === false
        ? /grantsExercised\[0\]\.exercised must be true/
        : /grantsExercised\[0\]\.exercised must be boolean/,
    );
    assert.equal(verifyResearchRunCompletionReceipt(candidate), false);
  }
});

test("completion receipt validation rejects unknown fields in every closed schema", () => {
  const original = createResearchRunCompletionReceipt(RUN, {
    authority: completeResearchRunAuthority(authorityStateWithGrant()),
    planRevisionHistory: [{
      revision: 1,
      at: "2026-08-16T20:00:10.000Z",
    }],
    partialFailures: [{
      code: "source_unavailable",
      message: "One optional source was unavailable",
    }],
  });
  const cases: ResearchRunCompletionReceiptV1[] = [
    { ...structuredClone(original), unexpected: true } as ResearchRunCompletionReceiptV1,
    {
      ...structuredClone(original),
      grantsExercised: [{ ...original.grantsExercised[0], unexpected: true }],
    } as unknown as ResearchRunCompletionReceiptV1,
    {
      ...structuredClone(original),
      planRevisionHistory: [{ ...original.planRevisionHistory[0], unexpected: true }],
    } as unknown as ResearchRunCompletionReceiptV1,
    {
      ...structuredClone(original),
      partialFailures: [{ ...original.partialFailures[0], unexpected: true }],
    } as unknown as ResearchRunCompletionReceiptV1,
  ];

  for (const candidate of cases) {
    assert.throws(
      () => validateResearchRunCompletionReceipt(candidate),
      /unknown.*field/i,
    );
    assert.equal(verifyResearchRunCompletionReceipt(candidate), false);
  }
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
      citationCount: 2,
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
