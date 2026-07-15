import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { containsRedactionMarker, writeAllowedMemoryFile } from "./memory-file-write.ts";

const home = await mkdtemp(path.join(tmpdir(), "memwrite-"));
const memDir = path.join(home, ".coven", "memory");
await mkdir(memDir, { recursive: true });
const file = path.join(memDir, "note.md");
await writeFile(file, "original", "utf8");

// Happy path: no mtime guard.
{
  const res = await writeAllowedMemoryFile(file, "updated", null, home);
  assert.equal(res.ok, true, "write ok");
  assert.equal(await readFile(file, "utf8"), "updated");
  assert.ok((res as { mtimeMs: number }).mtimeMs > 0, "returns new mtime");
}

// mtime guard: matching mtime saves; stale mtime → 409 with current text.
{
  const current = await stat(file);
  const ok = await writeAllowedMemoryFile(file, "guarded save", current.mtimeMs, home);
  assert.equal(ok.ok, true, "matching mtime saves");
  const stale = await writeAllowedMemoryFile(file, "lost update", current.mtimeMs - 5000, home);
  assert.equal(stale.ok, false, "stale mtime rejected");
  assert.equal((stale as { status: number }).status, 409);
  assert.equal((stale as { currentText?: string }).currentText, "guarded save", "conflict carries current text");
  assert.equal(await readFile(file, "utf8"), "guarded save", "file untouched on conflict");
}

// Redaction marker refused (protects real secrets from redacted-view saves).
{
  assert.equal(containsRedactionMarker("token: [REDACTED:openai]"), true);
  assert.equal(containsRedactionMarker("plain text"), false);
  const res = await writeAllowedMemoryFile(file, "key = [REDACTED:github_pat]", null, home);
  assert.equal(res.ok, false, "redacted content refused");
  assert.equal((res as { status: number }).status, 422);
}

// Allowlist: outside memory roots rejected; missing files rejected (edit-in-place only).
{
  const outside = path.join(home, "free.md");
  await writeFile(outside, "x", "utf8");
  const res = await writeAllowedMemoryFile(outside, "y", null, home);
  assert.equal(res.ok, false, "outside root rejected");
  assert.equal((res as { status: number }).status, 403);
  const missing = await writeAllowedMemoryFile(path.join(memDir, "new-file.md"), "y", null, home);
  assert.equal(missing.ok, false, "nonexistent file rejected");
  // Traversal attempt.
  const evil = await writeAllowedMemoryFile(path.join(memDir, "..", "..", "escape.md"), "y", null, home);
  assert.equal(evil.ok, false, "traversal rejected");
}

// Size cap.
{
  const res = await writeAllowedMemoryFile(file, "x".repeat(2 * 1024 * 1024 + 1), null, home);
  assert.equal(res.ok, false, "oversized rejected");
  assert.equal((res as { status: number }).status, 413);
}

console.log("memory-file-write.test: ok");
