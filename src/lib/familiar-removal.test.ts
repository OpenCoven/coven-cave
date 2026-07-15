// @ts-nocheck
import assert from "node:assert/strict";

const {
  removeFamiliarBlockFromToml,
  displayNameFromTomlBlock,
  hasNonemptyDescriptionFromTomlBlock,
  pruneTombstones,
  normalizeTombstones,
  TOMBSTONE_MAX_ENTRIES,
} = await import("./familiar-removal.ts");

const HEADER = "# User familiars for this Coven.\n";
const block = (id, name) =>
  `[[familiar]]\nid = "${id}"\ndisplay_name = "${name}"\nrole = "Familiar"\ndescription = "Helps with familiar work."\nharness = "codex"\nmodel = "gpt-5.2-codex"\n`;
const THREE = `${HEADER}\n${block("ada", "Ada")}\n${block("bel", "Bel")}\n${block("cyra", "Cyra")}`;

// Remove the middle block: neighbors and the header survive byte-for-byte order.
{
  const { toml, removed } = removeFamiliarBlockFromToml(THREE, "bel");
  assert.match(removed, /^\[\[familiar\]\]/);
  assert.match(removed, /id = "bel"/);
  assert.match(removed, /display_name = "Bel"/);
  assert.doesNotMatch(toml, /"bel"/);
  assert.match(toml, /id = "ada"/);
  assert.match(toml, /id = "cyra"/);
  assert.ok(toml.startsWith(HEADER), "header comment survives");
  assert.ok(toml.endsWith("\n"), "document keeps its trailing newline");
  assert.doesNotMatch(toml, /\n{3,}/, "no widening gap at the seam");
}

// Remove the first and last blocks.
{
  const first = removeFamiliarBlockFromToml(THREE, "ada");
  assert.match(first.removed, /id = "ada"/);
  assert.doesNotMatch(first.toml, /"ada"/);
  assert.match(first.toml, /id = "bel"/);

  const last = removeFamiliarBlockFromToml(THREE, "cyra");
  assert.match(last.removed, /id = "cyra"/);
  assert.doesNotMatch(last.toml, /"cyra"/);
  assert.match(last.toml, /id = "bel"/);
  assert.ok(last.toml.endsWith("\n"));
}

// Removing the sole familiar leaves the header, no dangling block.
{
  const { toml, removed } = removeFamiliarBlockFromToml(`${HEADER}\n${block("ada", "Ada")}`, "ada");
  assert.match(removed, /id = "ada"/);
  assert.doesNotMatch(toml, /\[\[familiar\]\]/);
  assert.ok(toml.startsWith("# User familiars"), "header survives a full clear-out");
}

// Unknown id: untouched document, null removal.
{
  const { toml, removed } = removeFamiliarBlockFromToml(THREE, "nobody");
  assert.equal(removed, null);
  assert.equal(toml, THREE);
}

// An unrelated `[table]` after the target block must survive the cut — the
// block ends at the NEXT header of any kind, not just `[[familiar]]`.
{
  const doc = `${HEADER}\n[[familiar]]\nid = "ada"\n\n[other.section]\nkey = "v"\n`;
  const { toml, removed } = removeFamiliarBlockFromToml(doc, "ada");
  assert.match(removed, /id = "ada"/);
  assert.doesNotMatch(removed, /other\.section/);
  assert.match(toml, /\[other\.section\]/);
  assert.match(toml, /key = "v"/);
}

// Round-trip: re-appending the removed block registers the id again (the
// restore route's append path).
{
  const cut = removeFamiliarBlockFromToml(THREE, "bel");
  const restored = `${cut.toml}\n${cut.removed}\n`;
  const again = removeFamiliarBlockFromToml(restored, "bel");
  assert.match(again.removed, /display_name = "Bel"/, "restored block is removable again");
  assert.match(again.toml, /id = "ada"/);
  assert.match(again.toml, /id = "cyra"/);
}

// Display-name extraction, including escaped quotes; absent → null.
{
  assert.equal(displayNameFromTomlBlock(block("ada", "Ada")), "Ada");
  assert.equal(
    displayNameFromTomlBlock('[[familiar]]\nid = "x"\ndisplay_name = "The \\"Best\\""\n'),
    'The "Best"',
  );
  assert.equal(displayNameFromTomlBlock('[[familiar]]\nid = "x"\n'), null);
}

// Restores must never reintroduce a registry record that the daemon cannot
// parse because its required description is missing or blank.
{
  assert.equal(hasNonemptyDescriptionFromTomlBlock(block("ada", "Ada")), true);
  assert.equal(
    hasNonemptyDescriptionFromTomlBlock('[[familiar]]\nid = "x"\ndescription = "   "\n'),
    false,
  );
  assert.equal(
    hasNonemptyDescriptionFromTomlBlock('[[familiar]]\nid = "x"\ndescription = "\\n"\n'),
    false,
  );
  assert.equal(
    hasNonemptyDescriptionFromTomlBlock('[[familiar]]\nid = "x"\ndescription = "\\u0020"\n'),
    false,
  );
  assert.equal(hasNonemptyDescriptionFromTomlBlock('[[familiar]]\nid = "x"\n'), false);
  assert.equal(
    hasNonemptyDescriptionFromTomlBlock("[[familiar]]\nid = 'x'\ndescription = 'Restores safely.'\n"),
    true,
  );
}

// Tombstone pruning: age out past the window, cap the list, newest first.
{
  const now = Date.parse("2026-07-09T12:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  const entry = (id, daysAgo) => ({
    id,
    displayName: id,
    removedAt: new Date(now - daysAgo * day).toISOString(),
    tomlBlock: null,
    binding: null,
  });

  const pruned = pruneTombstones([entry("old", 31), entry("young", 1), entry("mid", 10)], now);
  assert.deepEqual(pruned.map((e) => e.id), ["young", "mid"], "31-day-old entry ages out, newest first");

  const many = Array.from({ length: TOMBSTONE_MAX_ENTRIES + 5 }, (_, i) => entry(`f${i}`, i / 100));
  assert.equal(pruneTombstones(many, now).length, TOMBSTONE_MAX_ENTRIES, "list caps at the max");

  const bad = pruneTombstones([{ ...entry("x", 1), removedAt: "not-a-date" }], now);
  assert.equal(bad.length, 0, "unparseable timestamps drop");
}

// Store-file normalization tolerates junk shapes and defaults displayName.
{
  const parsed = normalizeTombstones({
    entries: [
      { id: "ada", removedAt: "2026-07-09T00:00:00.000Z", tomlBlock: 42, binding: [] },
      { id: "", removedAt: "2026-07-09T00:00:00.000Z" },
      { removedAt: "2026-07-09T00:00:00.000Z" },
      "garbage",
      { id: "bel", removedAt: "2026-07-09T00:00:00.000Z", displayName: "Bel", binding: { harness: "openclaw" } },
    ],
  });
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].displayName, "ada", "displayName defaults to the id");
  assert.equal(parsed[0].tomlBlock, null, "non-string block coerces to null");
  assert.equal(parsed[0].binding, null, "array binding coerces to null");
  assert.deepEqual(parsed[1].binding, { harness: "openclaw" });
  assert.deepEqual(normalizeTombstones(null), []);
  assert.deepEqual(normalizeTombstones({ entries: "nope" }), []);
}

console.log("familiar-removal.test.ts OK");
