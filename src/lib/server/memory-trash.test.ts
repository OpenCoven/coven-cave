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

// ── Symlinked-parent escapes (cave-c51ij): the lexical classification is not
// enough — the canonical location must stay inside the classified root. ────
{
  const { symlink, unlink } = await import("node:fs/promises");

  // Archive escape: a familiar memory dir aliasing a location OUTSIDE the root.
  const outside = path.join(home, "outside-storage");
  await mkdir(outside, { recursive: true });
  const escapee = path.join(outside, "loot.md");
  await writeFile(escapee, "outside bytes", "utf8");
  const aliasDir = path.join(home, ".coven", "workspaces", "familiars", "alias", "memory");
  await mkdir(path.dirname(aliasDir), { recursive: true });
  await symlink(outside, aliasDir);
  const escapeArchive = await archiveMemoryFile(path.join(aliasDir, "loot.md"), home);
  assert.deepEqual(
    escapeArchive,
    { ok: false, error: "path not allowed" },
    "a symlinked memory parent aliasing outside storage cannot feed archive",
  );
  assert.equal(await readFile(escapee, "utf8"), "outside bytes", "aliased outside file was not moved");

  // Archive alias: a familiar memory dir aliasing CANONICAL Coven storage.
  await unlink(aliasDir);
  await symlink(canonicalDir, aliasDir);
  await writeFile(canonicalFile, "canonical", "utf8");
  const aliasArchive = await archiveMemoryFile(path.join(aliasDir, "canonical.md"), home);
  assert.deepEqual(
    aliasArchive,
    { ok: false, error: "path not allowed" },
    "a symlinked memory parent aliasing canonical storage cannot feed archive",
  );
  assert.equal(await readFile(canonicalFile, "utf8"), "canonical", "canonical file survived the alias");
  await unlink(aliasDir);

  // Restore escape: archive legitimately, then swap the destination parent
  // for a symlink pointing outside before restoring.
  const swapDir = path.join(home, ".coven", "workspaces", "familiars", "swap", "memory");
  await mkdir(swapDir, { recursive: true });
  const swapFile = path.join(swapDir, "swapped.md");
  await writeFile(swapFile, "legit", "utf8");
  const swapArchive = await archiveMemoryFile(swapFile, home);
  assert.equal(swapArchive.ok, true, "legitimate archive before the parent swap succeeds");
  await rm(swapDir, { recursive: true, force: true });
  await symlink(outside, swapDir);
  const swapRestore = await restoreMemoryFile((swapArchive as { trashId: string }).trashId, home);
  assert.deepEqual(
    swapRestore,
    { ok: false, error: "restore target not allowed" },
    "a destination parent swapped for an outside symlink cannot receive a restore",
  );
  await assert.rejects(stat(path.join(outside, "swapped.md")), "nothing was written through the swapped parent");
  await unlink(swapDir);

  // The same trash entry restores cleanly once the real directory is back.
  await mkdir(swapDir, { recursive: true });
  const recovered = await restoreMemoryFile((swapArchive as { trashId: string }).trashId, home);
  assert.equal(recovered.ok, true, "restore succeeds after the real parent returns");
  assert.equal(await readFile(swapFile, "utf8"), "legit", "restored through the real parent");
}

await rm(home, { recursive: true, force: true });

console.log("memory-trash.test: ok");
