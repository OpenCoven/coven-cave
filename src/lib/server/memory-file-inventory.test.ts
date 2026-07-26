import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// os.homedir() honours $HOME on POSIX — point the inventory at a tmp home
// BEFORE importing the module under test.
const home = await mkdtemp(path.join(tmpdir(), "meminv-"));
process.env.HOME = home;

const { listMemoryFileEntries, readExcerpt } = await import("./memory-file-inventory.ts");

const memDir = path.join(home, ".coven", "memory");
await mkdir(memDir, { recursive: true });
const noteFile = path.join(memDir, "note.md");
await writeFile(
  noteFile,
  "---\nsource_context: chat with kitty\n---\n\nFirst body line of the note.\n",
  "utf8",
);
await writeFile(path.join(memDir, "plain.md"), "Plain body, no frontmatter.", "utf8");
await utimes(noteFile, new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"));

// ── readExcerpt operates on a bounded head string ────────────────────────────
assert.equal(readExcerpt("---\nx: y\n---\nBody here."), "Body here.");
assert.equal(readExcerpt("   "), undefined);
assert.equal(readExcerpt(`Long ${"x".repeat(400)}`)?.length, 200, "excerpt capped at 200 chars");

// ── Scan finds files with excerpt + source context from the head read ───────
const first = await listMemoryFileEntries();
const note = first.find((e) => e.fullPath === noteFile);
assert.ok(note, "note.md is inventoried");
assert.equal(note.excerpt, "First body line of the note.");
assert.equal(note.sourceContext, "chat with kitty");
assert.equal(note.relPath, "note.md");
assert.ok(first.some((e) => e.excerpt === "Plain body, no frontmatter."), "plain file excerpted");

// ── Concurrent callers share one in-flight scan ──────────────────────────────
{
  const [a, b] = await Promise.all([listMemoryFileEntries(), listMemoryFileEntries()]);
  assert.equal(a, b, "concurrent scans coalesce to the same result");
}

// ── Unchanged files reuse cached entries; changed files rebuild ─────────────
{
  const second = await listMemoryFileEntries();
  const cachedNote = second.find((e) => e.fullPath === noteFile);
  assert.equal(cachedNote, note, "unchanged file reuses the cached entry object");

  await writeFile(noteFile, "---\nsource_context: retro\n---\n\nRewritten body.\n", "utf8");
  await utimes(noteFile, new Date("2026-01-03T00:00:00Z"), new Date("2026-01-03T00:00:00Z"));
  const third = await listMemoryFileEntries();
  const rebuilt = third.find((e) => e.fullPath === noteFile);
  assert.ok(rebuilt && rebuilt !== note, "mtime change invalidates the cache");
  assert.equal(rebuilt.excerpt, "Rewritten body.");
  assert.equal(rebuilt.sourceContext, "retro");
}

// ── Deleted files drop out (cache evicted) ───────────────────────────────────
{
  await rm(noteFile);
  const after = await listMemoryFileEntries();
  assert.ok(!after.some((e) => e.fullPath === noteFile), "deleted file leaves the inventory");
}

// ── Sorted newest-first ──────────────────────────────────────────────────────
{
  const entries = await listMemoryFileEntries();
  const sorted = [...entries].sort((a, b) => (a.modified < b.modified ? 1 : -1));
  assert.deepEqual(entries.map((e) => e.fullPath), sorted.map((e) => e.fullPath), "newest first");
}

console.log("memory-file-inventory.test: ok");
