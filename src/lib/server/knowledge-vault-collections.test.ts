// @ts-nocheck
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildPromptWithKnowledgeVault,
  deleteKnowledgeEntry,
  isValidCollectionId,
  listCollections,
  listKnowledgeEntries,
  readCollectionMeta,
  readKnowledgeEntry,
  writeCollectionMeta,
  writeKnowledgeEntry,
} from "./knowledge-vault.ts";

const scratchRoot = path.join(process.cwd(), ".test-artifacts", "knowledge-vault-collections");
await rm(scratchRoot, { recursive: true, force: true });
await mkdir(scratchRoot, { recursive: true });
const prev = process.env.COVEN_KNOWLEDGE_DIR;
process.env.COVEN_KNOWLEDGE_DIR = scratchRoot;

try {
  assert.equal(isValidCollectionId("characters"), true);
  for (const bad of ["../x", "a/b", ".", ""]) {
    assert.equal(isValidCollectionId(bad), false, `${bad} is rejected as a collection id`);
    await assert.rejects(
      () => writeKnowledgeEntry({ id: "entry", collection: bad, title: "Entry", tags: [], scope: "global", enabled: true, body: "x" }),
      /invalid knowledge collection/,
    );
  }
  await assert.rejects(
    () => writeKnowledgeEntry({ id: "../x", collection: "characters", title: "Bad", tags: [], scope: "global", enabled: true, body: "x" }),
    /invalid knowledge id/,
  );

  await writeKnowledgeEntry({ id: "root-note", title: "Root", tags: [], scope: "global", enabled: true, body: "root body" });
  await writeKnowledgeEntry({
    id: "schema",
    collection: "characters",
    title: "Schema",
    tags: [],
    scope: "global",
    enabled: true,
    extra: { type: "character", status: "draft", flags: ["featured"], title: "ignored" },
    body: "schema body",
  });
  assert.deepEqual((await readKnowledgeEntry("schema", "characters"))?.extra, {
    type: "character",
    status: "draft",
    flags: ["featured"],
  }, "reserved keys in extra are stripped before persistence");
  await writeKnowledgeEntry({ id: "hero", collection: "characters", title: "Hero", tags: ["world"], scope: "global", enabled: true, body: "hero body" });
  await writeKnowledgeEntry({ id: "seed", collection: "characters", title: "Seed", tags: [], scope: "global", enabled: false, body: "seed body" });
  await writeFile(path.join(scratchRoot, "characters", "collection.yml"), "name: Characters\nsummary: characters index\n", "utf8");
  await writeFile(path.join(scratchRoot, "characters", "ignored.txt"), "nope", "utf8");
  await mkdir(path.join(scratchRoot, "bad.dir"), { recursive: true });
  await writeFile(path.join(scratchRoot, "bad.dir", "x.md"), "bad", "utf8");

  const all = await listKnowledgeEntries();
  assert.deepEqual(
    all.map((entry) => entry.collection ? `${entry.collection}/${entry.id}` : entry.id).sort(),
    ["characters/hero", "characters/schema", "characters/seed", "root-note"],
    "list mixes root entries and one-level collection entries",
  );
  assert.deepEqual(
    (await listKnowledgeEntries("characters")).map((entry) => `${entry.collection}/${entry.id}`).sort(),
    ["characters/hero", "characters/schema", "characters/seed"],
    "collection filter returns only that collection",
  );
  assert.equal((await readKnowledgeEntry("hero", "characters"))?.collection, "characters");
  assert.equal(await deleteKnowledgeEntry("hero", "characters"), true);
  assert.equal(await readKnowledgeEntry("hero", "characters"), null);

  await writeCollectionMeta("characters", {
    name: "Characters",
    description: "People in the story",
    entityType: "character",
    storyQuestion: "Who matters?",
    fields: [{ key: "role", label: "Role" }],
    pack: { id: "worldbuilding", version: "1.0.0" },
    summary: "Characters — People in the story",
  });
  assert.deepEqual(await readCollectionMeta("characters"), {
    name: "Characters",
    description: "People in the story",
    entityType: "character",
    storyQuestion: "Who matters?",
    fields: [{ key: "role", label: "Role" }],
    pack: { id: "worldbuilding", version: "1.0.0" },
    summary: "Characters — People in the story",
  });
  const collections = await listCollections();
  assert.deepEqual(collections, [{ id: "characters", meta: await readCollectionMeta("characters"), count: 2 }]);

  const prompt = buildPromptWithKnowledgeVault("User prompt", await listKnowledgeEntries(), collections);
  assert.match(prompt, /Collections index/);
  assert.match(prompt, /- characters: Characters — People in the story/);

  const messyPrompt = buildPromptWithKnowledgeVault("User prompt", [], [
    {
      id: "places",
      meta: { name: "Places", summary: "  Multi-line\n\n   summary\ttext  " },
      count: 1,
    },
  ]);
  assert.match(
    messyPrompt,
    /- places: Multi-line summary text/,
    "multi-line/whitespace-heavy summaries collapse to one line in the index",
  );
  assert.match(prompt, /root body/);
  assert.doesNotMatch(prompt, /seed body/, "disabled seeded entries stay out of the prompt block");

  // collection.yml is hand-editable: non-string optional fields must degrade
  // to "absent" at the readCollectionMeta chokepoint instead of crashing the
  // prompt builder (`summary: 2026` parses as a YAML number) on every send.
  await mkdir(path.join(scratchRoot, "typo"), { recursive: true });
  await writeFile(
    path.join(scratchRoot, "typo", "collection.yml"),
    "name: Typo\nsummary: 2026\nstoryQuestion: true\ndescription: [not, a, string]\nfields: nope\npack: broken\n",
    "utf8",
  );
  const typoMeta = await readCollectionMeta("typo");
  assert.deepEqual(typoMeta, { name: "Typo" }, "non-string optional meta fields are dropped, not passed through");
  assert.doesNotThrow(
    () =>
      buildPromptWithKnowledgeVault("User prompt", [], [
        { id: "typo", meta: { name: "C", summary: 2026 }, count: 0 },
      ]),
    "the pure prompt builder tolerates raw unsanitized metas from direct callers",
  );

  // Multi-line extra values keep their blank lines through a full
  // serialize→parse round-trip (paragraph breaks were being stripped).
  await writeKnowledgeEntry({
    id: "notes",
    collection: "characters",
    title: "Notes",
    tags: [],
    scope: "global",
    enabled: true,
    body: "body",
    extra: { notes: "para one\n\npara two" },
  });
  assert.deepEqual(
    (await readKnowledgeEntry("notes", "characters"))?.extra,
    { notes: "para one\n\npara two" },
    "blank lines inside multi-line extra values survive the round-trip",
  );
} finally {
  if (prev === undefined) delete process.env.COVEN_KNOWLEDGE_DIR;
  else process.env.COVEN_KNOWLEDGE_DIR = prev;
  await rm(scratchRoot, { recursive: true, force: true });
}

console.log("knowledge-vault-collections.test.ts: ok");
