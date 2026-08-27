import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  chunkResearchResourceUtf8,
  openResearchResourceLexicalIndex,
  rebuildResearchResourceLexicalIndex,
  ResearchResourceLexicalIndexError,
  type ResearchLexicalAuthority,
} from "./research-resource-lexical-index.ts";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function authority(overrides: Partial<ResearchLexicalAuthority> = {}): ResearchLexicalAuthority {
  return {
    resourceId: "resource_a",
    resourceRevision: 1,
    deletionRevision: 0,
    snapshotId: "snapshot_a",
    snapshotDigest: DIGEST_A,
    ...overrides,
  };
}

async function fixture(operation: (file: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "research-lexical-"));
  try {
    await operation(path.join(root, "index", "research-resources.sqlite"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("UTF-8 chunking is deterministic, byte-scoped, and never splits a code point", () => {
  const text = "ab😀cdéfg";
  const bytes = new TextEncoder().encode(text);
  const first = chunkResearchResourceUtf8(bytes, authority(), 5);
  const second = chunkResearchResourceUtf8(bytes, authority(), 5);
  assert.deepEqual(second, first);
  assert.equal(first[0]?.text, "ab");
  assert.deepEqual(first.map((chunk) => [chunk.byteStart, chunk.byteEnd]), [[0, 2], [2, 7], [7, 12]]);
  assert.equal(first.map((chunk) => chunk.text).join(""), text);
  assert.deepEqual(
    Buffer.concat(first.map((chunk) => Buffer.from(chunk.text, "utf8"))),
    Buffer.from(bytes),
  );
  assert.notEqual(first[0]?.id, chunkResearchResourceUtf8(bytes, authority({ snapshotId: "snapshot_b" }), 5)[0]?.id);
  assert.notEqual(first[0]?.id, chunkResearchResourceUtf8(bytes, authority({ deletionRevision: 1 }), 5)[0]?.id);
  assert.throws(
    () => chunkResearchResourceUtf8(Uint8Array.from([0xc3, 0x28]), authority()),
    (error) => error instanceof ResearchResourceLexicalIndexError && error.code === "invalid-input",
  );
});

test("private SQLite publication replaces one authority transactionally and probes only the exact snapshot", async () => {
  await fixture(async (file) => {
    const index = await openResearchResourceLexicalIndex({ file });
    const first = authority();
    const sibling = authority({
      resourceId: "resource_b",
      snapshotId: "snapshot_b",
      snapshotDigest: DIGEST_B,
    });
    index.replace({ ...first, normalizedBytes: new TextEncoder().encode("alpha coven first") });
    index.replace({ ...sibling, normalizedBytes: new TextEncoder().encode("alpha sibling") });
    assert.equal(index.probe(first, "coven").hits.length, 1);
    assert.equal(index.probe({ ...first, snapshotId: "snapshot_stale" }, "coven").usable, false);
    assert.equal(index.probe({ ...first, deletionRevision: 1 }, "coven").usable, false);

    const next = authority({ resourceRevision: 2, snapshotId: "snapshot_next", snapshotDigest: DIGEST_B });
    index.replace({ ...next, normalizedBytes: new TextEncoder().encode("beta replacement") });
    assert.equal(index.probe(first, "coven").usable, false);
    assert.equal(index.probe(next, "coven").hits.length, 0);
    assert.equal(index.probe(next, "replacement").hits.length, 1);
    assert.equal(index.probe(sibling, "sibling").hits.length, 1);
    assert.equal(index.remove(first), false, "stale removal cannot delete a newer publication");
    assert.equal(index.remove({ ...next, deletionRevision: 1 }), false, "another deletion generation cannot remove the publication");
    assert.equal(index.remove(next), true);
    assert.equal(index.probe(next, "replacement").usable, false);
    index.purgeResidualFiles();
    for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
      const bytes = await readFile(candidate).catch(() => Buffer.alloc(0));
      assert.equal(
        bytes.includes(Buffer.from("beta replacement")),
        false,
        "deleted plaintext is absent from the compacted database and sidecars",
      );
    }
    index.close();

    if (process.platform !== "win32") {
      assert.equal((await lstat(path.dirname(file))).mode & 0o777, 0o700);
      assert.equal((await lstat(file)).mode & 0o777, 0o600);
    }
    const reopened = await openResearchResourceLexicalIndex({ file });
    assert.equal(reopened.probe(sibling, "sibling").hits.length, 1);
    reopened.close();
  });
});

test("unsafe SQLite paths fail closed", {
  skip: process.platform === "win32" ? "POSIX symlink and mode assertions" : false,
}, async () => {
  await fixture(async (file) => {
    await writeFile(file, "not sqlite", { mode: 0o644 }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "not sqlite", { mode: 0o644 });
    });
    await chmod(path.dirname(file), 0o700);
    await assert.rejects(
      () => openResearchResourceLexicalIndex({ file }),
      (error) => error instanceof ResearchResourceLexicalIndexError && error.code === "unsafe-path",
    );
    await chmod(file, 0o600);
    await rm(file);
    const outside = path.join(path.dirname(path.dirname(file)), "outside.sqlite");
    await writeFile(outside, "outside", { mode: 0o600 });
    await symlink(outside, file);
    await assert.rejects(
      () => openResearchResourceLexicalIndex({ file }),
      (error) => error instanceof ResearchResourceLexicalIndexError && error.code === "unsafe-path",
    );
  });
});

test("corruption is preserved until verified reconstruction succeeds, then atomically replaced", async () => {
  await fixture(async (file) => {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, "corrupt derivative", { mode: 0o600 });
    await assert.rejects(
      () => openResearchResourceLexicalIndex({ file }),
      (error) => error instanceof ResearchResourceLexicalIndexError && error.code === "corrupt",
    );
    assert.equal(await readFile(file, "utf8"), "corrupt derivative");

    await assert.rejects(
      () => rebuildResearchResourceLexicalIndex({ file }, () => {
        throw new Error("authoritative snapshot verification failed");
      }),
      /snapshot verification failed/,
    );
    assert.equal(await readFile(file, "utf8"), "corrupt derivative");
    assert.deepEqual(
      (await readdir(path.dirname(file))).sort(),
      ["research-resources.sqlite"],
      "failed reconstruction leaves neither a partial replacement nor temp sidecars",
    );

    const current = authority();
    const rebuilt = await rebuildResearchResourceLexicalIndex({ file }, (candidate) => {
      candidate.replace({
        ...current,
        normalizedBytes: new TextEncoder().encode("verified snapshot reconstruction"),
      });
    });
    assert.ok(rebuilt.quarantinePath);
    assert.equal(await readFile(rebuilt.quarantinePath!, "utf8"), "corrupt derivative");
    assert.equal(rebuilt.index.probe(current, "verified snapshot").hits.length, 1);
    const interrupted = path.join(
      path.dirname(file),
      `.research-lexical-123-${"c".repeat(24)}.sqlite`,
    );
    await writeFile(interrupted, "recoverable plaintext", { mode: 0o600 });
    rebuilt.index.purgeResidualFiles();
    assert.deepEqual(
      (await readdir(path.dirname(file)))
        .filter((name) => name.includes(".corrupt-") || name.startsWith(".research-lexical-"))
        .sort(),
      [],
      "deletion-time cleanup removes corrupt and interrupted-rebuild plaintext residue",
    );
    rebuilt.index.close();
  });
});
