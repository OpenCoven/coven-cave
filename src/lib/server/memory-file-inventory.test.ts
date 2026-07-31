import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const home = await mkdtemp(path.join(tmpdir(), "meminv-"));
const otherHome = await mkdtemp(path.join(tmpdir(), "meminv-other-"));
const previousHome = process.env.HOME;
// Keep the pre-change implementation safely confined to the temporary home
// during the RED run. The production API below must still honor its explicit
// `home` argument rather than consulting this process-global fallback.
process.env.HOME = home;

const { listMemoryFileEntries, readExcerpt } = await import("./memory-file-inventory.ts");

const canonicalFile = path.join(home, ".coven", "memory", "sage", "canonical.md");
const covenWorkspaceFile = path.join(
  home,
  ".coven",
  "workspaces",
  "familiars",
  "sage",
  "memory",
  "workspace.md",
);
const openclawRuntimeFile = path.join(home, ".openclaw", "workspace", "memory", "runtime.md");
const openclawFamiliarFile = path.join(
  home,
  ".openclaw",
  "workspace",
  "sage",
  "memory",
  "familiar.md",
);
const openclawIndexFile = path.join(home, ".openclaw", "workspace", "MEMORY.md");
const codexRuntimeFile = path.join(home, ".codex", "memories", "runtime.md");
const otherHomeFile = path.join(otherHome, ".codex", "memories", "other-runtime.md");
const nestedHome = path.join(home, "nested-home");
const nestedHomeFile = path.join(nestedHome, ".codex", "memories", "nested-runtime.md");

try {
  for (const file of [
    canonicalFile,
    covenWorkspaceFile,
    openclawRuntimeFile,
    openclawFamiliarFile,
    openclawIndexFile,
    codexRuntimeFile,
    otherHomeFile,
    nestedHomeFile,
  ]) {
    await mkdir(path.dirname(file), { recursive: true });
  }
  await writeFile(canonicalFile, "canonical body", "utf8");
  await writeFile(
    covenWorkspaceFile,
    "---\nsource_context: chat with sage\n---\n\nFirst body line of the note.\n",
    "utf8",
  );
  await writeFile(openclawRuntimeFile, "OpenClaw runtime body.", "utf8");
  await writeFile(openclawFamiliarFile, "OpenClaw familiar body.", "utf8");
  await writeFile(openclawIndexFile, "# OpenClaw index", "utf8");
  await writeFile(codexRuntimeFile, "Codex runtime body.", "utf8");
  await writeFile(otherHomeFile, "Other home runtime body.", "utf8");
  await writeFile(nestedHomeFile, "Nested home runtime body.", "utf8");
  await utimes(
    covenWorkspaceFile,
    new Date("2026-01-02T00:00:00Z"),
    new Date("2026-01-02T00:00:00Z"),
  );

  // ── readExcerpt operates on a bounded head string ──────────────────────────
  assert.equal(readExcerpt("---\nx: y\n---\nBody here."), "Body here.");
  assert.equal(
    readExcerpt(
      "---\nsource_context: chat with sage\n---\n\n<!-- research-provenance\nmission: research-1\n-->\n# Findings\n\nReadable body.",
    ),
    "# Findings\n\nReadable body.",
  );
  assert.equal(
    readExcerpt(
      "---\nsource_context: chat with sage\n---\n\n<!-- research-provenance\nmission: research-1",
    ),
    undefined,
  );
  assert.equal(readExcerpt("   "), undefined);
  assert.equal(readExcerpt(`Long ${"x".repeat(400)}`)?.length, 200, "excerpt capped at 200 chars");

  // ── Scan excludes canonical memory and retains every runtime/workspace root ─
  const first = await listMemoryFileEntries(home);
  assert.ok(
    !first.some((entry) => entry.fullPath === canonicalFile),
    "canonical Coven memory is absent from the mutable file inventory",
  );
  const note = first.find((entry) => entry.fullPath === covenWorkspaceFile);
  assert.ok(note, "Coven familiar workspace memory is inventoried");
  assert.equal(note.excerpt, "First body line of the note.");
  assert.equal(note.sourceContext, "chat with sage");
  assert.equal(note.relPath, "workspace.md");
  assert.equal(note.sourceKindLabel, "Coven workspace files");
  assert.equal(note.rootLabel, "Coven workspace files");
  for (const retainedPath of [
    openclawRuntimeFile,
    openclawFamiliarFile,
    openclawIndexFile,
    codexRuntimeFile,
  ]) {
    assert.ok(
      first.some((entry) => entry.fullPath === retainedPath),
      `${retainedPath} remains in the inventory`,
    );
  }

  // ── Concurrent callers share scans only within the same home ───────────────
  {
    const [a, b] = await Promise.all([
      listMemoryFileEntries(home),
      listMemoryFileEntries(home),
    ]);
    assert.equal(a, b, "concurrent scans for one home coalesce to the same result");
  }
  {
    const [localEntries, otherEntries] = await Promise.all([
      listMemoryFileEntries(home),
      listMemoryFileEntries(otherHome),
    ]);
    assert.notEqual(
      localEntries,
      otherEntries,
      "concurrent scans for different homes must not share an in-flight result",
    );
    assert.ok(localEntries.some((entry) => entry.fullPath === covenWorkspaceFile));
    assert.ok(!localEntries.some((entry) => entry.fullPath === otherHomeFile));
    assert.ok(otherEntries.some((entry) => entry.fullPath === otherHomeFile));
    assert.ok(!otherEntries.some((entry) => entry.fullPath === covenWorkspaceFile));
  }
  {
    const warmedInnerEntries = await listMemoryFileEntries(nestedHome);
    const warmedInnerEntry = warmedInnerEntries.find(
      (entry) => entry.fullPath === nestedHomeFile,
    );
    assert.ok(warmedInnerEntry, "nested explicit home entry is inventoried");

    await listMemoryFileEntries(home);

    const rescannedInnerEntries = await listMemoryFileEntries(nestedHome);
    assert.equal(
      rescannedInnerEntries.find((entry) => entry.fullPath === nestedHomeFile),
      warmedInnerEntry,
      "scanning an outer explicit home must not evict a nested home's unchanged cache entry",
    );
  }

  // ── Unchanged files reuse cached entries; changed files rebuild ────────────
  {
    const second = await listMemoryFileEntries(home);
    const cachedNote = second.find((entry) => entry.fullPath === covenWorkspaceFile);
    assert.equal(cachedNote, note, "unchanged file reuses the cached entry object");

    await writeFile(
      covenWorkspaceFile,
      "---\nsource_context: retro\n---\n\nRewritten body.\n",
      "utf8",
    );
    await utimes(
      covenWorkspaceFile,
      new Date("2026-01-03T00:00:00Z"),
      new Date("2026-01-03T00:00:00Z"),
    );
    const third = await listMemoryFileEntries(home);
    const rebuilt = third.find((entry) => entry.fullPath === covenWorkspaceFile);
    assert.ok(rebuilt && rebuilt !== note, "mtime change invalidates the cache");
    assert.equal(rebuilt.excerpt, "Rewritten body.");
    assert.equal(rebuilt.sourceContext, "retro");
  }

  // ── Deleted files drop out (cache evicted) ─────────────────────────────────
  {
    await rm(covenWorkspaceFile);
    const after = await listMemoryFileEntries(home);
    assert.ok(
      !after.some((entry) => entry.fullPath === covenWorkspaceFile),
      "deleted file leaves the inventory",
    );
  }

  // ── Sorted newest-first ────────────────────────────────────────────────────
  {
    const entries = await listMemoryFileEntries(home);
    for (let index = 1; index < entries.length; index += 1) {
      assert.ok(
        entries[index - 1].modified >= entries[index].modified,
        "inventory is sorted newest first",
      );
    }
  }
} finally {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  await rm(home, { recursive: true, force: true });
  await rm(otherHome, { recursive: true, force: true });
}

console.log("memory-file-inventory.test: ok");
