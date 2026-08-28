import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import type { ResourceManifestV1, ResourceSnapshotV1 } from "../research-resource-contracts.ts";
import {
  ResearchEmbeddingProviderError,
  validateResearchEmbeddingProviderConfig,
  type ValidatedResearchEmbeddingProviderConfig,
} from "./research-resource-embedding-provider.ts";
import { openResearchResourceLexicalIndex } from "./research-resource-lexical-index.ts";
import { openResearchResourceSemanticIndex } from "./research-resource-semantic-index.ts";
import { createResearchResourceSemantic } from "./research-resource-semantic.ts";
import { createResearchResourceStore } from "./research-resource-store.ts";

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function provider(
  modelId = "nomic-embed-text",
  endpoint = "http://127.0.0.1:11434/v1/embeddings",
): ValidatedResearchEmbeddingProviderConfig {
  return validateResearchEmbeddingProviderConfig({
    providerId: "local-openai",
    protocol: "openai",
    endpoint,
    modelId,
    dimensions: 3,
  });
}

async function fixture(
  operation: (input: Awaited<ReturnType<typeof semanticFixture>>) => Promise<void>,
): Promise<void> {
  const input = await semanticFixture();
  try { await operation(input); } finally {
    input.lexical.close();
    input.semanticIndex.close();
    await rm(input.root, { recursive: true, force: true });
  }
}

async function semanticFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-runner-"));
  const store = createResearchResourceStore({ root });
  const bytes = Buffer.from("alpha semantic passage\nbeta supporting passage\n", "utf8");
  const snapshot: ResourceSnapshotV1 = {
    version: 1,
    id: "snapshot-semantic",
    resourceId: "resource-semantic",
    resourceRevision: 1,
    normalizedBlobDigest: digest(bytes),
    normalizedMediaType: "text/plain; charset=utf-8",
    normalizedBytes: bytes.byteLength,
    normalizationReceipt: { extractorId: "plain-text", extractorVersion: "1.0.0" },
    sourceSelector: { type: "whole-resource" },
    createdAt: "2026-08-27T20:00:00Z",
  };
  const manifest: ResourceManifestV1 = {
    version: 1,
    id: snapshot.resourceId,
    revision: 1,
    kind: "saved-resource",
    canonicalIdentity: "https://example.com/semantic",
    title: "Semantic resource",
    sourceUri: "https://example.com/semantic",
    sourceType: "saved-link",
    category: "article",
    subject: {},
    sensitivity: "private",
    ingest: { desired: true, state: "ready" },
    currentSnapshotId: snapshot.id,
    createdAt: "2026-08-27T20:00:00Z",
    updatedAt: "2026-08-27T20:00:00Z",
  };
  await store.publishSnapshot({ snapshot, normalizedBlob: bytes });
  await store.createManifest(manifest);
  const lexical = await openResearchResourceLexicalIndex({
    file: path.join(root, "index", "research-resources.sqlite"),
  });
  const lexicalAuthority = {
    resourceId: snapshot.resourceId,
    resourceRevision: snapshot.resourceRevision,
    deletionRevision: 0,
    snapshotId: snapshot.id,
    snapshotDigest: snapshot.normalizedBlobDigest,
  };
  lexical.replace({ ...lexicalAuthority, normalizedBytes: bytes });
  const semanticIndex = await openResearchResourceSemanticIndex({
    file: path.join(root, "index", "research-resources-semantic.sqlite"),
  });
  return { root, store, bytes, snapshot, manifest, lexical, lexicalAuthority, semanticIndex };
}

function runNode(code: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", code, ...args],
      { cwd: process.cwd() }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message, { cause: error }));
        else resolve(stdout.trim());
      });
  });
}

test("disabled and unavailable semantic operation leave lexical retrieval independently usable", async () => {
  await fixture(async (input) => {
    const disabled = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: input.semanticIndex, enabled: () => false,
    });
    assert.deepEqual(disabled.availability(), { state: "disabled" });
    await disabled.reconcileStartup();
    assert.deepEqual(await disabled.runNext(), { kind: "disabled" });
    await disabled.close();
    assert.equal(input.lexical.probe(input.lexicalAuthority, "alpha").usable, true);

    const unavailable = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: input.semanticIndex, enabled: () => true,
      provider: () => ({ state: "unavailable", code: "not_configured" }),
    });
    assert.deepEqual(unavailable.availability(), { state: "unavailable", code: "not_configured" });
    await unavailable.reconcileStartup();
    assert.deepEqual(await unavailable.runNext(), { kind: "unavailable", code: "not_configured" });
    assert.equal(input.lexical.probe(input.lexicalAuthority, "alpha").usable, true);
  });
});

test("disabled construction does not create a semantic derivative", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-disabled-lazy-"));
  try {
    const semantic = createResearchResourceSemantic({ root, enabled: () => false });
    assert.deepEqual(semantic.availability(), { state: "disabled" });
    await semantic.reconcileStartup();
    await semantic.close();
    assert.equal(existsSync(path.join(root, "index", "research-resources-semantic.sqlite")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reconciliation builds one compatible task and publishes deterministic queryable vectors", async () => {
  await fixture(async (input) => {
    const effective = provider();
    let calls = 0;
    const semantic = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: input.semanticIndex, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }),
      embed: async (_config, texts) => {
        calls += 1;
        return texts.map((_text, index) => index === 0 ? [1, 0, 0] : [0, 1, 0]);
      },
      now: (() => {
        let tick = 0;
        return () => new Date(Date.parse("2026-08-27T20:00:01Z") + tick++);
      })(),
    });
    await Promise.all([
      semantic.reconcileStartup(), semantic.reconcileStartup(), semantic.reconcileStartup(),
    ]);
    const tasks = await input.store.withOperationalTransaction(async (transaction) => transaction.listEmbeddingTasks());
    assert.equal(tasks.length, 1, "repeated reconciliation creates exactly one task");
    const outcome = await semantic.runNext();
    assert.equal(outcome.kind, "ready");
    assert.equal(calls, 1);
    assert.equal((await semantic.resourceState(input.snapshot.resourceId)).state, "ready");
    const probe = await semantic.probe(input.snapshot.resourceId, [1, 0, 0]);
    assert.equal(probe.usable, true);
    assert.equal(probe.vectorCount, 1);
    assert.equal(probe.hits[0]?.rank, 1);
    assert.deepEqual(await semantic.runNext(), { kind: "idle" });
  });
});

test("the shared filesystem lock permits only one child process to claim an embedding task", async () => {
  await fixture(async (input) => {
    const effective = provider();
    const semantic = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: input.semanticIndex, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }),
    });
    await semantic.reconcileStartup();
    const storeUrl = pathToFileURL(path.join(process.cwd(), "src/lib/server/research-resource-store.ts")).href;
    const code = `
      const { createResearchResourceStore } = await import(${JSON.stringify(storeUrl)});
      const store = createResearchResourceStore({ root: process.argv[1] });
      const result = await store.withOperationalTransaction(async (transaction) => {
        const task = transaction.readEmbeddingTask("resource-semantic");
        if (!task || task.status !== "queued") return "idle";
        await transaction.replaceEmbeddingTask(task, {
          ...task, status: "building",
          updatedAt: new Date(Date.parse(task.updatedAt) + 1).toISOString(),
        });
        return "claimed";
      });
      process.stdout.write(result);
    `;
    const outcomes = await Promise.all([runNode(code, [input.root]), runNode(code, [input.root])]);
    assert.deepEqual(outcomes.sort(), ["claimed", "idle"]);
  });
});

test("a corrupt semantic derivative is quarantined and rebuilt only through verified re-embedding", async () => {
  await fixture(async (input) => {
    const effective = provider();
    const first = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: input.semanticIndex, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }), embed: async () => [[1, 0, 0]],
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-27T20:30:00Z") + tick++); })(),
    });
    await first.reconcileStartup();
    assert.equal((await first.runNext()).kind, "ready");
    input.semanticIndex.close();
    const file = path.join(input.root, "index", "research-resources-semantic.sqlite");
    await writeFile(file, "corrupt semantic bytes", { mode: 0o600 });

    const recovered = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }), embed: async () => [[1, 0, 0]],
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-27T20:31:00Z") + tick++); })(),
    });
    await recovered.reconcileStartup();
    assert.equal((await input.store.withOperationalTransaction(async (transaction) =>
      transaction.readEmbeddingTask(input.snapshot.resourceId)))?.status, "queued");
    assert.equal((await recovered.runNext()).kind, "ready");
    assert.equal((await recovered.probe(input.snapshot.resourceId, [1, 0, 0])).usable, true);
    await recovered.close();
  });
});

test("startup rebuilds valid SQLite with an incompatible schema before verified re-embedding", async () => {
  await fixture(async (input) => {
    const effective = provider();
    const first = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: input.semanticIndex, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }), embed: async () => [[1, 0, 0]],
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-27T20:32:00Z") + tick++); })(),
    });
    await first.reconcileStartup();
    assert.equal((await first.runNext()).kind, "ready");
    input.semanticIndex.close();
    const file = path.join(input.root, "index", "research-resources-semantic.sqlite");
    await writeFile(file, "", { mode: 0o600 });
    const incompatible = new DatabaseSync(file);
    incompatible.exec(`
      CREATE TABLE provider_state (model_revision TEXT PRIMARY KEY);
      CREATE TABLE embedding_state (resource_id TEXT PRIMARY KEY);
      CREATE TABLE chunk_embeddings (resource_id TEXT, ordinal INTEGER);
      PRAGMA user_version = 1;
    `);
    incompatible.close();

    const recovered = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }), embed: async () => [[1, 0, 0]],
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-27T20:33:00Z") + tick++); })(),
    });
    await recovered.reconcileStartup();
    assert.equal((await input.store.withOperationalTransaction(async (transaction) =>
      transaction.readEmbeddingTask(input.snapshot.resourceId)))?.status, "queued");
    assert.equal((await recovered.runNext()).kind, "ready");
    assert.equal((await recovered.probe(input.snapshot.resourceId, [1, 0, 0])).usable, true);
    await recovered.close();
  });
});

test("eight child reconcilers serialize corrupt-index quarantine and converge on one rebuild", async () => {
  await fixture(async (input) => {
    const effective = provider();
    const first = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: input.semanticIndex, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }), embed: async () => [[1, 0, 0]],
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-27T20:35:00Z") + tick++); })(),
    });
    await first.reconcileStartup();
    assert.equal((await first.runNext()).kind, "ready");
    input.semanticIndex.close();
    const file = path.join(input.root, "index", "research-resources-semantic.sqlite");
    await writeFile(file, "corrupt semantic bytes", { mode: 0o600 });

    const semanticUrl = pathToFileURL(
      path.join(process.cwd(), "src/lib/server/research-resource-semantic.ts"),
    ).href;
    const providerUrl = pathToFileURL(
      path.join(process.cwd(), "src/lib/server/research-resource-embedding-provider.ts"),
    ).href;
    const code = `
      const { createResearchResourceSemantic } = await import(${JSON.stringify(semanticUrl)});
      const { validateResearchEmbeddingProviderConfig } = await import(${JSON.stringify(providerUrl)});
      const effective = validateResearchEmbeddingProviderConfig({
        providerId: "local-openai", protocol: "openai",
        endpoint: "http://127.0.0.1:11434/v1/embeddings",
        modelId: "nomic-embed-text", dimensions: 3,
      });
      const semantic = createResearchResourceSemantic({
        root: process.argv[1], enabled: () => true,
        provider: () => ({ state: "ready", ...effective }),
      });
      await semantic.reconcileStartup();
      await semantic.close();
      process.stdout.write("ok");
    `;
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => runNode(code, [input.root])));
    assert.deepEqual(outcomes, Array.from({ length: 8 }, () => "ok"));
    const quarantines = (await readdir(path.dirname(file)))
      .filter((name) => /^research-resources-semantic\.sqlite\.corrupt-[0-9]+-[a-f0-9]{8}$/.test(name));
    assert.equal(quarantines.length, 1, "the shared mutation lock admits one quarantine winner");
    assert.equal((await input.store.withOperationalTransaction(async (transaction) =>
      transaction.readEmbeddingTask(input.snapshot.resourceId)))?.status, "queued");

    const recovered = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }), embed: async () => [[1, 0, 0]],
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-27T20:36:00Z") + tick++); })(),
    });
    assert.equal((await recovered.runNext()).kind, "ready");
    assert.equal((await recovered.probe(input.snapshot.resourceId, [1, 0, 0])).usable, true);
    await recovered.close();
  });
});

test("logical semantic row corruption becomes not-ready and is rebuilt from verified chunks", async () => {
  await fixture(async (input) => {
    const effective = provider();
    const semantic = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: undefined, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }), embed: async () => [[1, 0, 0]],
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-27T20:40:00Z") + tick++); })(),
    });
    await semantic.reconcileStartup();
    assert.equal((await semantic.runNext()).kind, "ready");
    const file = path.join(input.root, "index", "research-resources-semantic.sqlite");
    const database = new DatabaseSync(file);
    database.prepare("UPDATE chunk_embeddings SET byte_end = byte_end + 1 WHERE resource_id = ?")
      .run(input.snapshot.resourceId);
    database.close();
    assert.deepEqual(await semantic.resourceState(input.snapshot.resourceId), {
      state: "unavailable", code: "not_ready",
    });
    if (process.platform !== "win32") {
      assert.throws(() => input.semanticIndex.publication(input.snapshot.resourceId),
        (error) => error instanceof Error && "code" in error && error.code === "stale");
    }
    await semantic.reconcileStartup();
    assert.equal((await semantic.runNext()).kind, "ready");
    assert.equal((await semantic.probe(input.snapshot.resourceId, [1, 0, 0])).usable, true);
    await semantic.close();
  });
});

test("an owned stale handle reopens after the canonical file disappears", async (t) => {
  if (process.platform === "win32") {
    t.skip("Windows replacement is covered by the rebuild-marker child-process regression");
    return;
  }
  await fixture(async (input) => {
    const effective = provider();
    const semantic = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: undefined, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }), embed: async () => [[1, 0, 0]],
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-27T20:50:00Z") + tick++); })(),
    });
    await semantic.reconcileStartup();
    assert.equal((await semantic.runNext()).kind, "ready");
    const file = path.join(input.root, "index", "research-resources-semantic.sqlite");
    await rename(file, `${file}.corrupt-1-aaaaaaaa`);
    assert.deepEqual(await semantic.resourceState(input.snapshot.resourceId), {
      state: "unavailable", code: "not_ready",
    });
    await semantic.reconcileStartup();
    assert.equal((await semantic.runNext()).kind, "ready");
    assert.equal((await semantic.probe(input.snapshot.resourceId, [1, 0, 0])).usable, true);
    await semantic.close();
  });
});

test("model revision changes invalidate ready vectors before rebuilding them", async () => {
  await fixture(async (input) => {
    let effective = provider();
    const semantic = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: input.semanticIndex, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }),
      embed: async () => [[1, 0, 0]],
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-27T21:00:00Z") + tick++); })(),
    });
    await semantic.reconcileStartup();
    assert.equal((await semantic.runNext()).kind, "ready");
    const firstRevision = input.semanticIndex.publication(input.snapshot.resourceId)!.modelRevision;

    effective = provider("replacement-model");
    assert.equal((await semantic.resourceState(input.snapshot.resourceId)).state, "unavailable");
    assert.equal((await semantic.probe(input.snapshot.resourceId, [1, 0, 0])).usable, false);
    await semantic.reconcileStartup();
    assert.equal((await semantic.runNext()).kind, "ready");
    assert.notEqual(input.semanticIndex.publication(input.snapshot.resourceId)!.modelRevision, firstRevision);
  });
});

test("provider outages and incompatible responses become truthful task states without hiding lexical rows", async () => {
  await fixture(async (input) => {
    const effective = provider();
    const semantic = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: input.semanticIndex, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }),
      embed: async () => {
        throw new ResearchEmbeddingProviderError(
          "provider_offline", "unavailable", "embedding provider is unavailable",
        );
      },
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-27T22:00:00Z") + tick++); })(),
    });
    await semantic.reconcileStartup();
    const outcome = await semantic.runNext();
    assert.equal(outcome.kind, "task_unavailable");
    assert.equal((await semantic.resourceState(input.snapshot.resourceId)).state, "unavailable");
    assert.equal(input.lexical.probe(input.lexicalAuthority, "alpha").usable, true);
  });
});

test("a failed task is replaced when only the compatible endpoint revision changes", async () => {
  await fixture(async (input) => {
    let effective = provider();
    const semantic = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: input.semanticIndex, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }),
      embed: async () => { throw new Error("incompatible response"); },
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-27T22:30:00Z") + tick++); })(),
    });
    await semantic.reconcileStartup();
    assert.equal((await semantic.runNext()).kind, "failed");
    const failed = await input.store.withOperationalTransaction(async (transaction) =>
      transaction.readEmbeddingTask(input.snapshot.resourceId)!);
    assert.equal(failed.status, "failed");

    effective = provider("nomic-embed-text", "http://127.0.0.2:11434/v1/embeddings");
    await semantic.reconcileStartup();
    const replacement = await input.store.withOperationalTransaction(async (transaction) =>
      transaction.readEmbeddingTask(input.snapshot.resourceId)!);
    assert.equal(replacement.status, "queued");
    assert.notEqual(replacement.modelRevision, failed.modelRevision);
    assert.equal(replacement.providerId, failed.providerId);
    assert.equal(replacement.modelId, failed.modelId);
    assert.equal(replacement.dimensions, failed.dimensions);
  });
});

test("a crash after vector commit requeues building work and converges without duplicate publication", async () => {
  await fixture(async (input) => {
    const effective = provider();
    let crash = true;
    const semantic = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: input.semanticIndex, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }),
      embed: async () => [[1, 0, 0]],
      failpoint: () => {
        if (crash) throw new Error("simulated crash");
      },
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-27T23:00:00Z") + tick++); })(),
    });
    await semantic.reconcileStartup();
    await assert.rejects(semantic.runNext(), /simulated crash/);
    assert.equal((await input.store.withOperationalTransaction(async (transaction) =>
      transaction.readEmbeddingTask(input.snapshot.resourceId)))?.status, "building");
    crash = false;
    await semantic.reconcileStartup();
    assert.equal((await semantic.runNext()).kind, "ready");
    assert.equal((await semantic.probe(input.snapshot.resourceId, [1, 0, 0])).vectorCount, 1);
  });
});

test("feature disable during provider work preserves a replayable task for re-enable", async () => {
  await fixture(async (input) => {
    const effective = provider();
    let active = true;
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const began = new Promise<void>((resolve) => { started = resolve; });
    const semantic = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: input.semanticIndex, enabled: () => active,
      provider: () => ({ state: "ready", ...effective }),
      embed: async () => { started(); await waiting; return [[1, 0, 0]]; },
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-27T23:30:00Z") + tick++); })(),
    });
    await semantic.reconcileStartup();
    const first = semantic.runNext();
    await began;
    active = false;
    release();
    assert.deepEqual(await first, { kind: "disabled" });
    assert.equal((await input.store.withOperationalTransaction(async (transaction) =>
      transaction.readEmbeddingTask(input.snapshot.resourceId)))?.status, "building");
    active = true;
    await semantic.reconcileStartup();
    assert.equal((await semantic.runNext()).kind, "ready");
  });
});

test("simultaneous runners claim a task once and removal fences a late provider result", async () => {
  await fixture(async (input) => {
    const effective = provider();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const began = new Promise<void>((resolve) => { started = resolve; });
    const semantic = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: input.semanticIndex, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }),
      embed: async () => { started(); await waiting; return [[1, 0, 0]]; },
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-28T00:00:00Z") + tick++); })(),
    });
    await semantic.reconcileStartup();
    const first = semantic.runNext();
    await began;
    assert.deepEqual(await semantic.runNext(), { kind: "idle" });
    await semantic.removeResource(input.snapshot.resourceId);
    release();
    assert.equal((await first).kind, "stale");
    assert.equal(input.semanticIndex.publication(input.snapshot.resourceId), null);
  });
});

test("refresh and provider revision changes fence late embedding results", async () => {
  await fixture(async (input) => {
    let effective = provider();
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const began = new Promise<void>((resolve) => { started = resolve; });
    const semantic = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: input.semanticIndex, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }),
      embed: async () => { started(); await waiting; return [[1, 0, 0]]; },
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-28T00:30:00Z") + tick++); })(),
    });
    await semantic.reconcileStartup();
    const run = semantic.runNext();
    await began;
    effective = provider("replacement-model");
    release();
    assert.equal((await run).kind, "task_unavailable");
    assert.equal(input.semanticIndex.publication(input.snapshot.resourceId), null);

    effective = provider();
    await semantic.reconcileStartup();
    let releaseRefresh!: () => void;
    let startedRefresh!: () => void;
    const waitRefresh = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    const beginRefresh = new Promise<void>((resolve) => { startedRefresh = resolve; });
    const refreshRunner = createResearchResourceSemantic({
      root: input.root, store: input.store, lexicalIndex: input.lexical,
      semanticIndex: input.semanticIndex, enabled: () => true,
      provider: () => ({ state: "ready", ...effective }),
      embed: async () => { startedRefresh(); await waitRefresh; return [[1, 0, 0]]; },
      now: (() => { let tick = 0; return () => new Date(Date.parse("2026-08-28T00:31:00Z") + tick++); })(),
    });
    const refreshRun = refreshRunner.runNext();
    await beginRefresh;
    await input.store.withOperationalTransaction(async (transaction) => {
      const { currentSnapshotId: _currentSnapshotId, ...refreshing } = input.manifest;
      await transaction.updateManifest({
        id: input.manifest.id,
        expectedRevision: input.manifest.revision,
        manifest: {
          ...refreshing,
          revision: 2,
          ingest: { desired: true, state: "queued" },
          updatedAt: "2026-08-28T00:31:01Z",
        },
      });
    });
    releaseRefresh();
    assert.equal((await refreshRun).kind, "stale");
    assert.equal(input.semanticIndex.publication(input.snapshot.resourceId), null);
  });
});
