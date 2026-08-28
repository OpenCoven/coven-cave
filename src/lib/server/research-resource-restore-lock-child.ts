import { createResearchResourceStore } from "./research-resource-store.ts";
import type { ResourceManifestV1 } from "../research-resource-contracts.ts";

const root = process.argv[2];
if (!root) throw new Error("Research root is required");

const manifest: ResourceManifestV1 = {
  version: 1,
  id: "post-restore-child",
  revision: 1,
  kind: "saved-resource",
  canonicalIdentity: "https://example.com/post-restore-child",
  title: "Post-restore child",
  sourceUri: "https://example.com/post-restore-child",
  sourceType: "saved-link",
  category: "article",
  subject: {},
  sensitivity: "public",
  ingest: { desired: false, state: "metadata_only" },
  createdAt: "2026-08-27T23:59:00.000Z",
  updatedAt: "2026-08-27T23:59:00.000Z",
};

process.stdout.write("STARTED\n");
await createResearchResourceStore({ root }).createManifest(manifest);
process.stdout.write("DONE\n");
