import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { ResourceManifestV1, ResourceSnapshotV1 } from "../research-resource-contracts.ts";
import {
  createResearchResourceCatalog,
  ResearchResourceCatalogError,
} from "./research-resource-catalog.ts";
import { createResearchResourceStore } from "./research-resource-store.ts";
import { canonicalJson } from "../research-protocol/digest.ts";

function manifest(id: string, patch: Partial<ResourceManifestV1> = {}): ResourceManifestV1 {
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
      addedAt: "2026-08-27T12:00:00Z",
      source: "desk",
    },
    subject: {},
    sensitivity: "private",
    ingest: { desired: false, state: "metadata_only" },
    createdAt: "2026-08-27T12:00:00Z",
    updatedAt: "2026-08-27T12:00:00Z",
    ...patch,
  };
}

async function fixture(operation: (root: string) => Promise<void>): Promise<void> {
  const parent = await mkdtemp(path.join(tmpdir(), "cave-resource-catalog-test-"));
  const root = path.join(parent, "store");
  try {
    await operation(root);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

function hasCode(code: ResearchResourceCatalogError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof ResearchResourceCatalogError && error.code === code;
}

test("creates, reads, lists, and idempotently replays private canonical manifests", async () => {
  await fixture(async (root) => {
    const catalog = createResearchResourceCatalog({ root });
    const first = manifest("resource_a");
    const later = manifest("resource_b", {
      canonicalIdentity: "https://example.com/resource_b",
      legacySavedLink: {
        id: "legacy-resource_b",
        url: "https://example.com/resource_b",
        addedAt: "2026-08-27T13:00:00Z",
        source: "chat",
      },
      createdAt: "2026-08-27T13:00:00Z",
      updatedAt: "2026-08-27T13:00:00Z",
    });

    assert.equal((await catalog.createManifest(first)).created, true);
    assert.equal((await catalog.createManifest(first)).created, false);
    await catalog.createManifest(later);
    assert.deepEqual((await catalog.listManifests()).map((item) => item.id), ["resource_b", "resource_a"]);
    assert.deepEqual(await catalog.getManifest(first.id), first);
    assert.equal(await catalog.getManifest("missing_resource"), null);

    if (process.platform !== "win32") {
      assert.equal((await lstat(path.join(root, "manifests"))).mode & 0o777, 0o700);
      assert.equal((await lstat(path.join(root, "manifests", `${first.id}.json`))).mode & 0o777, 0o600);
    }
  });
});

test("enforces catalog identity uniqueness and optimistic immutable revisions", async () => {
  await fixture(async (root) => {
    const catalog = createResearchResourceCatalog({ root });
    const original = manifest("resource_revision");
    await catalog.createManifest(original);

    await assert.rejects(
      () => catalog.createManifest(manifest("other", {
        canonicalIdentity: original.canonicalIdentity,
      })),
      hasCode("identity-conflict"),
    );
    await assert.rejects(
      () => catalog.createManifest(manifest("legacy_collision", {
        legacySavedLink: original.legacySavedLink,
      })),
      hasCode("identity-conflict"),
    );

    const next = {
      ...original,
      revision: 2,
      title: "Updated title",
      updatedAt: "2026-08-27T12:01:00Z",
    };
    assert.deepEqual(
      await catalog.updateManifest({ id: original.id, expectedRevision: 1, manifest: next }),
      next,
    );
    await assert.rejects(
      () => catalog.updateManifest({
        id: original.id,
        expectedRevision: 1,
        manifest: { ...next, title: "Stale" },
      }),
      hasCode("revision-conflict"),
    );
    await assert.rejects(
      () => catalog.updateManifest({
        id: original.id,
        expectedRevision: 2,
        manifest: {
          ...next,
          revision: 3,
          canonicalIdentity: "https://example.com/changed",
          updatedAt: "2026-08-27T12:02:00Z",
        },
      }),
      hasCode("immutable-conflict"),
    );
  });
});

test("serializes competing revisions so exactly one writer wins", async () => {
  await fixture(async (root) => {
    const catalog = createResearchResourceCatalog({ root });
    const original = manifest("resource_race");
    await catalog.createManifest(original);
    const candidates = ["First", "Second"].map((title) => catalog.updateManifest({
      id: original.id,
      expectedRevision: 1,
      manifest: {
        ...original,
        revision: 2,
        title,
        updatedAt: "2026-08-27T12:01:00Z",
      },
    }));
    const results = await Promise.allSettled(candidates);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(
      (result) => result.status === "rejected" && hasCode("revision-conflict")(result.reason),
    ).length, 1);
    assert.equal((await catalog.getManifest(original.id))?.revision, 2);
  });
});

test("serializes competing creates so one canonical identity has one owner", async () => {
  await fixture(async (root) => {
    const catalog = createResearchResourceCatalog({ root });
    const candidates = ["identity_race_a", "identity_race_b"].map((id) =>
      catalog.createManifest(manifest(id, {
        canonicalIdentity: "https://example.com/one-canonical-resource",
      })),
    );
    const results = await Promise.allSettled(candidates);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter(
      (result) => result.status === "rejected" && hasCode("identity-conflict")(result.reason),
    ).length, 1);
    assert.equal((await catalog.listManifests()).length, 1);
  });
});

test("fails complete scans closed when on-disk canonical or legacy identities collide", async () => {
  await fixture(async (root) => {
    const catalog = createResearchResourceCatalog({ root });
    const original = manifest("resource_owner");
    await catalog.createManifest(original);
    const injectedPath = path.join(root, "manifests", "resource_injected.json");
    const canonicalCollision = manifest("resource_injected", {
      canonicalIdentity: original.canonicalIdentity,
    });
    await writeFile(injectedPath, `${canonicalJson(canonicalCollision)}\n`, { mode: 0o600 });
    await assert.rejects(() => catalog.listManifests(), hasCode("identity-conflict"));

    await rm(injectedPath);
    const legacyCollision = manifest("resource_injected", {
      legacySavedLink: original.legacySavedLink,
    });
    await writeFile(injectedPath, `${canonicalJson(legacyCollision)}\n`, { mode: 0o600 });
    await assert.rejects(() => catalog.listManifests(), hasCode("identity-conflict"));
    await assert.rejects(
      () => catalog.createManifest(manifest("unrelated_resource")),
      hasCode("identity-conflict"),
    );
  });
});

test("publishes snapshot-backed manifests only after verified resource and revision binding", async () => {
  await fixture(async (root) => {
    const bytes = Buffer.from("verified normalized text", "utf8");
    const digest = createHash("sha256").update(bytes).digest("hex");
    const snapshot: ResourceSnapshotV1 = {
      version: 1,
      id: "snapshot_ready",
      resourceId: "resource_ready",
      resourceRevision: 1,
      normalizedBlobDigest: digest,
      normalizedMediaType: "text/plain; charset=utf-8",
      normalizedBytes: bytes.byteLength,
      normalizationReceipt: { extractorId: "plain-text", extractorVersion: "1.0.0" },
      sourceSelector: { type: "whole-resource" },
      createdAt: "2026-08-27T12:00:00Z",
    };
    const store = createResearchResourceStore({ root });
    await store.publishSnapshot({ snapshot, normalizedBlob: bytes });
    const catalog = createResearchResourceCatalog({ root });
    const ready = manifest("resource_ready", {
      ingest: { desired: true, state: "ready" },
      currentSnapshotId: snapshot.id,
    });
    assert.equal((await catalog.createManifest(ready)).created, true);
    await assert.rejects(() => store.deleteSnapshot(snapshot.id), hasCode("snapshot-conflict"));
    await assert.rejects(
      () => catalog.createManifest(manifest("wrong_resource", {
        ingest: { desired: true, state: "ready" },
        currentSnapshotId: snapshot.id,
      })),
      hasCode("snapshot-conflict"),
    );

    const cleared = {
      ...ready,
      revision: 2,
      ingest: { desired: false, state: "metadata_only" } as const,
      updatedAt: "2026-08-27T12:01:00Z",
    };
    delete cleared.currentSnapshotId;
    await catalog.updateManifest({
      id: ready.id,
      expectedRevision: 1,
      manifest: cleared,
    });
    assert.equal((await store.deleteSnapshot(snapshot.id)).deleted, true);
  });
});

test("fails manifest reads closed on malformed, broad-mode, and symlink records", async () => {
  await fixture(async (root) => {
    const catalog = createResearchResourceCatalog({ root });
    await catalog.createManifest(manifest("resource_safe"));
    const record = path.join(root, "manifests", "resource_safe.json");
    await writeFile(record, "not json\n", { mode: 0o600 });
    await assert.rejects(() => catalog.getManifest("resource_safe"), hasCode("corrupt"));

    await rm(record);
    await symlink(path.join(root, "outside.json"), record);
    await assert.rejects(() => catalog.getManifest("resource_safe"), hasCode("symlink"));

    await rm(record);
    await writeFile(record, `${JSON.stringify(manifest("resource_safe"))}\n`, { mode: 0o600 });
    if (process.platform !== "win32") {
      await chmod(record, 0o644);
      await assert.rejects(() => catalog.getManifest("resource_safe"), hasCode("unsafe-path"));
    }
  });
});
