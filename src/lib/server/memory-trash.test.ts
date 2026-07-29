import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { archiveMemoryFile, restoreMemoryFile, purgeMemoryTrash, listMemoryTrash } from "./memory-trash.ts";

const home = await mkdtemp(path.join(tmpdir(), "memtrash-"));
const memDir = path.join(home, ".coven", "workspaces", "familiars", "sage", "memory");
const canonicalDir = path.join(home, ".coven", "memory", "sage");
await mkdir(memDir, { recursive: true });
await mkdir(canonicalDir, { recursive: true });
const file = path.join(memDir, "note.md");
const canonicalFile = path.join(canonicalDir, "canonical.md");
await writeFile(file, "hello", "utf8");
await writeFile(canonicalFile, "canonical", "utf8");

const canonicalArchive = await archiveMemoryFile(canonicalFile, home);
assert.deepEqual(
  canonicalArchive,
  { ok: false, error: "path not allowed" },
  "canonical Coven memory cannot be archived through the file API",
);
assert.equal(await readFile(canonicalFile, "utf8"), "canonical", "canonical file remains in place");

const res = await archiveMemoryFile(file, home);
assert.equal(res.ok, true, "archive ok");
await assert.rejects(stat(file), "original moved away");
const trashId = (res as { trashId: string }).trashId;
const list = await listMemoryTrash(home);
assert.ok(list.some((t) => t.trashId === trashId && t.originalPath === file), "listed with original path");

// structural rejected
const mem = path.join(memDir, "MEMORY.md");
await writeFile(mem, "# index", "utf8");
assert.deepEqual(
  await archiveMemoryFile(mem, home),
  { ok: false, error: "protected: structural memory" },
  "structural MEMORY.md protection remains unchanged",
);
// outside-root rejected
assert.equal((await archiveMemoryFile(path.join(home, "secret.md"), home)).ok, false, "outside root rejected");

// A forged sidecar cannot turn restore into a write to canonical storage.
const trashDir = path.join(home, ".coven", ".cave-trash", "memory");
const forgedTrashId = "1700000000000-forged.md";
const forgedCanonicalTarget = path.join(canonicalDir, "restored-from-forgery.md");
await mkdir(trashDir, { recursive: true });
await writeFile(path.join(trashDir, forgedTrashId), "forged payload", "utf8");
await writeFile(
  path.join(trashDir, `${forgedTrashId}.json`),
  JSON.stringify({
    originalPath: forgedCanonicalTarget,
    deletedAt: "2026-01-01T00:00:00.000Z",
  }),
  "utf8",
);
assert.deepEqual(
  await restoreMemoryFile(forgedTrashId, home),
  { ok: false, error: "restore target not allowed" },
  "forged canonical restore targets fail closed",
);
await assert.rejects(stat(forgedCanonicalTarget), "forged restore target is not created");
await rm(path.join(trashDir, forgedTrashId), { force: true });
await rm(path.join(trashDir, `${forgedTrashId}.json`), { force: true });

// restore
const restored = await restoreMemoryFile(trashId, home);
assert.equal(restored.ok, true, "restore ok");
assert.equal(await readFile(file, "utf8"), "hello", "restored to original path");

// re-archive then purge
const r2 = await archiveMemoryFile(file, home);
assert.equal(r2.ok, true);
const purged = await purgeMemoryTrash((r2 as { trashId: string }).trashId, home);
assert.equal(purged.ok, true, "purge ok");
assert.equal((await listMemoryTrash(home)).length, 0, "trash empty after purge");

import { writeFile as wf2 } from "node:fs/promises";
// Path-traversal: a malicious trashId must NOT delete/move files outside the trash dir.
const victim = path.join(memDir, "victim.md");
await wf2(victim, "do not delete me", "utf8");
const evilPurge = await purgeMemoryTrash("../../workspaces/familiars/sage/memory/victim.md", home);
assert.equal(evilPurge.ok, false, "traversal purge rejected");
assert.equal(await readFile(victim, "utf8"), "do not delete me", "victim survived traversal purge");
const evilRestore = await restoreMemoryFile("../../workspaces/familiars/sage/memory/victim", home);
assert.equal(evilRestore.ok, false, "traversal restore rejected");
assert.equal(await readFile(victim, "utf8"), "do not delete me", "victim survived traversal restore");
// also reject absolute and dot-dot ids
assert.equal((await purgeMemoryTrash("/etc/hosts", home)).ok, false, "absolute trashId rejected");

await rm(home, { recursive: true, force: true });

console.log("memory-trash.test: ok");
