import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  TOPIC_DISCOVERY_BUDGET,
  localMissionIdFromPortable,
  parseTopicDiscoveryJobCreateInputV1,
  parseTopicDiscoveryJobStateV1,
  parseTopicProposalDraftV1,
  portableMissionId,
  proposalDedupeKey,
  resolveEvidence,
} from "./research-topic-discovery.ts";

// ── Job create input parser ─────────────────────────────────────────────────

test("create-input parser accepts a valid job request", () => {
  const parsed = parseTopicDiscoveryJobCreateInputV1({
    version: 1,
    contextPackId: "ctx_abc123",
    familiarId: "charm",
  });
  assert.ok(parsed.ok);
  assert.equal(parsed.value.contextPackId, "ctx_abc123");
  assert.equal(parsed.value.familiarId, "charm");
});

test("create-input parser rejects an unknown version", () => {
  const parsed = parseTopicDiscoveryJobCreateInputV1({ version: 2, contextPackId: "ctx_abc", familiarId: "charm" });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.error.code, "unknown_major");
});

test("create-input parser rejects a malformed contextPackId", () => {
  for (const contextPackId of ["", "ctx", "ctx_", "abc", "../ctx_abc", "ctx_../..", "ctx_a b"]) {
    const parsed = parseTopicDiscoveryJobCreateInputV1({ version: 1, contextPackId, familiarId: "charm" });
    assert.equal(parsed.ok, false, `expected rejection for ${JSON.stringify(contextPackId)}`);
  }
});

test("create-input parser rejects an empty or overlong familiarId", () => {
  assert.equal(parseTopicDiscoveryJobCreateInputV1({ version: 1, contextPackId: "ctx_abc", familiarId: "" }).ok, false);
  assert.equal(
    parseTopicDiscoveryJobCreateInputV1({ version: 1, contextPackId: "ctx_abc", familiarId: "x".repeat(65) }).ok,
    false,
  );
});

// ── State sidecar parser ────────────────────────────────────────────────────

test("state parser accepts a valid lease sidecar", () => {
  const parsed = parseTopicDiscoveryJobStateV1({
    version: 1,
    owner: "123@host",
    attempt: 2,
    leaseExpiresAt: "2026-08-28T10:00:00.000Z",
  });
  assert.ok(parsed.ok);
  assert.equal(parsed.value.attempt, 2);
});

test("state parser rejects a bad leaseExpiresAt timestamp", () => {
  const parsed = parseTopicDiscoveryJobStateV1({
    version: 1,
    owner: "123@host",
    attempt: 1,
    leaseExpiresAt: "not-a-timestamp",
  });
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.error.code, "invalid_value");
});

test("state parser rejects a non-positive attempt", () => {
  for (const attempt of [0, -1, 1.5]) {
    const parsed = parseTopicDiscoveryJobStateV1({
      version: 1,
      owner: "123@host",
      attempt,
      leaseExpiresAt: "2026-08-28T10:00:00.000Z",
    });
    assert.equal(parsed.ok, false, `expected rejection for attempt ${attempt}`);
  }
});

// ── Accept draft parser ─────────────────────────────────────────────────────

function validDraft(): Record<string, unknown> {
  return {
    version: 1,
    proposalId: "proposal_abc123",
    contextPackId: "ctx_abc123",
    contextPackDigest: "a".repeat(64),
    title: "A topic",
    question: "Is this a question?",
    mode: "sweep",
    deliverable: "A report",
    sourceTarget: 8,
    wallClockMinutes: 45,
    relatedMissionIds: ["mission-1", "mission-2"],
  };
}

test("draft parser accepts a valid draft", () => {
  const parsed = parseTopicProposalDraftV1(validDraft());
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.value.relatedMissionIds, ["mission-1", "mission-2"]);
});

test("draft parser rejects an out-of-range sourceTarget", () => {
  for (const sourceTarget of [0, -1, 1.5]) {
    const parsed = parseTopicProposalDraftV1({ ...validDraft(), sourceTarget });
    assert.equal(parsed.ok, false, `expected rejection for sourceTarget ${sourceTarget}`);
  }
});

test("draft parser rejects a non-local relatedMissionIds entry", () => {
  const parsed = parseTopicProposalDraftV1({ ...validDraft(), relatedMissionIds: ["mission_foo"] });
  assert.equal(parsed.ok, false);
});

test("draft parser rejects an invalid mode", () => {
  const parsed = parseTopicProposalDraftV1({ ...validDraft(), mode: "warp" });
  assert.equal(parsed.ok, false);
});

// ── Mission id mapping ──────────────────────────────────────────────────────

test("portableMissionId round-trips through localMissionIdFromPortable", () => {
  const portable = portableMissionId("mission-1");
  assert.equal(portable, "mission_mission-1");
  assert.equal(localMissionIdFromPortable(portable), "mission-1");
});

test("portableMissionId rejects a mission_-prefixed input that would double-prefix", () => {
  assert.throws(() => portableMissionId("mission_foo"), TypeError);
});

test("localMissionIdFromPortable returns null for non-portable or unresolvable ids", () => {
  assert.equal(localMissionIdFromPortable("mission-1"), null);
  assert.equal(localMissionIdFromPortable("ctx_foo"), null);
  assert.equal(localMissionIdFromPortable("mission_has space"), null);
  assert.equal(localMissionIdFromPortable("mission_"), null);
});

// ── Evidence resolution ─────────────────────────────────────────────────────

function blob(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const RESOURCE = {
  id: "resource_abc",
  kind: "saved-resource",
  uri: "https://example.com/a",
  digest: sha256("hello world"),
  localBlobDigest: sha256("hello world"),
  selector: { type: "whole-resource" },
  trust: "imported-source",
  sensitivity: "public",
  capturedAt: "2026-08-28T10:00:00.000Z",
  mediaType: "text/plain",
} as const;

const TEXT = "hello world";
const resourcesById = new Map([[RESOURCE.id, RESOURCE]]);
const blobsById = new Map([[RESOURCE.id, blob(TEXT)]]);

test("resolveEvidence resolves a text-span with matching excerpt and digest", () => {
  const result = resolveEvidence(
    RESOURCE.id,
    { type: "text-span", start: 0, end: 5 },
    "hello",
    sha256("hello"),
    resourcesById,
    blobsById,
  );
  assert.ok(result.ok);
});

test("resolveEvidence resolves a whole-resource excerpt", () => {
  const result = resolveEvidence(
    RESOURCE.id,
    { type: "whole-resource" },
    TEXT,
    sha256(TEXT),
    resourcesById,
    blobsById,
  );
  assert.ok(result.ok);
});

test("resolveEvidence rejects an unknown resource", () => {
  const result = resolveEvidence(
    "resource_missing",
    { type: "whole-resource" },
    TEXT,
    sha256(TEXT),
    resourcesById,
    blobsById,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "unknown-resource");
});

test("resolveEvidence rejects every unsupported selector kind", () => {
  const unsupported: Array<Parameters<typeof resolveEvidence>[1]> = [
    { type: "json-pointer", pointer: "/a" },
    { type: "turn-range", start: 0, end: 1 },
    { type: "markdown-section", headingPath: ["a"] },
    { type: "pdf-page-span", page: 1, start: 0, end: 1 },
  ];
  for (const selector of unsupported) {
    const result = resolveEvidence(
      RESOURCE.id,
      selector,
      TEXT,
      sha256(TEXT),
      resourcesById,
      blobsById,
    );
    assert.equal(result.ok, false, `expected rejection for ${selector.type}`);
    if (!result.ok) assert.equal(result.code, "unsupported-selector");
  }
});

test("resolveEvidence rejects out-of-bounds text-spans", () => {
  const bounds = [
    { type: "text-span", start: -1, end: 1 },
    { type: "text-span", start: 5, end: 5 },
    { type: "text-span", start: 6, end: 5 },
    { type: "text-span", start: 0, end: 100 },
  ] as const;
  for (const selector of bounds) {
    const result = resolveEvidence(
      RESOURCE.id,
      selector,
      TEXT,
      sha256(TEXT),
      resourcesById,
      blobsById,
    );
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(selector)}`);
    if (!result.ok) assert.equal(result.code, "range-out-of-bounds");
  }
});

test("resolveEvidence rejects an excerpt mismatched by one byte", () => {
  // "hellp" vs "hello": same span, wrong decoded bytes.
  const result = resolveEvidence(
    RESOURCE.id,
    { type: "text-span", start: 0, end: 5 },
    "hellp",
    sha256("hellp"),
    resourcesById,
    blobsById,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "excerpt-mismatch");
});

test("resolveEvidence rejects a digest mismatch for correct bytes", () => {
  const result = resolveEvidence(
    RESOURCE.id,
    { type: "text-span", start: 0, end: 5 },
    "hello",
    "b".repeat(64),
    resourcesById,
    blobsById,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "digest-mismatch");
});

test("resolveEvidence rejects a whole-resource excerpt over the character cap", () => {
  const long = "x".repeat(TOPIC_DISCOVERY_BUDGET.maxExcerptChars + 1);
  const longResource = { ...RESOURCE, id: "resource_long" };
  const longResources = new Map([[longResource.id, longResource]]);
  const longBlobs = new Map([[longResource.id, blob(long)]]);
  const result = resolveEvidence(
    longResource.id,
    { type: "whole-resource" },
    long,
    sha256(long),
    longResources,
    longBlobs,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "range-out-of-bounds");
});

// ── Dedupe key ──────────────────────────────────────────────────────────────

test("proposalDedupeKey is deterministic and normalizes whitespace/case", () => {
  const a = proposalDedupeKey("A Title", "A question?");
  const b = proposalDedupeKey("  a   title ", "a question?");
  const c = proposalDedupeKey("A TITLE", "A QUESTION?");
  assert.equal(a, b);
  assert.equal(a, c);
  assert.notEqual(a, proposalDedupeKey("Another", "A question?"));
});

console.log("research topic discovery contracts: ok");
