// Context Pack resource adapters (Unit 1, cave-6sles.10).
//
// Unit 1 ships exactly one adapter: the resource-snapshot adapter backed by
// the A5 Research Resource layer. Adapters are READ-ONLY over the resource
// CAS — they read verified snapshots and never mutate the resource store.

import { sha256Digest } from "@/lib/research-protocol/digest.ts";
import {
  contextPackResourceId,
  contextPackTrustForManifest,
  RESOURCE_KIND_TO_CONTEXT_PACK_KIND,
  type ContextPackRedactionDecisionV1,
  type ContextPackResourcePreviewV1,
  type ContextPackSelectionV1,
} from "@/lib/research-context-pack.ts";
import type { ContextPackResourceV1 } from "@/lib/research-protocol/context-pack.ts";
import type { ResourceManifestV1 } from "@/lib/research-resource-contracts.ts";
import {
  createResearchResourceStore,
  type ResearchResourceStore,
} from "@/lib/server/research-resource-store.ts";
import { containsSecretText } from "@/lib/secret-redaction.ts";

export type ContextResourceAdapter = {
  kind: string;
  preview(
    selection: ContextPackSelectionV1["resources"][number],
  ): Promise<ContextPackResourcePreviewV1>;
  snapshot(
    selection: ContextPackSelectionV1["resources"][number],
    redactions: ContextPackRedactionDecisionV1[],
    packId: string,
  ): Promise<{ resource: ContextPackResourceV1; blob: Uint8Array }>;
};

export class ContextAdapterError extends Error {
  readonly code:
    | "selection-conflict"
    | "not-ready"
    | "missing"
    | "too-large"
    | "digest-mismatch";
  constructor(code: ContextAdapterError["code"], message: string) {
    super(message);
    this.name = "ContextAdapterError";
    this.code = code;
  }
}

async function resolveManifest(
  store: ResearchResourceStore,
  resourceId: string,
): Promise<ResourceManifestV1> {
  const manifest = await store.readManifest(resourceId);
  if (!manifest) {
    throw new ContextAdapterError("missing", `resource ${resourceId} does not exist`);
  }
  return manifest;
}

async function readVerifiedSnapshot(
  store: ResearchResourceStore,
  selection: ContextPackSelectionV1["resources"][number],
  manifest: ResourceManifestV1,
) {
  if (manifest.currentSnapshotId !== selection.snapshotId) {
    throw new ContextAdapterError(
      "selection-conflict",
      `resource ${selection.resourceId} moved to snapshot ${manifest.currentSnapshotId ?? "(none)"}`,
    );
  }
  if (manifest.ingest.state !== "ready") {
    throw new ContextAdapterError("not-ready", `resource ${selection.resourceId} is not ready`);
  }
  return store.readSnapshot(selection.snapshotId);
}

function applyRedactions(
  bytes: Uint8Array,
  redactions: ContextPackRedactionDecisionV1[],
): Uint8Array {
  if (redactions.length === 0) return bytes;
  // Decisions carry spans over the ORIGINAL blob. Applying them from the END
  // backwards keeps every remaining original offset valid while earlier
  // replacements shift bytes.
  const ordered = [...redactions].sort((a, b) => b.selector.start - a.selector.start);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  for (const decision of ordered) {
    const { start, end } = decision.selector;
    if (start < 0 || end > bytes.length || start >= end) {
      throw new ContextAdapterError("selection-conflict", `redaction span ${start}..${end} is outside the blob`);
    }
    const before = decoder.decode(bytes.slice(0, start));
    const after = decoder.decode(bytes.slice(end));
    bytes = encoder.encode(`${before}${decision.replacement}${after}`);
  }
  return bytes;
}

export function createResourceSnapshotContextAdapter(options: {
  resourceRoot?: string;
  store?: ResearchResourceStore;
} = {}): ContextResourceAdapter {
  const store =
    options.store ??
    createResearchResourceStore(options.resourceRoot ? { root: options.resourceRoot } : {});

  return {
    kind: "resource-snapshot",

    async preview(selection) {
      const manifest = await resolveManifest(store, selection.resourceId);
      const verified = await readVerifiedSnapshot(store, selection, manifest);
      const text = new TextDecoder().decode(verified.normalizedBlob);
      const findings = containsSecretText(text)
        ? [{ category: "possible-secret", selector: selection.sourceSelector, excerpt: "" }]
        : [];
      return {
        resourceId: selection.resourceId,
        title: manifest.title,
        kind: RESOURCE_KIND_TO_CONTEXT_PACK_KIND[manifest.kind],
        sensitivity: manifest.sensitivity,
        mediaType: verified.snapshot.normalizedMediaType,
        bytes: verified.snapshot.normalizedBytes,
        sourceSelector: selection.sourceSelector,
        findings,
      };
    },

    async snapshot(selection, redactions, packId) {
      const manifest = await resolveManifest(store, selection.resourceId);
      const verified = await readVerifiedSnapshot(store, selection, manifest);
      const blob = applyRedactions(verified.normalizedBlob, redactions);
      const digest = sha256Digest(blob);
      const resource: ContextPackResourceV1 = {
        id: contextPackResourceId(packId, selection.resourceId, selection.sourceSelector),
        kind: RESOURCE_KIND_TO_CONTEXT_PACK_KIND[manifest.kind],
        uri: manifest.sourceUri ?? manifest.canonicalIdentity,
        digest,
        localBlobDigest: digest,
        selector: { type: "whole-resource" },
        trust: contextPackTrustForManifest(manifest),
        sensitivity: manifest.sensitivity,
        capturedAt: verified.snapshot.createdAt,
        title: manifest.title,
        mediaType: verified.snapshot.normalizedMediaType,
      };
      return { resource, blob };
    },
  };
}
