import assert from "node:assert/strict";
import test from "node:test";

import {
  RESOURCE_KIND_TO_CONTEXT_PACK_KIND,
  contextPackResourceId,
  contextPackTrustForManifest,
  parseContextPackBuildReceiptV1,
  parseContextPackPreviewV1,
  parseContextPackRedactionMapV1,
  parseContextPackSelectionV1,
} from "./research-context-pack.ts";
import type { ResourceManifestV1 } from "./research-resource-contracts.ts";

function manifest(overrides: Partial<ResourceManifestV1>): ResourceManifestV1 {
  return {
    version: 1,
    id: "saved-link-abc",
    revision: 3,
    kind: "saved-resource",
    canonicalIdentity: "https://example.com/a",
    title: "Example",
    sourceType: "saved-link",
    sensitivity: "public",
    ingest: { desired: true, state: "ready" },
    currentSnapshotId: "snap-1",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

const WHOLE_SELECTOR = { type: "whole-resource" } as const;

test("selection parses a valid explicit selection", () => {
  const parsed = parseContextPackSelectionV1({
    version: 1,
    purpose: "research-run",
    familiarId: "charm",
    consent: {
      selectionMode: "explicit",
      allowRemoteQueries: false,
      allowRemoteContent: false,
      artifactContentSync: false,
      retention: "run-only",
    },
    resources: [
      { resourceId: "saved-link-abc", snapshotId: "snap-1", sourceSelector: WHOLE_SELECTOR },
    ],
  });
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.equal(parsed.value.resources[0]?.resourceId, "saved-link-abc");
  assert.equal(parsed.value.consent.retention, "run-only");
});

test("selection refuses Unit 1 pin violations", () => {
  const remote = parseContextPackSelectionV1({
    version: 1,
    purpose: "topic-discovery",
    familiarId: "charm",
    consent: {
      selectionMode: "explicit",
      allowRemoteQueries: true,
      allowRemoteContent: false,
      artifactContentSync: false,
      retention: "project",
    },
    resources: [],
  });
  assert.ok(!remote.ok);
  assert.equal(remote.error.code, "invalid_value");

  const auto = parseContextPackSelectionV1({
    version: 1,
    purpose: "topic-discovery",
    familiarId: "charm",
    consent: {
      selectionMode: "implicit",
      allowRemoteQueries: false,
      allowRemoteContent: false,
      artifactContentSync: false,
      retention: "project",
    },
    resources: [],
  });
  assert.ok(!auto.ok);
});

test("redaction map parses text-span decisions with bounds", () => {
  const parsed = parseContextPackRedactionMapV1({
    version: 1,
    secretScanVersion: "scan-1",
    decisions: [
      {
        resourceId: "saved-link-abc",
        selector: { type: "text-span", start: 0, end: 12 },
        category: "api-key",
        replacement: "[redacted]",
      },
    ],
  });
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.equal(parsed.value.decisions[0]?.replacement, "[redacted]");

  const inverted = parseContextPackRedactionMapV1({
    version: 1,
    secretScanVersion: "scan-1",
    decisions: [
      {
        resourceId: "saved-link-abc",
        selector: { type: "text-span", start: 12, end: 4 },
        category: "api-key",
        replacement: "",
      },
    ],
  });
  assert.ok(!inverted.ok);
});

test("receipt parses portable ids and digests", () => {
  const parsed = parseContextPackBuildReceiptV1({
    version: 1,
    packId: "ctx_pack1",
    createdAt: "2026-08-28T10:00:00.000Z",
    resources: [
      {
        packResourceId: "resource_0123456789abcdef0123456789abcdef01234567",
        sourceResourceId: "saved-link-abc",
        snapshotId: "snap-1",
        sourceSelector: WHOLE_SELECTOR,
        sourceRevision: 3,
        sourceNormalizedBlobDigest: "a".repeat(64),
      },
    ],
  });
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.equal(parsed.value.resources[0]?.sourceRevision, 3);
});

test("receipt refuses a non-portable pack id", () => {
  const parsed = parseContextPackBuildReceiptV1({
    version: 1,
    packId: "not-a-pack",
    createdAt: "2026-08-28T10:00:00.000Z",
    resources: [],
  });
  assert.ok(!parsed.ok);
});

test("preview parses findings and computes nothing else", () => {
  const parsed = parseContextPackPreviewV1({
    version: 1,
    resources: [
      {
        resourceId: "saved-link-abc",
        kind: "saved-resource",
        sensitivity: "private",
        mediaType: "text/markdown",
        bytes: 120,
        sourceSelector: WHOLE_SELECTOR,
        findings: [{ category: "email", selector: WHOLE_SELECTOR, excerpt: "a@b.co" }],
      },
    ],
    totalBytes: 120,
    requiresConfirmation: true,
  });
  assert.ok(parsed.ok, JSON.stringify(parsed));
  assert.equal(parsed.value.requiresConfirmation, true);
  assert.equal(parsed.value.resources[0]?.findings[0]?.category, "email");
});

test("kind mapping covers every resource kind", () => {
  assert.equal(RESOURCE_KIND_TO_CONTEXT_PACK_KIND.paper, "saved-resource");
  assert.equal(RESOURCE_KIND_TO_CONTEXT_PACK_KIND["local-file"], "attachment");
  assert.equal(RESOURCE_KIND_TO_CONTEXT_PACK_KIND["mission-artifact"], "artifact");
});

test("trust derivation follows the Unit 1 default table", () => {
  assert.equal(
    contextPackTrustForManifest(manifest({ legacySavedLink: { id: "l", url: "https://e.co", addedAt: "2026-08-20T00:00:00.000Z", source: "desk" } })),
    "imported-source",
  );
  assert.equal(
    contextPackTrustForManifest(manifest({ kind: "attachment", sourceType: "attachment" })),
    "user-authored",
  );
  assert.equal(
    contextPackTrustForManifest(manifest({ kind: "session", sourceType: "session" })),
    "model-derived",
  );
});

test("portable resource ids are stable and pack-scoped", () => {
  const first = contextPackResourceId("ctx_pack1", "saved-link-abc", WHOLE_SELECTOR);
  const same = contextPackResourceId("ctx_pack1", "saved-link-abc", WHOLE_SELECTOR);
  const other = contextPackResourceId("ctx_pack1", "saved-link-abc", { type: "text-span", start: 0, end: 5 });
  assert.equal(first, same);
  assert.notEqual(first, other);
  assert.match(first, /^resource_[0-9a-f]{40}$/);
});

console.log("research context pack contracts: ok");
