// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { collectSpaceUsage } from "./space-usage.ts";

// A fake coven home: memory files, a top-level state file, and a knowledge
// area containing a symlink pointing OUTSIDE the home (must not be followed).
const home = await mkdtemp(path.join(tmpdir(), "space-usage-"));
await mkdir(path.join(home, "memory", "kitty"), { recursive: true });
await writeFile(path.join(home, "memory", "kitty", "a.md"), "hello", "utf8"); // 5 B
await writeFile(path.join(home, "memory", "note.md"), "hi", "utf8"); // 2 B
await writeFile(path.join(home, "cave-board.json"), "{}", "utf8"); // 2 B top-level state

const outside = await mkdtemp(path.join(tmpdir(), "space-usage-outside-"));
await writeFile(path.join(outside, "big.bin"), "x".repeat(4096), "utf8");
await mkdir(path.join(home, "knowledge"), { recursive: true });
await symlink(outside, path.join(home, "knowledge", "link"));
await writeFile(path.join(home, "knowledge", "k.md"), "abc", "utf8"); // 3 B

const areas = await collectSpaceUsage(home);
const byId = new Map(areas.map((a) => [a.id, a]));

// Every allow-listed area reports, existing or not.
for (const id of ["conversations", "workspaces", "memory", "knowledge", "journal", "flows", "prompts", "skills", "trash", "state"]) {
  assert.ok(byId.has(id), `area ${id} is reported`);
}

const memory = byId.get("memory");
assert.equal(memory.exists, true, "memory area exists");
assert.equal(memory.files, 2, "memory counts nested files");
assert.equal(memory.bytes, 7, "memory sums nested file sizes");
assert.equal(typeof memory.lastModifiedMs, "number", "memory has a recency stamp");
assert.equal(memory.truncated, false, "small area is not truncated");
assert.equal(memory.relPath, "~/.coven/memory", "area shows a home-relative path");

const state = byId.get("state");
assert.equal(state.files, 1, "state counts only top-level files (no recursion into area dirs)");
assert.equal(state.bytes, 2, "state sums only top-level files");

const knowledge = byId.get("knowledge");
assert.equal(knowledge.files, 1, "symlinked dir is not followed");
assert.equal(knowledge.bytes, 3, "symlinked content is not counted");

const conversations = byId.get("conversations");
assert.equal(conversations.exists, false, "missing area reports exists=false");
assert.equal(conversations.bytes, 0, "missing area reports zero bytes");
assert.equal(conversations.lastModifiedMs, null, "missing area has no recency");

console.log("space-usage.test.ts: ok");
