// @ts-nocheck
import assert from "node:assert/strict";
const {
  buildStubPayload,
  groupKnowledgeByCollection,
  knowledgeEntryToRaw,
  rawToKnowledgePayload,
} = await import("./grimoire-helpers.ts");

const raw = knowledgeEntryToRaw({
  id: "mara",
  collection: "characters",
  title: "Mara",
  tags: ["pc"],
  scope: ["ivy"],
  enabled: false,
  extra: { type: "character", status: "missing", flags: ["age conflict"], enabled: "extra-shadow" },
  body: "Bio",
});
assert.match(raw, /type: character/, "extra frontmatter is preserved into raw markdown");
assert.match(raw, /status: missing/, "arbitrary extra keys round-trip to frontmatter");
assert.match(raw, /enabled: false/, "reserved enabled value remains authoritative");
const payload = rawToKnowledgePayload("mara", raw, "characters");
assert.deepEqual(
  payload,
  {
    id: "mara",
    collection: "characters",
    title: "Mara",
    tags: ["pc"],
    scope: "ivy",
    enabled: false,
    body: "Bio",
    extra: { type: "character", status: "missing", flags: ["age conflict"] },
  },
  "raw knowledge payload keeps collection and non-reserved extra keys",
);

// Deleting the last extra key in the raw editor must clear stored extras: an
// explicit `extra: {}` tells the route "extra-aware client, nothing left",
// while an omitted field would resurrect the stored keys.
assert.deepEqual(
  rawToKnowledgePayload("mara", '---\ntitle: "Mara"\nscope: "global"\nenabled: true\n---\n\nBio\n').extra,
  {},
  "payload always carries extra so clearing the last key sticks",
);

assert.deepEqual(
  buildStubPayload("Lost Queen", {
    id: "characters",
    meta: { name: "Characters", entityType: "character", fields: [{ key: "status", label: "Status" }] },
    count: 3,
  }, "Chapter 2"),
  {
    title: "Lost Queen",
    collection: "characters",
    enabled: false,
    tags: [],
    body: "Stubbed from [[Chapter 2]].",
    extra: { type: "character", status: "" },
  },
  "collection stub payload carries entity type and schema fields",
);
assert.deepEqual(
  buildStubPayload("Loose Note", null, "Daily Note"),
  { title: "Loose Note", enabled: false, tags: [], body: "Stubbed from [[Daily Note]]." },
  "root stub payload omits collection and extra",
);

const groups = groupKnowledgeByCollection(
  [
    { id: "root", title: "Root", tags: [], enabled: true, scope: "global", body: "" },
    { id: "mara", collection: "characters", title: "Mara", tags: [], enabled: true, scope: "global", body: "" },
    { id: "keep", collection: "characters", title: "Keep", tags: [], enabled: true, scope: "global", body: "" },
    { id: "spire", collection: "settings", title: "Spire", tags: [], enabled: true, scope: "global", body: "" },
  ],
  [
    { id: "characters", meta: { name: "Characters", storyQuestion: "Who matters?" }, count: 2 },
    { id: "settings", meta: null, count: 1 },
  ],
);
assert.equal(groups.root.length, 1, "root entries stay flat");
assert.deepEqual(
  groups.collections.map((g) => [g.id, g.label, g.storyQuestion, g.entries.length]),
  [
    ["characters", "Characters", "Who matters?", 2],
    ["settings", "settings", undefined, 1],
  ],
  "collection entries group with metadata labels and slug fallback",
);

console.log("grimoire-stub-links.test.ts: ok");
