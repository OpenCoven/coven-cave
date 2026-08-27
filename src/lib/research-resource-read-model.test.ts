import assert from "node:assert/strict";
import { test } from "node:test";

import type { ResourceManifestV1 } from "./research-resource-contracts.ts";
import {
  resourceManifestToSavedLinkSummary,
  resourceManifestsToSavedLinkSummaries,
} from "./research-resource-read-model.ts";

const ADDED_AT = "2026-08-25T12:00:00.000Z";
const PUBLISHED_AT = "2026-08-20T09:30:00.000Z";

function manifest(
  id: string,
  patch: Partial<ResourceManifestV1> = {},
): ResourceManifestV1 {
  return {
    version: 1,
    id,
    revision: 1,
    kind: "saved-resource",
    canonicalIdentity: `https://example.com/${id}`,
    title: `Resource ${id}`,
    sourceUri: `https://example.com/${id}`,
    sourceType: "web",
    category: "article",
    legacySavedLink: {
      id: `legacy-${id}`,
      url: `https://example.com/${id}`,
      addedAt: ADDED_AT,
      source: "desk",
    },
    subject: {},
    sensitivity: "private",
    ingest: { desired: false, state: "metadata_only" },
    createdAt: "2026-08-25T12:00:00.000Z",
    updatedAt: "2026-08-25T12:00:00.000Z",
    ...patch,
  };
}

test("projects only approved legacy, category, title, date, source, and paper fields", () => {
  const input = manifest("paper-1", {
    title: "Catalog title wins",
    category: "paper",
    publishedAt: PUBLISHED_AT,
    legacySavedLink: {
      id: "legacy-paper-1",
      url: "https://huggingface.co/papers/2608.12345",
      addedAt: ADDED_AT,
      source: "chat",
      ignoredLegacyExtension: "must not escape",
    },
    paper: {
      arxivId: "2608.12345",
      authors: ["Ada", "Grace"],
      abstract: "A useful abstract.",
      ignoredPaperExtension: "must not escape",
    },
    currentSnapshotId: "snapshot-private",
    ignoredManifestExtension: "must not escape",
  });

  assert.deepEqual(resourceManifestToSavedLinkSummary(input), {
    id: "legacy-paper-1",
    url: "https://huggingface.co/papers/2608.12345",
    category: "paper",
    title: "Catalog title wins",
    addedAt: ADDED_AT,
    source: "chat",
    paper: {
      arxivId: "2608.12345",
      authors: ["Ada", "Grace"],
      abstract: "A useful abstract.",
      publishedAt: PUBLISHED_AT,
    },
  });
});

test("uses the paper date when present and omits an incomplete paper block", () => {
  const paperDate = "2026-08-21T09:30:00.000Z";
  const complete = resourceManifestToSavedLinkSummary(manifest("complete", {
    publishedAt: PUBLISHED_AT,
    paper: {
      arxivId: "2608.22222",
      authors: ["Author"],
      abstract: "Abstract",
      publishedAt: paperDate,
    },
  }));
  assert.equal(complete?.paper?.publishedAt, paperDate);

  const incomplete = resourceManifestToSavedLinkSummary(manifest("incomplete", {
    paper: {
      arxivId: "2608.33333",
      authors: ["Author"],
      publishedAt: paperDate,
    },
  }));
  assert.ok(incomplete);
  assert.equal(incomplete.paper, undefined);
});

test("excludes non-legacy manifests and categorizes legacy URLs when category is absent", () => {
  assert.equal(
    resourceManifestToSavedLinkSummary(manifest("native", { legacySavedLink: undefined })),
    null,
  );
  assert.equal(
    resourceManifestToSavedLinkSummary(manifest("uncategorized", {
      category: undefined,
      legacySavedLink: {
        id: "legacy-uncategorized",
        url: "https://github.com/OpenCoven/coven-cave",
        addedAt: ADDED_AT,
        source: "desk",
      },
    }))?.category,
    "github",
  );
});

test("sorts deterministically without mutating inputs and returns detached paper authors", () => {
  const older = manifest("older", {
    legacySavedLink: {
      id: "legacy-z",
      url: "https://example.com/older",
      addedAt: "2026-08-20T00:00:00.000Z",
      source: "desk",
    },
  });
  const tiedB = manifest("tied-b", {
    legacySavedLink: {
      id: "legacy-b",
      url: "https://example.com/tied-b",
      addedAt: ADDED_AT,
      source: "desk",
    },
  });
  const tiedA = manifest("tied-a", {
    legacySavedLink: {
      id: "legacy-a",
      url: "https://example.com/tied-a",
      addedAt: ADDED_AT,
      source: "desk",
    },
    publishedAt: PUBLISHED_AT,
    paper: {
      arxivId: "2608.44444",
      authors: ["Original Author"],
      abstract: "Abstract",
    },
  });
  const inputs = [older, tiedB, tiedA];

  const summaries = resourceManifestsToSavedLinkSummaries(inputs);
  assert.deepEqual(summaries.map((summary) => summary.id), ["legacy-a", "legacy-b", "legacy-z"]);
  assert.deepEqual(inputs.map((entry) => entry.id), ["older", "tied-b", "tied-a"]);

  summaries[0]!.paper!.authors[0] = "Changed output";
  assert.deepEqual(tiedA.paper?.authors, ["Original Author"]);
  assert.equal("xArticle" in summaries[0]!, false);
});
