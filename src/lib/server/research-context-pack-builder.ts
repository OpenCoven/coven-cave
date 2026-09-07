// Context Pack builder (Unit 1, cave-6sles.10).
//
// The only server-side writer that composes adapters + pack store. `seal`
// runs the §4.3 algorithm (blob-first, manifest-last): generate a fresh
// ctx_ id, snapshot every selected resource through the adapter, refuse to
// seal sensitive content without explicit confirmation, assemble the
// portable ContextPackV1 with a computed digest, self-check with
// parseContextPackV1, and publish atomically through the hardened store.

import { randomBytes } from "node:crypto";

import { parseContextPackV1, type ContextPackV1 } from "@/lib/research-protocol/context-pack.ts";
import { digestProtocolObject, sha256Digest } from "@/lib/research-protocol/digest.ts";
import {
  parseContextPackBuildReceiptV1,
  parseContextPackPreviewV1,
  parseContextPackRedactionMapV1,
  parseContextPackSelectionV1,
  type ContextPackBuildReceiptV1,
  type ContextPackPreviewV1,
  type ContextPackRedactionMapV1,
  type ContextPackSelectionV1,
} from "@/lib/research-context-pack.ts";
import {
  ContextAdapterError,
  createResourceSnapshotContextAdapter,
  type ContextResourceAdapter,
} from "@/lib/server/research-context-resource-adapters.ts";
import {
  ContextPackStoreError,
  createContextPackStore,
  type ContextPackStore,
} from "@/lib/server/research-context-pack-store.ts";

export class ContextPackBuilderError extends Error {
  readonly code:
    | "invalid-selection"
    | "invalid-redactions"
    | "selection-conflict"
    | "confirmation-required"
    | "invalid-pack"
    | "publish-failed";
  constructor(code: ContextPackBuilderError["code"], message: string) {
    super(message);
    this.name = "ContextPackBuilderError";
    this.code = code;
  }
}

export type ContextPackBuilder = {
  preview(selection: unknown): Promise<ContextPackPreviewV1>;
  seal(selection: unknown, redactions: unknown): Promise<ContextPackV1>;
};

const SECRET_SCAN_VERSION = "v0-none";

export function createContextPackBuilder(options: {
  packRoot?: string;
  resourceRoot?: string;
  now?: () => string;
} = {}): ContextPackBuilder {
  const store: ContextPackStore = createContextPackStore(
    options.packRoot ? { root: options.packRoot } : {},
  );
  const adapter: ContextResourceAdapter = createResourceSnapshotContextAdapter(
    options.resourceRoot ? { resourceRoot: options.resourceRoot } : {},
  );
  const now = options.now ?? (() => new Date().toISOString());

  async function parsedSelection(selection: unknown): Promise<ContextPackSelectionV1> {
    const parsed = parseContextPackSelectionV1(selection);
    if (!parsed.ok) {
      throw new ContextPackBuilderError("invalid-selection", `${parsed.error.code} at ${parsed.error.path}`);
    }
    return parsed.value;
  }

  async function parsedRedactions(redactions: unknown): Promise<ContextPackRedactionMapV1 | undefined> {
    if (redactions === undefined || redactions === null) return undefined;
    const parsed = parseContextPackRedactionMapV1(redactions);
    if (!parsed.ok) {
      throw new ContextPackBuilderError("invalid-redactions", `${parsed.error.code} at ${parsed.error.path}`);
    }
    return parsed.value;
  }

  async function snapshotAll(
    selection: ContextPackSelectionV1,
    redactionMap: ContextPackRedactionMapV1 | undefined,
    packId: string,
  ) {
    const entries: Array<{ resource: Awaited<ReturnType<ContextResourceAdapter["snapshot"]>>["resource"]; blob: Uint8Array; sourceResourceId: string; snapshotId: string; sourceSelector: ContextPackSelectionV1["resources"][number]["sourceSelector"]; sourceRevision: number; sourceNormalizedBlobDigest: string }> = [];
    for (const item of selection.resources) {
      const redactions =
        redactionMap?.decisions.filter((decision) => decision.resourceId === item.resourceId) ?? [];
      let result;
      try {
        result = await adapter.snapshot(item, redactions, packId);
      } catch (error) {
        if (error instanceof ContextAdapterError) {
          throw new ContextPackBuilderError("selection-conflict", error.message);
        }
        throw error;
      }
      entries.push({
        resource: result.resource,
        blob: result.blob,
        sourceResourceId: item.resourceId,
        snapshotId: item.snapshotId,
        sourceSelector: item.sourceSelector,
        sourceRevision: -1, // filled from the receipt below; the adapter has no manifest access here
        sourceNormalizedBlobDigest: result.resource.digest,
      });
    }
    return entries;
  }

  return {
    async preview(selection) {
      const parsed = await parsedSelection(selection);
      const resources = [];
      let totalBytes = 0;
      let requiresConfirmation = false;
      for (const item of parsed.resources) {
        const entry = await adapter.preview(item);
        resources.push(entry);
        totalBytes += entry.bytes;
        if (entry.sensitivity === "private" || entry.sensitivity === "restricted") {
          requiresConfirmation = true;
        }
      }
      const preview: ContextPackPreviewV1 = {
        version: 1,
        resources,
        totalBytes,
        requiresConfirmation,
      };
      const checked = parseContextPackPreviewV1(preview);
      if (!checked.ok) {
        throw new ContextPackBuilderError("invalid-pack", `preview failed validation: ${checked.error.code}`);
      }
      return preview;
    },

    async seal(selection, redactions) {
      const parsed = await parsedSelection(selection);
      const redactionMap = await parsedRedactions(redactions);
      const packId = `ctx_${randomBytes(16).toString("hex")}`;
      const createdAt = now();

      const entries = await snapshotAll(parsed, redactionMap, packId);

      // Confirmation gate: sensitive content requires explicit per-resource
      // confirmation on the selection.
      const rawConfirmed = (selection as { confirmedSensitiveResourceIds?: unknown })
        ?.confirmedSensitiveResourceIds;
      const confirmed = new Set(
        Array.isArray(rawConfirmed)
          ? rawConfirmed.filter((id): id is string => typeof id === "string")
          : [],
      );
      for (const item of parsed.resources) {
        const sensitivity = entries.find((entry) => entry.sourceResourceId === item.resourceId)
          ?.resource.sensitivity;
        if (sensitivity === "private" || sensitivity === "restricted") {
          if (!confirmed.has(item.resourceId)) {
            throw new ContextPackBuilderError(
              "confirmation-required",
              `sealing ${item.resourceId} requires explicit confirmation`,
            );
          }
        }
      }

      const blobs = new Map<string, Uint8Array>();
      for (const entry of entries) {
        blobs.set(entry.resource.digest, entry.blob);
      }

      const pack: ContextPackV1 = {
        schema: "opencoven.context-pack/v1",
        id: packId,
        digest: "",
        createdAt,
        createdBy: { client: "coven-cave" },
        purpose: parsed.purpose,
        subject: {
          familiarId: parsed.familiarId,
          ...(parsed.projectId ? { projectId: parsed.projectId } : {}),
        },
        consent: {
          selectionMode: "explicit",
          allowRemoteQueries: false,
          allowRemoteContent: false,
          artifactContentSync: false,
          retention: parsed.consent.retention,
        },
        resources: entries.map((entry) => entry.resource),
        policy: {
          treatResourceTextAsData: true,
          toolAuthority: "none",
          allowedPurposes: [parsed.purpose],
        },
        transforms: { secretScanVersion: SECRET_SCAN_VERSION },
      };
      const digest = digestProtocolObject(pack);
      const digested: ContextPackV1 = { ...pack, digest };
      const checked = parseContextPackV1(digested);
      if (!checked.ok) {
        throw new ContextPackBuilderError("invalid-pack", `pack failed validation: ${checked.error.code}`);
      }

      const receipt: ContextPackBuildReceiptV1 = {
        version: 1,
        packId,
        createdAt,
        resources: entries.map((entry) => ({
          packResourceId: entry.resource.id,
          sourceResourceId: entry.sourceResourceId,
          snapshotId: entry.snapshotId,
          sourceSelector: entry.sourceSelector,
          sourceRevision: 1,
          sourceNormalizedBlobDigest: entry.sourceNormalizedBlobDigest,
        })),
      };
      const receiptChecked = parseContextPackBuildReceiptV1(receipt);
      if (!receiptChecked.ok) {
        throw new ContextPackBuilderError("invalid-pack", `receipt failed validation: ${receiptChecked.error.code}`);
      }

      let redactionBytes: Uint8Array | undefined;
      if (redactionMap) {
        const mapBytes = new TextEncoder().encode(`${JSON.stringify(redactionMap)}\n`);
        const mapDigest = sha256Digest(mapBytes);
        redactionBytes = mapBytes;
        digested.transforms.redactionMapDigest = mapDigest;
        const redigested = parseContextPackV1(digested);
        if (!redigested.ok) {
          throw new ContextPackBuilderError("invalid-pack", `pack with redaction map failed validation: ${redigested.error.code}`);
        }
      }

      try {
        await store.publishPack({
          pack: digested,
          blobs,
          receipt: receiptChecked.value,
          ...(redactionBytes ? { redactionMap: redactionBytes } : {}),
        });
      } catch (error) {
        if (error instanceof ContextPackStoreError) {
          throw new ContextPackBuilderError("publish-failed", `${error.code}: ${error.message}`);
        }
        throw error;
      }

      return digested;
    },
  };
}
