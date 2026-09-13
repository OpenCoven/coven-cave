import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EVENT_KIND_UNSUPPORTED,
  EVENT_SHAPE_INVALID,
  SCHEMA_VERSION_UNSUPPORTED,
  STATE_TRANSITION_INVALID,
  STREAM_KIND_UNSUPPORTED,
  STREAM_OUT_OF_ORDER,
  createAutomationsV1OccurrenceProjection,
  parseAutomationsV1OccurrenceTransitionEvent,
  replayAutomationsV1OccurrenceTransitionEvents,
  snapshotAutomationsV1OccurrenceProjection,
} from "./coven-automations-v1-consumer.ts";

interface ArtifactLock {
  schemaVersion: number;
  issue: string;
  parentIssue: string;
  producer: {
    repository: string;
    repositoryId: number;
    sourceCommit: string;
    sourceTree: string;
    workflow: {
      id: number;
      name: string;
      path: string;
      runId: number;
      runAttempt: number;
      event: string;
      headBranch: string;
      size: number;
      sha256: string;
    };
    job: {
      id: number;
      name: string;
      runnerLabels: string[];
    };
  };
  artifact: {
    id: number;
    name: string;
    archiveSize: number;
    archiveSha256: string;
    bundle: {
      path: string;
      size: number;
      sha256: string;
    };
    manifest: {
      path: string;
      size: number;
      sha256: string;
    };
  };
  contract: {
    profile: string;
    contentSha256: string;
    manifestFiles: number;
  };
}

interface ArtifactManifestEntry {
  path: string;
  sha256: string;
  size: number;
}

interface ArtifactManifest {
  schemaVersion: string;
  contractProfile: string;
  sourceCommit: string;
  contractContentSha256: string;
  files: ArtifactManifestEntry[];
}

interface ChangefeedCase {
  name: string;
  kind: string;
  stream: {
    kind: string;
    id: string;
  };
  consumerCursor?: number;
  deliveries?: string[];
  reductions?: Array<{
    label: string;
    cursor: number;
    deliveries: string;
  }>;
  errorCode?: string;
}

interface TestVectors {
  fixtures: {
    "event.occurrence.sequence": unknown[];
  };
  cases: ChangefeedCase[];
}

const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const artifactRoot = path.join(root, "conformance", "automations-v1-artifact");
const contractRoot = path.join(artifactRoot, "coven-automations-v1");
const lockPath = path.join(root, "conformance", "automations-v1-artifact-lock.json");
const manifestPath = path.join(artifactRoot, "manifest.json");
const testVectorsPath = path.join(contractRoot, "test-vectors.json");
const conformanceManifestPath = path.join(contractRoot, "conformance-manifest.json");

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

function readLock(): ArtifactLock {
  return readJson<ArtifactLock>(lockPath);
}

function readManifest(): ArtifactManifest {
  return readJson<ArtifactManifest>(manifestPath);
}

function readTestVectors(): TestVectors {
  return readJson<TestVectors>(testVectorsPath);
}

function assertArtifactIntegrity(
  lock: ArtifactLock,
  manifest: ArtifactManifest,
): ArtifactManifestEntry[] {
  assert.equal(lock.contract.profile, "coven.automations.v1");
  assert.equal(manifest.contractProfile, lock.contract.profile);
  assert.equal(manifest.schemaVersion, "coven.automations.bundle.v1");
  assert.equal(manifest.sourceCommit, lock.producer.sourceCommit);
  assert.equal(manifest.files.length, lock.contract.manifestFiles);
  assert.equal(sha256(readFileSync(manifestPath)), lock.artifact.manifest.sha256);
  assert.equal(readFileSync(manifestPath).length, lock.artifact.manifest.size);

  const actualContentSha256 = sha256(
    Buffer.from(
      manifest.files.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(""),
      "utf8",
    ),
  );
  assert.equal(actualContentSha256, manifest.contractContentSha256);
  assert.equal(actualContentSha256, lock.contract.contentSha256);

  for (const entry of manifest.files) {
    assert.ok(!entry.path.includes("/"), `${entry.path} must stay flat inside the vendored contract directory`);
    const bytes = readFileSync(path.join(contractRoot, entry.path));
    assert.equal(bytes.length, entry.size, `${entry.path} size drifted`);
    assert.equal(sha256(bytes), entry.sha256, `${entry.path} digest drifted`);
  }

  const conformanceManifest = readJson<{
    canaryRequirements?: Record<string, string>;
  }>(conformanceManifestPath);
  assert.equal(
    conformanceManifest.canaryRequirements?.cave,
    "Consumes the event envelope and read-model reducer vectors against the exact released artifact version.",
  );

  return manifest.files;
}

function verifyArtifactSet(
  lock: ArtifactLock,
  manifest: ArtifactManifest,
  files: Map<string, Buffer>,
  caveRequirement = "Consumes the event envelope and read-model reducer vectors against the exact released artifact version.",
): void {
  assert.equal(lock.schemaVersion, 1, "artifact lock schemaVersion drifted");
  assert.equal(lock.issue, "OpenCoven/sdk#80", "artifact lock issue binding drifted");
  assert.equal(lock.parentIssue, "OpenCoven/coven#855", "artifact lock parent issue binding drifted");
  assert.equal(manifest.sourceCommit, lock.producer.sourceCommit, "manifest source commit drifted");
  assert.equal(manifest.contractProfile, lock.contract.profile, "manifest profile drifted");
  assert.equal(manifest.files.length, lock.contract.manifestFiles, "manifest file count drifted");
  assert.equal(
    manifest.contractContentSha256,
    sha256(Buffer.from(manifest.files.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(""), "utf8")),
    "manifest content digest drifted",
  );
  assert.equal(
    manifest.contractContentSha256,
    lock.contract.contentSha256,
    "lock content digest drifted",
  );

  for (const entry of manifest.files) {
    const bytes = files.get(entry.path);
    assert.ok(bytes, `missing vendored contract file ${entry.path}`);
    assert.equal(bytes.length, entry.size, `${entry.path} size drifted`);
    assert.equal(sha256(bytes), entry.sha256, `${entry.path} digest drifted`);
  }

  assert.equal(
    files.size,
    manifest.files.length,
    "vendored contract directory contains a missing or unexpected file",
  );
  assert.equal(
    caveRequirement,
    "Consumes the event envelope and read-model reducer vectors against the exact released artifact version.",
    "vendored cave canary requirement drifted",
  );
}

function contractFilesFromDisk(manifest: ArtifactManifest): Map<string, Buffer> {
  return new Map(
    manifest.files.map((entry) => [entry.path, readFileSync(path.join(contractRoot, entry.path))]),
  );
}

function requireChangefeedCase(vectors: TestVectors, name: string): ChangefeedCase {
  const found = vectors.cases.find((entry) => entry.name === name);
  assert.ok(found, `missing changefeed case ${name}`);
  return found;
}

function resolveSequenceReference(reference: string, vectors: TestVectors): unknown[] {
  const prefix = "event.occurrence.sequence[";
  assert.ok(reference.startsWith(prefix), `unsupported delivery reference ${reference}`);
  assert.ok(reference.endsWith("]"), `unsupported delivery reference ${reference}`);
  const indexText = reference.slice(prefix.length, -1);
  if (!/^\d+$/u.test(indexText)) {
    throw new Error(`unsupported delivery reference ${reference}`);
  }
  const index = Number.parseInt(indexText, 10);
  return [vectors.fixtures["event.occurrence.sequence"][index]];
}

function resolveReductionDeliveries(reference: string, vectors: TestVectors): unknown[] {
  if (reference === "event.occurrence.sequence[0..5]") {
    return vectors.fixtures["event.occurrence.sequence"].slice(0, 6);
  }
  if (reference === "event.occurrence.sequence[0..5] plus a duplicate of [3]") {
    const base = vectors.fixtures["event.occurrence.sequence"].slice(0, 6);
    return [...base, vectors.fixtures["event.occurrence.sequence"][3]];
  }
  if (reference === "event.occurrence.sequence[3..5]") {
    return vectors.fixtures["event.occurrence.sequence"].slice(3, 6);
  }
  throw new Error(`unsupported reduction delivery reference ${reference}`);
}

test("pins the exact automations v1 artifact lock and manifest identities", () => {
  const lock = readLock();
  const manifest = readManifest();

  assert.deepEqual(lock, {
    schemaVersion: 1,
    issue: "OpenCoven/sdk#80",
    parentIssue: "OpenCoven/coven#855",
    producer: {
      repository: "OpenCoven/coven",
      repositoryId: 1222160568,
      sourceCommit: "8a796807b37d4ad33eaeca37498debf1ca55dd49",
      sourceTree: "bf0261a187139773ce87d97c880669b4532e53c9",
      workflow: {
        id: 267192017,
        name: "CI",
        path: ".github/workflows/ci.yml",
        runId: 33798101313,
        runAttempt: 1,
        event: "push",
        headBranch: "main",
        size: 25064,
        sha256: "c8061bd914b31e0fd77cf73f1301ae8a04a127f68783fa7fbbc41c92f92bac14",
      },
      job: {
        id: 100790644364,
        name: "Automations v1 protocol bundle",
        runnerLabels: ["ubuntu-latest"],
      },
    },
    artifact: {
      id: 9909975069,
      name: "coven-automations-v1-contract-8a796807b37d4ad33eaeca37498debf1ca55dd49",
      archiveSize: 36232,
      archiveSha256: "6f2e239a4694a1f11223a9dc72f5f31971ead0a1b94ff3137fb39b75611a95ac",
      bundle: {
        path: "coven-automations-v1-contract-8a796807b37d4ad33eaeca37498debf1ca55dd49.tar.gz",
        size: 34712,
        sha256: "512460db71d4257d7a4d33ea306578e66d9ac499d9384eb9c2b8e2b4e2e32363",
      },
      manifest: {
        path: "manifest.json",
        size: 2964,
        sha256: "449d79f0a47fd299d0c560bf4a5f63be383e9825067d3ac992cb97ce067c86d2",
      },
    },
    contract: {
      profile: "coven.automations.v1",
      contentSha256: "3c145eb92a93426ed64631f6487a8cd12903b0a49a6e752269f594ac50a779f5",
      manifestFiles: 17,
    },
  });

  assertArtifactIntegrity(lock, manifest);
});

test("rejects missing, corrupted, or mismatched vendored automations contract evidence", () => {
  const lock = readLock();
  const manifest = readManifest();
  const files = contractFilesFromDisk(manifest);
  verifyArtifactSet(lock, manifest, files);

  const missing = new Map(files);
  missing.delete("event-envelope.schema.json");
  assert.throws(
    () => verifyArtifactSet(lock, manifest, missing),
    /missing vendored contract file event-envelope\.schema\.json/u,
  );

  const corrupted = new Map(files);
  const corruptedVectors = Buffer.from(files.get("test-vectors.json") ?? Buffer.alloc(0));
  corruptedVectors[0] = corruptedVectors[0] === 0x7b ? 0x5b : 0x7b;
  corrupted.set("test-vectors.json", corruptedVectors);
  assert.throws(
    () => verifyArtifactSet(lock, manifest, corrupted),
    /test-vectors\.json digest drifted/u,
  );

  assert.throws(
    () =>
      verifyArtifactSet(
        {
          ...lock,
          producer: {
            ...lock.producer,
            sourceCommit: "0000000000000000000000000000000000000000",
          },
        },
        manifest,
        files,
      ),
    /manifest source commit drifted/u,
  );

  assert.throws(
    () => verifyArtifactSet(lock, manifest, files, "wrong cave requirement"),
    /vendored cave canary requirement drifted/u,
  );
});

test("accepts the pinned contract's optional fence generation without weakening present values", () => {
  const event = parseAutomationsV1OccurrenceTransitionEvent(
    readTestVectors().fixtures["event.occurrence.sequence"][0],
  );
  const payload: Partial<typeof event.payload> = { ...event.payload };
  delete payload.fenceGeneration;
  const withoutFence = { ...event, payload };
  const parsed = parseAutomationsV1OccurrenceTransitionEvent(withoutFence);
  assert.equal(Object.hasOwn(parsed.payload, "fenceGeneration"), false);
  const projection = replayAutomationsV1OccurrenceTransitionEvents(
    event.stream,
    [withoutFence],
  );
  assert.equal(projection.state, "planned");
  assert.equal(projection.cursor, 0);

  for (const fenceGeneration of [undefined, null, 0, -1, 1.5, "1"]) {
    assert.throws(
      () =>
        parseAutomationsV1OccurrenceTransitionEvent({
          ...event,
          payload: { ...event.payload, fenceGeneration },
        }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === EVENT_SHAPE_INVALID,
    );
  }
});

test("replays the exact released duplicate-delivery vector without re-applying the duplicate", () => {
  const vectors = readTestVectors();
  const changefeed = requireChangefeedCase(
    vectors,
    "event-duplicate-delivery-is-ignored",
  );
  assert.equal(changefeed.kind, "changefeed");
  assert.deepEqual(changefeed.deliveries, [
    "event.occurrence.sequence[0]",
    "event.occurrence.sequence[1]",
    "event.occurrence.sequence[1]",
    "event.occurrence.sequence[2]",
  ]);

  const duplicateProjection = replayAutomationsV1OccurrenceTransitionEvents(
    {
      kind: "occurrence",
      id: changefeed.stream.id,
    },
    changefeed.deliveries?.flatMap((reference) =>
      resolveSequenceReference(reference, vectors),
    ) ?? [],
  );
  const canonicalProjection = replayAutomationsV1OccurrenceTransitionEvents(
    {
      kind: "occurrence",
      id: changefeed.stream.id,
    },
    vectors.fixtures["event.occurrence.sequence"].slice(0, 3),
  );

  assert.deepEqual(
    snapshotAutomationsV1OccurrenceProjection(duplicateProjection),
    snapshotAutomationsV1OccurrenceProjection(canonicalProjection),
  );
  assert.equal(duplicateProjection.cursor, 2);
  assert.equal(duplicateProjection.state, "claimed");
  assert.equal(duplicateProjection.firstSequence, 0);
  assert.equal(duplicateProjection.lastSequence, 2);
});

test("rejects the exact released out-of-order replay vector with STREAM_OUT_OF_ORDER", () => {
  const vectors = readTestVectors();
  const changefeed = requireChangefeedCase(
    vectors,
    "event-out-of-order-is-rejected-not-reordered",
  );
  const stream = {
    kind: "occurrence" as const,
    id: changefeed.stream.id,
  };
  const checkpoint = replayAutomationsV1OccurrenceTransitionEvents(
    stream,
    vectors.fixtures["event.occurrence.sequence"].slice(0, 3),
  );
  assert.equal(checkpoint.cursor, changefeed.consumerCursor);
  const reconnectSeed = {
    cursor: checkpoint.cursor,
    state: checkpoint.state,
    firstSequence: checkpoint.firstSequence,
    lastSequence: checkpoint.lastSequence,
  };

  assert.throws(
    () =>
      replayAutomationsV1OccurrenceTransitionEvents(
        stream,
        changefeed.deliveries?.flatMap((reference) =>
          resolveSequenceReference(reference, vectors),
        ) ?? [],
        reconnectSeed,
      ),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === STREAM_OUT_OF_ORDER &&
      changefeed.errorCode === STREAM_OUT_OF_ORDER,
  );
});

test("replay and resume converge on the exact released succeeded occurrence read model", () => {
  const vectors = readTestVectors();
  const changefeed = requireChangefeedCase(
    vectors,
    "event-replay-rehydrates-deterministically",
  );
  const stream = {
    kind: "occurrence" as const,
    id: changefeed.stream.id,
  };
  const prefix = replayAutomationsV1OccurrenceTransitionEvents(
    stream,
    vectors.fixtures["event.occurrence.sequence"].slice(0, 3),
  );
  const reductions = new Map<string, ReturnType<typeof snapshotAutomationsV1OccurrenceProjection>>();

  for (const reduction of changefeed.reductions ?? []) {
    const seed =
      reduction.label === "resume-after-cursor-2"
        ? prefix
        : createAutomationsV1OccurrenceProjection(stream);
    const projection = replayAutomationsV1OccurrenceTransitionEvents(
      stream,
      resolveReductionDeliveries(reduction.deliveries, vectors),
      seed,
    );
    reductions.set(
      reduction.label,
      snapshotAutomationsV1OccurrenceProjection(projection),
    );
  }

  const expected = {
    cursor: 5,
    state: "succeeded",
    firstSequence: 0,
    lastSequence: 5,
  };
  assert.deepEqual(reductions.get("from-empty"), expected);
  assert.deepEqual(reductions.get("from-empty-with-duplicate"), expected);
  assert.deepEqual(reductions.get("resume-after-cursor-2"), expected);
});

test("rejects impossible transitions even when their source matches the projection", () => {
  const event = parseAutomationsV1OccurrenceTransitionEvent(
    readTestVectors().fixtures["event.occurrence.sequence"][0],
  );
  for (const [from, to] of [
    ["none", "succeeded"],
    ["planned", "succeeded"],
    ["succeeded", "running"],
    ["cancelled", "eligible"],
    ["running", "unknown"],
  ]) {
    assert.throws(
      () =>
        replayAutomationsV1OccurrenceTransitionEvents(
          event.stream,
          [{ ...event, payload: { ...event.payload, from, to } }],
          { state: from },
        ),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === STATE_TRANSITION_INVALID,
      `${from} -> ${to} must not become a projected authoritative state`,
    );
  }
});

test("accepts every occurrence edge in the pinned state machine", () => {
  const artifact = readJson<{
    machines: Array<{
      id: string;
      transitions: Array<{ from: string; to: string }>;
    }>;
  }>(path.join(contractRoot, "state-machines.json"));
  const occurrence = artifact.machines.find((machine) => machine.id === "occurrence.v1");
  assert.ok(occurrence);
  const event = parseAutomationsV1OccurrenceTransitionEvent(
    readTestVectors().fixtures["event.occurrence.sequence"][0],
  );
  for (const { from, to } of occurrence.transitions) {
    const projection = replayAutomationsV1OccurrenceTransitionEvents(
      event.stream,
      [{ ...event, payload: { ...event.payload, from, to } }],
      { state: from },
    );
    assert.equal(projection.state, to);
    assert.equal(projection.cursor, 0);
  }
});

test("fails closed on unsupported schema versions and event variants", () => {
  const vectors = readTestVectors();
  const [event] = vectors.fixtures["event.occurrence.sequence"];
  const stream = {
    kind: "occurrence" as const,
    id: "daily-notes-1756544400000",
  };

  assert.throws(
    () =>
      replayAutomationsV1OccurrenceTransitionEvents(stream, [
        {
          ...(event as Record<string, unknown>),
          schemaVersion: "coven.automations.v2",
        },
      ]),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === SCHEMA_VERSION_UNSUPPORTED,
  );

  assert.throws(
    () =>
      replayAutomationsV1OccurrenceTransitionEvents(stream, [
        {
          ...(event as Record<string, unknown>),
          kind: "occurrence.deleted",
        },
      ]),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === EVENT_KIND_UNSUPPORTED,
  );

  assert.throws(
    () =>
      replayAutomationsV1OccurrenceTransitionEvents(stream, [
        {
          ...(event as Record<string, unknown>),
          stream: {
            kind: "run",
            id: "daily-notes-1756544400000",
          },
        },
      ]),
    (error: unknown) =>
      error instanceof Error && "code" in error && error.code === STREAM_KIND_UNSUPPORTED,
  );
});
