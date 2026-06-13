import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { archiveMemoryFile, restoreMemoryFile, purgeMemoryTrash, listMemoryTrash } from "./memory-trash.ts";

const home = await mkdtemp(path.join(tmpdir(), "memtrash-"));
const memDir = path.join(home, ".coven", "memory", "kitty");
await mkdir(memDir, { recursive: true });
const file = path.join(memDir, "note.md");
await writeFile(file, "hello", "utf8");

const res = await archiveMemoryFile(file, home);
assert.equal(res.ok, true, "archive ok");
await assert.rejects(stat(file), "original moved away");
const trashId = (res as { trashId: string }).trashId;
const list = await listMemoryTrash(home);
assert.ok(list.some((t) => t.trashId === trashId && t.originalPath === file), "listed with original path");

// structural rejected
const mem = path.join(memDir, "MEMORY.md");
await writeFile(mem, "# index", "utf8");
assert.equal((await archiveMemoryFile(mem, home)).ok, false, "structural rejected");
// outside-root rejected
assert.equal((await archiveMemoryFile(path.join(home, "secret.md"), home)).ok, false, "outside root rejected");

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
const victim = path.join(home, ".coven", "memory", "kitty", "victim.md");
await wf2(victim, "do not delete me", "utf8");
const evilPurge = await purgeMemoryTrash("../../memory/kitty/victim.md", home);
assert.equal(evilPurge.ok, false, "traversal purge rejected");
assert.equal(await readFile(victim, "utf8"), "do not delete me", "victim survived traversal purge");
const evilRestore = await restoreMemoryFile("../../memory/kitty/victim", home);
assert.equal(evilRestore.ok, false, "traversal restore rejected");
assert.equal(await readFile(victim, "utf8"), "do not delete me", "victim survived traversal restore");
// also reject absolute and dot-dot ids
assert.equal((await purgeMemoryTrash("/etc/hosts", home)).ok, false, "absolute trashId rejected");

console.log("memory-trash.test: ok");
