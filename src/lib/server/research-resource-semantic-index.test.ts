import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import {
  openResearchResourceSemanticIndex,
  rebuildResearchResourceSemanticIndex,
  removeResearchResourceSemanticPublication,
  ResearchResourceSemanticIndexError,
  type ResearchSemanticAuthority,
} from "./research-resource-semantic-index.ts";

const digest = (character: string) => character.repeat(64);
const authority = (overrides: Partial<ResearchSemanticAuthority> = {}): ResearchSemanticAuthority => ({
  resourceId: "resource-a",
  resourceRevision: 3,
  deletionRevision: 0,
  snapshotId: "snapshot-a",
  snapshotDigest: digest("a"),
  providerId: "local-openai",
  modelId: "nomic-embed-text",
  dimensions: 3,
  modelRevision: digest("b"),
  ...overrides,
});

const vectors = [
  { id: digest("c"), ordinal: 0, byteStart: 0, byteEnd: 5, vector: [1, 0, 0] },
  { id: digest("d"), ordinal: 1, byteStart: 5, byteEnd: 10, vector: [0, 1, 0] },
];

test("semantic index atomically persists compatible model authority and deterministic cosine ranks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-index-"));
  const file = path.join(root, "index", "semantic.sqlite");
  const index = await openResearchResourceSemanticIndex({ file });
  try {
    index.replace(authority(), vectors);
    assert.deepEqual(index.publication("resource-a"), authority());
    assert.deepEqual(index.probe(authority(), [0.9, 0.1, 0]), {
      usable: true,
      vectorCount: 2,
      hits: [
        { id: digest("c"), ordinal: 0, byteStart: 0, byteEnd: 5, score: 0.9938837346736189, rank: 1 },
        { id: digest("d"), ordinal: 1, byteStart: 5, byteEnd: 10, score: 0.11043152607484655, rank: 2 },
      ],
    });
    assert.equal(index.probe(authority({ modelRevision: digest("e") }), [1, 0, 0]).usable, false,
      "another model revision is immediately ineligible");
    assert.equal(index.probe(authority({ snapshotId: "snapshot-stale" }), [1, 0, 0]).usable, false);
  } finally {
    index.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("replacement is all-or-nothing and removal purges publication eligibility", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-replace-"));
  const file = path.join(root, "semantic.sqlite");
  const index = await openResearchResourceSemanticIndex({ file });
  try {
    index.replace(authority(), vectors);
    assert.throws(() => index.replace(authority({ resourceRevision: 4 }), [
      vectors[0], { ...vectors[1], ordinal: 0 },
    ]), (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "invalid-input");
    assert.deepEqual(index.publication("resource-a"), authority(), "failed replacement preserves the old transaction");
    assert.equal(index.remove("resource-a"), true);
    assert.equal(index.remove("resource-a"), false);
    assert.equal(index.publication("resource-a"), null);
  } finally {
    index.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("general deletion cleanup removes an exact publication while another Cave connection is open", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-cleanup-"));
  const file = path.join(root, "semantic.sqlite");
  const index = await openResearchResourceSemanticIndex({ file });
  try {
    index.replace(authority(), vectors);
    await removeResearchResourceSemanticPublication({ file, resourceId: "resource-a" });
    assert.equal(index.publication("resource-a"), null);
  } finally {
    index.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a pre-opened handle is released for rebuild and becomes stale on every platform", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-preopened-rebuild-"));
  const file = path.join(root, "semantic.sqlite");
  const opened = await openResearchResourceSemanticIndex({ file });
  try {
    opened.replace(authority(), vectors);
    const rebuilt = await rebuildResearchResourceSemanticIndex({ file });
    try {
      assert.throws(() => opened.publication("resource-a"),
        (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "stale");
      assert.equal(rebuilt.index.publication("resource-a"), null);
    } finally {
      rebuilt.index.close();
    }
  } finally {
    opened.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a pre-opened child-process handle releases the canonical file before rebuild", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-child-rebuild-"));
  const file = path.join(root, "semantic.sqlite");
  const seed = await openResearchResourceSemanticIndex({ file });
  seed.replace(authority(), vectors);
  seed.close();
  const moduleUrl = pathToFileURL(path.join(process.cwd(),
    "src/lib/server/research-resource-semantic-index.ts")).href;
  const code = `
    const { openResearchResourceSemanticIndex } = await import(${JSON.stringify(moduleUrl)});
    const index = await openResearchResourceSemanticIndex({ file: process.argv[1] });
    process.stdout.write("ready\\n");
    process.stdin.once("data", () => {
      try { index.publication("resource-a"); process.stdout.write("result:usable\\n"); }
      catch (error) { process.stdout.write("result:" + String(error?.code) + "\\n"); }
      index.close();
      process.exit(0);
    });
  `;
  const child = spawn(process.execPath,
    ["--experimental-strip-types", "--input-type=module", "-e", code, file],
    { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    while (!stdout.includes("ready\n")) {
      await Promise.race([
        once(child.stdout, "data"),
        once(child, "exit").then(() => { throw new Error(stderr || "child exited before ready"); }),
      ]);
    }
    const rebuilt = await rebuildResearchResourceSemanticIndex({ file });
    rebuilt.index.close();
    child.stdin.end("probe\n");
    const [exitCode] = await once(child, "exit");
    assert.equal(exitCode, 0, stderr);
    assert.match(stdout, /result:stale/);
  } finally {
    if (child.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  }
});

test("a pre-opened handle maps a missing canonical generation to stale", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-missing-generation-"));
  const file = path.join(root, "semantic.sqlite");
  const opened = await openResearchResourceSemanticIndex({ file });
  try {
    await rename(file, `${file}.corrupt-1-aaaaaaaa`);
    assert.throws(() => opened.publication("resource-a"),
      (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "stale");
  } finally {
    opened.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid vectors, dimensions, boundaries, and zero queries fail closed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-invalid-"));
  const index = await openResearchResourceSemanticIndex({ file: path.join(root, "semantic.sqlite") });
  try {
    for (const invalid of [
      [{ ...vectors[0], vector: [1, 0] }],
      [{ ...vectors[0], vector: [0, 0, 0] }],
      [{ ...vectors[0], vector: [1, Number.NaN, 0] }],
      [{ ...vectors[0], byteEnd: 0 }],
      [{ ...vectors[0], vector: [1e100, 0, 0] }],
      [{ ...vectors[0], vector: [1e-100, 0, 0] }],
    ]) assert.throws(() => index.replace(authority(), invalid), ResearchResourceSemanticIndexError);
    index.replace(authority(), vectors);
    assert.throws(() => index.probe(authority(), [0, 0, 0]), ResearchResourceSemanticIndexError);
    assert.throws(() => index.probe(authority(), [1e100, 0, 0]), ResearchResourceSemanticIndexError);
    assert.throws(() => index.probe(authority(), [1e-100, 0, 0]), ResearchResourceSemanticIndexError);
  } finally {
    index.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("logical row corruption fails exact lexical chunk verification", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-logical-corrupt-"));
  const file = path.join(root, "semantic.sqlite");
  const index = await openResearchResourceSemanticIndex({ file });
  try {
    index.replace(authority(), vectors);
    const database = new DatabaseSync(file);
    database.prepare("UPDATE chunk_embeddings SET byte_end = byte_end + 1 WHERE resource_id = ? AND ordinal = 0")
      .run("resource-a");
    database.close();
    assert.throws(() => index.verify(authority(), vectors),
      (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "corrupt");
  } finally {
    index.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("exact verification rejects extra rows from another snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-extra-row-"));
  const file = path.join(root, "semantic.sqlite");
  const index = await openResearchResourceSemanticIndex({ file });
  try {
    index.replace(authority(), vectors);
    const database = new DatabaseSync(file);
    database.prepare(
      `INSERT INTO chunk_embeddings (
         resource_id, snapshot_id, chunk_id, ordinal, byte_start, byte_end, vector
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run("resource-a", "snapshot-stale", digest("e"), 2, 10, 15,
      Buffer.from([0, 0, 0, 0, 0, 0, 128, 63, 0, 0, 0, 0]));
    database.close();
    assert.throws(() => index.verify(authority(), vectors),
      (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "corrupt");
  } finally {
    index.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("incompatible provider metadata is corruption for publication and replacement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-provider-corrupt-"));
  const file = path.join(root, "semantic.sqlite");
  const index = await openResearchResourceSemanticIndex({ file });
  try {
    index.replace(authority(), vectors);
    const database = new DatabaseSync(file);
    database.prepare("UPDATE provider_state SET chunker_version = ? WHERE model_revision = ?")
      .run("corrupt-chunker", authority().modelRevision);
    database.close();
    for (const operation of [
      () => index.publication("resource-a"),
      () => index.replace(authority(), vectors),
    ]) {
      assert.throws(operation,
        (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "corrupt");
    }
  } finally {
    index.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic index rejects linked files and corrupt schemas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-safety-"));
  try {
    const directory = path.join(root, "index");
    mkdirSync(directory, { mode: 0o700 });
    const target = path.join(root, "target");
    writeFileSync(target, "not sqlite", { mode: 0o600 });
    const linked = path.join(directory, "linked.sqlite");
    symlinkSync(target, linked);
    await assert.rejects(openResearchResourceSemanticIndex({ file: linked }),
      (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "unsafe-path");
    const corrupt = path.join(directory, "corrupt.sqlite");
    writeFileSync(corrupt, "not sqlite", { mode: 0o600 });
    chmodSync(corrupt, 0o600);
    await assert.rejects(openResearchResourceSemanticIndex({ file: corrupt }),
      (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "corrupt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a sidecar swap after validation remains a safety error and never triggers whole-index discard", async () => {
  if (process.platform === "win32") return;
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-sidecar-swap-"));
  const file = path.join(root, "semantic.sqlite");
  try {
    const index = await openResearchResourceSemanticIndex({ file });
    index.replace(authority(), vectors);
    index.close();
    const external = path.join(root, "external-private-content");
    writeFileSync(external, "must not be touched", { mode: 0o600 });
    await assert.rejects(openResearchResourceSemanticIndex({
      file,
      beforeFinalSafetyCheck() {
        rmSync(`${file}-wal`, { force: true });
        rmSync(`${file}-shm`, { force: true });
        symlinkSync(external, `${file}-wal`);
      },
    }),
      (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "unsafe-path");
    if (!existsSync(`${file}-wal`)) symlinkSync(external, `${file}-wal`);
    await assert.rejects(removeResearchResourceSemanticPublication({ file, resourceId: "resource-a" }),
      (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "unsafe-path");
    assert.equal(existsSync(file), true, "a safety failure must not be reclassified and discarded");
    assert.equal(existsSync(external), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prolonged SQLite contention is unavailable and never corruption", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-busy-"));
  const file = path.join(root, "semantic.sqlite");
  const index = await openResearchResourceSemanticIndex({ file });
  const locker = new DatabaseSync(file);
  try {
    locker.exec("BEGIN IMMEDIATE");
    assert.throws(() => index.replace(authority(), vectors),
      (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "unavailable");
    assert.equal(existsSync(file), true);
    locker.exec("ROLLBACK");
    index.replace(authority(), vectors);
    assert.deepEqual(index.publication("resource-a"), authority());
  } finally {
    try { locker.exec("ROLLBACK"); } catch { /* already released */ }
    locker.close();
    index.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("semantic index rejects valid SQLite with incompatible columns and constraints", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-schema-shape-"));
  const file = path.join(root, "semantic.sqlite");
  try {
    const database = new DatabaseSync(file);
    database.exec(`
      CREATE TABLE provider_state (model_revision TEXT PRIMARY KEY);
      CREATE TABLE embedding_state (resource_id TEXT PRIMARY KEY);
      CREATE TABLE chunk_embeddings (resource_id TEXT, ordinal INTEGER);
      PRAGMA user_version = 1;
    `);
    database.close();
    chmodSync(file, 0o600);
    await assert.rejects(openResearchResourceSemanticIndex({ file }),
      (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "corrupt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deletion discards a corrupt whole semantic derivative instead of retaining plaintext", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-corrupt-delete-"));
  const file = path.join(root, "semantic.sqlite");
  try {
    writeFileSync(file, "recoverable private semantic plaintext", { mode: 0o600 });
    await removeResearchResourceSemanticPublication({ file, resourceId: "resource-a" });
    assert.equal(existsSync(file), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupt canonical deletion also purges every validated rebuild residual", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-corrupt-residual-delete-"));
  const file = path.join(root, "semantic.sqlite");
  const residuals = [
    `${file}.corrupt-1-aaaaaaaa`,
    `${file}.corrupt-1-aaaaaaaa-wal`,
    `${file}.corrupt-1-aaaaaaaa-shm`,
    path.join(root, ".research-semantic-1-aaaaaaaaaaaaaaaaaaaaaaaa.sqlite"),
    path.join(root, ".research-semantic-1-aaaaaaaaaaaaaaaaaaaaaaaa.sqlite-wal"),
    path.join(root, ".research-semantic-1-aaaaaaaaaaaaaaaaaaaaaaaa.sqlite-shm"),
  ];
  try {
    writeFileSync(file, "recoverable corrupt canonical semantic content", { mode: 0o600 });
    writeFileSync(`${file}-wal`, "recoverable canonical WAL content", { mode: 0o600 });
    writeFileSync(`${file}-shm`, "recoverable canonical shared-memory content", { mode: 0o600 });
    for (const residual of residuals) {
      writeFileSync(residual, "recoverable rebuild vector content", { mode: 0o600 });
    }

    await removeResearchResourceSemanticPublication({ file, resourceId: "resource-a" });

    for (const candidate of [file, `${file}-wal`, `${file}-shm`, ...residuals]) {
      assert.equal(existsSync(candidate), false, `${path.basename(candidate)} must not retain deleted vectors`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deletion purges a quarantined derivative after a rebuild crash leaves canonical absent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-crash-window-delete-"));
  const file = path.join(root, "semantic.sqlite");
  const quarantine = `${file}.corrupt-1-aaaaaaaa`;
  try {
    const index = await openResearchResourceSemanticIndex({ file });
    index.replace(authority(), vectors);
    index.close();
    await rename(file, quarantine);
    writeFileSync(`${file}-wal`, "recoverable orphaned WAL content", { mode: 0o600 });
    writeFileSync(`${file}-shm`, "recoverable orphaned shared-memory content", { mode: 0o600 });
    await removeResearchResourceSemanticPublication({ file, resourceId: "resource-a" });
    assert.equal(existsSync(file), false);
    assert.equal(existsSync(quarantine), false,
      "deletion cannot retain a recoverable vector database from the rebuild crash window");
    assert.equal(existsSync(`${file}-wal`), false);
    assert.equal(existsSync(`${file}-shm`), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing-canonical deletion refuses a symlinked index directory and preserves external residuals", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX symlink semantics are required");
    return;
  }
  const parent = await mkdtemp(path.join(os.tmpdir(), "research-semantic-missing-index-link-"));
  const root = path.join(parent, "research-resources");
  const outside = path.join(parent, "outside");
  const residual = path.join(outside, "research-resources-semantic.sqlite.corrupt-1-aaaaaaaa");
  try {
    mkdirSync(root, { mode: 0o700 });
    mkdirSync(outside, { mode: 0o700 });
    writeFileSync(residual, "external private content", { mode: 0o600 });
    symlinkSync(outside, path.join(root, "index"));

    await assert.rejects(
      removeResearchResourceSemanticPublication({ root, resourceId: "resource-a" }),
      (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "unsafe-path",
    );
    assert.equal(existsSync(residual), true, "an unsafe index directory cannot widen deletion authority");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("missing-canonical deletion detects a root identity swap before scanning residuals", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX symlink semantics are required");
    return;
  }
  const parent = await mkdtemp(path.join(os.tmpdir(), "research-semantic-missing-root-swap-"));
  const root = path.join(parent, "research-resources");
  const displaced = path.join(parent, "displaced-resources");
  const outside = path.join(parent, "outside");
  const outsideIndex = path.join(outside, "index");
  const externalResidual = path.join(outsideIndex, "research-resources-semantic.sqlite.corrupt-1-aaaaaaaa");
  try {
    mkdirSync(path.join(root, "index"), { recursive: true, mode: 0o700 });
    mkdirSync(outsideIndex, { recursive: true, mode: 0o700 });
    writeFileSync(
      path.join(root, "index", "research-resources-semantic.sqlite.corrupt-1-bbbbbbbb"),
      "owned residual",
      { mode: 0o600 },
    );
    writeFileSync(externalResidual, "external private content", { mode: 0o600 });

    await assert.rejects(removeResearchResourceSemanticPublication({
      root,
      resourceId: "resource-a",
      beforeMissingCanonicalSafetyCheck() {
        renameSync(root, displaced);
        symlinkSync(outside, root);
      },
    }), (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "unsafe-path");
    assert.equal(existsSync(externalResidual), true, "a swapped ancestor cannot expose external residuals");
    assert.equal(
      existsSync(path.join(displaced, "index", "research-resources-semantic.sqlite.corrupt-1-bbbbbbbb")),
      true,
      "the originally validated directory is not mutated after its pathname changes",
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("existing-canonical deletion refuses an ancestor replacement before open and preserves external derivatives", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "research-semantic-existing-root-swap-"));
  const root = path.join(parent, "research-resources");
  const displaced = path.join(parent, "displaced-resources");
  const outside = path.join(parent, "outside");
  const fileName = "research-resources-semantic.sqlite";
  const file = path.join(root, "index", fileName);
  const externalFile = path.join(outside, "index", fileName);
  const externalCandidates = [
    externalFile,
    `${externalFile}-wal`,
    `${externalFile}-shm`,
    `${externalFile}.corrupt-1-aaaaaaaa`,
    path.join(outside, "index", ".research-semantic-1-aaaaaaaaaaaaaaaaaaaaaaaa.sqlite"),
  ];
  try {
    const original = await openResearchResourceSemanticIndex({ file });
    original.replace(authority(), vectors);
    original.close();
    const external = await openResearchResourceSemanticIndex({ file: externalFile });
    external.replace(authority(), vectors);
    external.close();
    for (const candidate of externalCandidates.slice(1)) {
      writeFileSync(candidate, `external:${path.basename(candidate)}`, { mode: 0o600 });
    }
    const externalBytes = new Map(externalCandidates.map((candidate) => [candidate, readFileSync(candidate)]));

    await assert.rejects(removeResearchResourceSemanticPublication({
      root,
      resourceId: "resource-a",
      beforeExistingCanonicalSafetyCheck(boundary) {
        if (boundary !== "open") return;
        renameSync(root, displaced);
        renameSync(outside, root);
      },
    }), (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "unsafe-path");

    for (const [candidate, expected] of externalBytes) {
      const redirected = candidate.replace(outside, root);
      assert.deepEqual(readFileSync(redirected), expected,
        `${path.basename(candidate)} outside the captured root must remain byte-identical`);
    }
    const retained = await openResearchResourceSemanticIndex({
      file: path.join(displaced, "index", fileName),
    });
    assert.deepEqual(retained.publication("resource-a"), authority(),
      "the captured canonical publication is not removed after its ancestor moves");
    retained.close();
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("corrupt-canonical deletion refuses an index replacement before discarding any derivative", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "research-semantic-corrupt-index-swap-"));
  const root = path.join(parent, "research-resources");
  const indexDirectory = path.join(root, "index");
  const displacedIndex = path.join(root, "displaced-index");
  const outsideIndex = path.join(parent, "outside-index");
  const fileName = "research-resources-semantic.sqlite";
  const file = path.join(indexDirectory, fileName);
  const externalFile = path.join(outsideIndex, fileName);
  const externalCandidates = [
    externalFile,
    `${externalFile}-wal`,
    `${externalFile}-shm`,
    `${externalFile}.corrupt-1-aaaaaaaa`,
    path.join(outsideIndex, ".research-semantic-1-aaaaaaaaaaaaaaaaaaaaaaaa.sqlite"),
  ];
  try {
    mkdirSync(indexDirectory, { recursive: true, mode: 0o700 });
    mkdirSync(outsideIndex, { mode: 0o700 });
    writeFileSync(file, "captured corrupt canonical content", { mode: 0o600 });
    for (const candidate of externalCandidates) {
      writeFileSync(candidate, `external:${path.basename(candidate)}`, { mode: 0o600 });
    }
    const externalBytes = new Map(externalCandidates.map((candidate) => [candidate, readFileSync(candidate)]));

    await assert.rejects(removeResearchResourceSemanticPublication({
      root,
      resourceId: "resource-a",
      beforeCorruptCanonicalSafetyCheck(boundary) {
        if (boundary !== "canonical") return;
        renameSync(indexDirectory, displacedIndex);
        renameSync(outsideIndex, indexDirectory);
      },
    }), (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "unsafe-path");

    for (const [candidate, expected] of externalBytes) {
      const redirected = candidate.replace(outsideIndex, indexDirectory);
      assert.deepEqual(readFileSync(redirected), expected,
        `${path.basename(candidate)} outside the captured index must remain byte-identical`);
    }
    assert.equal(readFileSync(path.join(displacedIndex, fileName), "utf8"),
      "captured corrupt canonical content",
      "the captured corrupt derivative is retained when containment cannot be proven");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

for (const boundary of ["remove", "residual-purge"] as const) {
  test(`existing-canonical deletion refuses ancestor replacement at ${boundary} and close cannot touch the replacement`, async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), `research-semantic-existing-${boundary}-swap-`));
    const root = path.join(parent, "research-resources");
    const displaced = path.join(parent, "displaced-resources");
    const outside = path.join(parent, "outside");
    const fileName = "research-resources-semantic.sqlite";
    const file = path.join(root, "index", fileName);
    const externalFile = path.join(outside, "index", fileName);
    const externalCandidates = [
      externalFile,
      `${externalFile}-wal`,
      `${externalFile}-shm`,
      `${externalFile}.corrupt-1-aaaaaaaa`,
      path.join(outside, "index", ".research-semantic-1-aaaaaaaaaaaaaaaaaaaaaaaa.sqlite"),
    ];
    try {
      const original = await openResearchResourceSemanticIndex({ file });
      original.replace(authority(), vectors);
      original.close();
      const external = await openResearchResourceSemanticIndex({ file: externalFile });
      external.replace(authority(), vectors);
      external.close();
      for (const candidate of externalCandidates.slice(1)) {
        writeFileSync(candidate, `external:${path.basename(candidate)}`, { mode: 0o600 });
      }
      const expected = new Map(externalCandidates.map((candidate) => [candidate, readFileSync(candidate)]));
      let swapped = false;
      await assert.rejects(removeResearchResourceSemanticPublication({
        root,
        resourceId: "resource-a",
        beforeExistingCanonicalSafetyCheck(at) {
          if (at !== boundary || swapped) return;
          swapped = true;
          renameSync(root, displaced);
          renameSync(outside, root);
        },
      }), (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "unsafe-path");
      assert.equal(swapped, true);
      for (const [candidate, bytes] of expected) {
        assert.deepEqual(readFileSync(candidate.replace(outside, root)), bytes,
          `${path.basename(candidate)} replacement bytes remain identical at ${boundary}`);
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
}

for (const boundary of ["canonical", "wal", "shm", "residual-purge"] as const) {
  test(`corrupt-canonical deletion refuses index replacement at ${boundary}`, async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), `research-semantic-corrupt-${boundary}-swap-`));
    const root = path.join(parent, "research-resources");
    const indexDirectory = path.join(root, "index");
    const displacedIndex = path.join(root, "displaced-index");
    const outsideIndex = path.join(parent, "outside-index");
    const fileName = "research-resources-semantic.sqlite";
    const file = path.join(indexDirectory, fileName);
    const externalCandidates = [
      path.join(outsideIndex, fileName),
      path.join(outsideIndex, `${fileName}-wal`),
      path.join(outsideIndex, `${fileName}-shm`),
      path.join(outsideIndex, `${fileName}.corrupt-1-aaaaaaaa`),
      path.join(outsideIndex, ".research-semantic-1-aaaaaaaaaaaaaaaaaaaaaaaa.sqlite"),
    ];
    try {
      mkdirSync(indexDirectory, { recursive: true, mode: 0o700 });
      mkdirSync(outsideIndex, { mode: 0o700 });
      for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
        writeFileSync(candidate, `captured:${path.basename(candidate)}`, { mode: 0o600 });
      }
      for (const candidate of externalCandidates) {
        writeFileSync(candidate, `external:${path.basename(candidate)}`, { mode: 0o600 });
      }
      const expected = new Map(externalCandidates.map((candidate) => [candidate, readFileSync(candidate)]));
      let swapped = false;
      await assert.rejects(removeResearchResourceSemanticPublication({
        root,
        resourceId: "resource-a",
        beforeCorruptCanonicalSafetyCheck(at) {
          if (at !== boundary || swapped) return;
          swapped = true;
          renameSync(indexDirectory, displacedIndex);
          renameSync(outsideIndex, indexDirectory);
        },
      }), (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "unsafe-path");
      assert.equal(swapped, true);
      for (const [candidate, bytes] of expected) {
        assert.deepEqual(readFileSync(candidate.replace(outsideIndex, indexDirectory)), bytes,
          `${path.basename(candidate)} replacement bytes remain identical at ${boundary}`);
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
}

const missingResidualNames = [
  "research-resources-semantic.sqlite.corrupt-1-aaaaaaaa",
  "research-resources-semantic.sqlite.corrupt-1-aaaaaaaa-wal",
  "research-resources-semantic.sqlite.corrupt-1-aaaaaaaa-shm",
  ".research-semantic-1-aaaaaaaaaaaaaaaaaaaaaaaa.sqlite",
  ".research-semantic-1-aaaaaaaaaaaaaaaaaaaaaaaa.sqlite-wal",
  ".research-semantic-1-aaaaaaaaaaaaaaaaaaaaaaaa.sqlite-shm",
] as const;
for (const target of ["research-resources-semantic.sqlite-wal", "research-resources-semantic.sqlite-shm", ...missingResidualNames]) {
  test(`missing-canonical deletion refuses ancestor replacement before unlinking ${target}`, async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "research-semantic-missing-boundary-swap-"));
    const root = path.join(parent, "research-resources");
    const displaced = path.join(parent, "displaced-resources");
    const outside = path.join(parent, "outside");
    const indexDirectory = path.join(root, "index");
    const outsideIndex = path.join(outside, "index");
    const allNames = ["research-resources-semantic.sqlite-wal", "research-resources-semantic.sqlite-shm", ...missingResidualNames];
    try {
      mkdirSync(indexDirectory, { recursive: true, mode: 0o700 });
      mkdirSync(outsideIndex, { recursive: true, mode: 0o700 });
      for (const name of allNames) {
        writeFileSync(path.join(indexDirectory, name), `captured:${name}`, { mode: 0o600 });
        writeFileSync(path.join(outsideIndex, name), `external:${name}`, { mode: 0o600 });
      }
      const expected = new Map(allNames.map((name) => [name, readFileSync(path.join(outsideIndex, name))]));
      let swapped = false;
      await assert.rejects(removeResearchResourceSemanticPublication({
        root,
        resourceId: "resource-a",
        beforeMissingCanonicalSafetyCheck(_boundary, candidate) {
          if (path.basename(candidate ?? "") !== target || swapped) return;
          swapped = true;
          renameSync(root, displaced);
          renameSync(outside, root);
        },
      }), (error) => error instanceof ResearchResourceSemanticIndexError && error.code === "unsafe-path");
      assert.equal(swapped, true);
      for (const [name, bytes] of expected) {
        assert.deepEqual(readFileSync(path.join(root, "index", name)), bytes,
          `${name} replacement bytes remain identical`);
      }
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
}

test("safe deletion controls still remove valid, corrupt, and missing canonical derivatives", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-delete-controls-"));
  try {
    const valid = path.join(root, "valid.sqlite");
    const validIndex = await openResearchResourceSemanticIndex({ file: valid });
    validIndex.replace(authority(), vectors);
    validIndex.close();
    await removeResearchResourceSemanticPublication({ file: valid, resourceId: "resource-a" });
    const reopened = await openResearchResourceSemanticIndex({ file: valid });
    assert.equal(reopened.publication("resource-a"), null);
    reopened.close();

    const corrupt = path.join(root, "corrupt.sqlite");
    writeFileSync(corrupt, "private corrupt vector content", { mode: 0o600 });
    await removeResearchResourceSemanticPublication({ file: corrupt, resourceId: "resource-a" });
    assert.equal(existsSync(corrupt), false);

    const missing = path.join(root, "missing.sqlite");
    writeFileSync(`${missing}-wal`, "private orphan sidecar", { mode: 0o600 });
    await removeResearchResourceSemanticPublication({ file: missing, resourceId: "resource-a" });
    assert.equal(existsSync(`${missing}-wal`), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deletion discards logically incompatible provider metadata and every resource vector", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-corrupt-provider-delete-"));
  const file = path.join(root, "semantic.sqlite");
  try {
    const index = await openResearchResourceSemanticIndex({ file });
    index.replace(authority(), vectors);
    index.close();
    const database = new DatabaseSync(file);
    database.prepare("UPDATE provider_state SET vector_encoding_version = ? WHERE model_revision = ?")
      .run("corrupt-vector-encoding", authority().modelRevision);
    database.close();

    await removeResearchResourceSemanticPublication({ file, resourceId: "resource-a" });
    assert.equal(existsSync(file), false,
      "logical corruption discards the whole derivative so deleted vectors cannot survive");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deletion discards a safe valid SQLite derivative with unexpected private schema content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-semantic-unexpected-schema-delete-"));
  const file = path.join(root, "semantic.sqlite");
  try {
    const index = await openResearchResourceSemanticIndex({ file });
    index.replace(authority(), vectors);
    index.close();
    const database = new DatabaseSync(file);
    database.exec("CREATE TABLE unexpected_private_content (content TEXT NOT NULL)");
    database.prepare("INSERT INTO unexpected_private_content (content) VALUES (?)")
      .run("recoverable deleted resource content");
    database.close();

    await removeResearchResourceSemanticPublication({ file, resourceId: "resource-a" });
    assert.equal(existsSync(file), false,
      "unexpected schema objects discard the complete derivative instead of retaining private content");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
