import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const tmp = await mkdtemp(path.join(tmpdir(), "cave-research-links-"));
const originalOverride = process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE;
process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE = path.join(tmp, "research-links.json");

const {
  listSavedLinks,
  MAX_LINKS_PER_SAVE,
  removeSavedLink,
  saveResearchLinks,
} = await import("./research-links.ts");

after(async () => {
  if (originalOverride === undefined) delete process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE;
  else process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE = originalOverride;
  await rm(tmp, { recursive: true, force: true });
});

test("saving organizes, dedupes, and persists newest-first", async () => {
  const first = await saveResearchLinks(
    ["https://github.com/OpenCoven/coven-cave", "https://arxiv.org/abs/2404.12345"],
    "chat",
  );
  assert.equal(first.added.length, 2);
  assert.equal(first.added[0].category, "github");
  assert.equal(first.added[0].title, "OpenCoven/coven-cave");
  assert.equal(first.added[1].category, "paper");
  assert.equal(first.added[0].source, "chat");

  // Same page in a different spelling → duplicate, not a second row.
  const second = await saveResearchLinks(
    ["https://GITHUB.com/OpenCoven/coven-cave/", "https://example.com/blog/why-we-ship"],
    "desk",
  );
  assert.equal(second.added.length, 1);
  assert.deepEqual(second.duplicates, ["https://GITHUB.com/OpenCoven/coven-cave/"]);
  assert.equal(second.added[0].source, "desk");

  const listed = await listSavedLinks();
  assert.equal(listed.length, 3);

  // The store survives a fresh read from disk (persisted JSON, not memory).
  const onDisk = JSON.parse(
    await readFile(process.env.CAVE_RESEARCH_LINKS_PATH_OVERRIDE!, "utf8"),
  ) as { version: number; links: unknown[] };
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.links.length, 3);
});

test("invalid inputs are reported, never stored", async () => {
  const result = await saveResearchLinks(
    ["ftp://example.com/file", "not a url", "   ", "javascript:alert(1)"],
    "chat",
  );
  assert.equal(result.added.length, 0);
  assert.deepEqual(result.invalid, ["ftp://example.com/file", "not a url", "javascript:alert(1)"]);
});

test("removal is by id and reports misses", async () => {
  const { added } = await saveResearchLinks(["https://example.com/remove-me"], "desk");
  assert.equal(added.length, 1);
  assert.equal(await removeSavedLink(added[0].id), true);
  assert.equal(await removeSavedLink(added[0].id), false, "second removal is a miss");
  const listed = await listSavedLinks();
  assert.ok(!listed.some((link) => link.id === added[0].id));
});

test("one save is bounded to MAX_LINKS_PER_SAVE", async () => {
  const urls = Array.from({ length: MAX_LINKS_PER_SAVE + 10 }, (_, i) => `https://bulk.example.com/item-${i}`);
  const result = await saveResearchLinks(urls, "desk");
  assert.equal(result.added.length, MAX_LINKS_PER_SAVE);
});
