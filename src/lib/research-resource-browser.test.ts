import assert from "node:assert/strict";
import { test } from "node:test";

import {
  remoteContentAllowed,
  researchResourceSourceUrl,
} from "./research-resource-browser.ts";
import type { ResourceManifestV1 } from "./research-resource-contracts.ts";

function manifest(overrides: Partial<ResourceManifestV1> = {}): ResourceManifestV1 {
  return {
    version: 1,
    id: "resource_a",
    revision: 1,
    kind: "saved-resource",
    canonicalIdentity: "web:resource_a",
    title: "A resource",
    sourceType: "web",
    subject: {},
    sensitivity: "public",
    ingest: { desired: true, state: "metadata_only" },
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

test("remote content consent is fail-closed", () => {
  assert.equal(remoteContentAllowed(undefined), false, "missing consent never loads");
  assert.equal(remoteContentAllowed({ allowRemoteContent: false }), false, "explicit false never loads");
  assert.equal(remoteContentAllowed({ allowRemoteContent: true }), true, "explicit true loads");
});

test("source URL prefers the explicit sourceUri", () => {
  const resource = manifest({ sourceUri: "https://example.com/article" });
  assert.equal(researchResourceSourceUrl(resource), "https://example.com/article");
});

test("source URL falls back to the legacy saved-link URL", () => {
  const resource = manifest({
    legacySavedLink: {
      id: "saved_a",
      url: "https://example.com/saved",
      addedAt: "2026-08-27T00:00:00.000Z",
      source: "desk",
    },
  });
  assert.equal(researchResourceSourceUrl(resource), "https://example.com/saved");
});

test("source URL falls back to the arXiv landing page for papers", () => {
  const resource = manifest({
    paper: { arxivId: "2401.00001", authors: [] },
  });
  assert.equal(researchResourceSourceUrl(resource), "https://arxiv.org/abs/2401.00001");
});

test("source URL is null for a local-only resource", () => {
  const resource = manifest({ kind: "local-file" });
  assert.equal(researchResourceSourceUrl(resource), null);
});

console.log("research-resource-browser.test.ts: ok");
