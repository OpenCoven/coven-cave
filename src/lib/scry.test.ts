// @ts-nocheck
//
// The scry contract: what a harness reply may and may not turn into.
//
// Every assertion here is about a value a person would see in the rite, or a
// value the rite refuses to show them. Nothing checks that the parser is
// *spelled* a particular way.

import assert from "node:assert/strict";
import {
  buildScryInstruction,
  composeScryDescription,
  isScryCapableHarness,
  isScryLikenessMime,
  parseScryReading,
  SCRY_CAPABLE_HARNESS_IDS,
  SCRY_FIELD_LIMITS,
} from "./scry.ts";

const CHOICES = {
  glyphChoices: ["ph:cat-fill", "ph:ghost-fill", "ph:rocket-fill"],
  auraChoices: ["Theme", "Lilac", "Ember"],
};

// ---------------------------------------------------------------------------
// Pronouns are never inferred from an image.
// ---------------------------------------------------------------------------

{
  const reading = parseScryReading(
    JSON.stringify({
      name: "Wren",
      description: "A grey cat in a librarian's collar.",
      pronouns: "she/her",
      gender: "female",
    }),
    CHOICES,
  );
  assert.ok(reading, "a reply carrying a name and description is readable");
  assert.equal(
    reading.pronouns,
    "they/them",
    "a model that volunteers pronouns must not get them into the rite",
  );
  assert.equal(
    reading.pronounsInferred,
    false,
    "the reading must state that pronouns were not inferred, so the rite can flag the field",
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(reading, "gender"),
    false,
    "no field the contract does not name survives into a reading",
  );
}

// ---------------------------------------------------------------------------
// A reading can only land on choices the rite already offers.
// ---------------------------------------------------------------------------

{
  const reading = parseScryReading(
    JSON.stringify({
      name: "Onyx",
      description: "A crow.",
      glyph: "ph:skull-and-crossbones",
      aura: "Neon Chartreuse",
    }),
    CHOICES,
  );
  assert.equal(
    reading.glyph,
    null,
    "a sigil the rite does not offer is dropped rather than shown as a choice",
  );
  assert.equal(
    reading.auraLabel,
    null,
    "an aura outside the offered set is dropped — the card can never take a colour from outside the token system",
  );
}

{
  const reading = parseScryReading(
    JSON.stringify({ name: "Onyx", description: "A crow.", glyph: "PH:GHOST-FILL", aura: " ember " }),
    CHOICES,
  );
  assert.equal(reading.glyph, "ph:ghost-fill", "an offered sigil is matched case-insensitively");
  assert.equal(reading.auraLabel, "Ember", "an offered aura is matched after trimming, and comes back canonically cased");
}

// ---------------------------------------------------------------------------
// The reply is extracted from whatever the harness actually printed.
// ---------------------------------------------------------------------------

{
  const noisy = [
    "codex v1.2.3",
    "Reading /home/val/.coven/cave/scry/abc.png ...",
    "Here you go:",
    '```json',
    '{"name":"Basil","office":"Archivist","description":"A tabby in spectacles."}',
    '```',
    "Done in 4.2s",
  ].join("\n");
  const reading = parseScryReading(noisy, CHOICES);
  assert.equal(reading.name, "Basil", "a JSON object surrounded by banners and a code fence is still found");
  assert.equal(reading.office, "Archivist");
}

{
  // A harness that echoes the instruction (which contains a JSON *shape*) and
  // then answers must not have its echo mistaken for the answer.
  const echoed = [
    'Instruction was: { "name": "a short given name", "office": "the role it holds, 1-3 words" }',
    'Answer: {"name":"Vesper","description":"A moth."}',
  ].join("\n");
  const reading = parseScryReading(echoed, CHOICES);
  assert.equal(
    reading.name,
    "Vesper",
    "the LAST complete object wins, so an echoed instruction template does not become the reading",
  );
}

{
  const nested = '{"name":"Pip","description":"A finch.","manner":{"unused":1}}';
  const reading = parseScryReading(nested, CHOICES);
  assert.equal(reading.name, "Pip", "a nested object does not truncate the outer one");
}

// ---------------------------------------------------------------------------
// Nothing usable means nothing is offered.
// ---------------------------------------------------------------------------

assert.equal(parseScryReading("", CHOICES), null, "empty output is not a reading");
assert.equal(parseScryReading("I could not open that file.", CHOICES), null, "prose with no object is not a reading");
assert.equal(parseScryReading("{not json}", CHOICES), null, "an unparseable brace span is not a reading");
assert.equal(
  parseScryReading('["Wren", {"nested": 1}]', CHOICES),
  null,
  "a JSON array is not a reading — and the object inside one carries none of the contract's fields, so it is not one either",
);
assert.equal(
  parseScryReading(JSON.stringify({ office: "Archivist", aura: "Ember" }), CHOICES),
  null,
  "a reply with neither a name nor a description leaves the rite where it started, so it is reported as a failed scry",
);

// ---------------------------------------------------------------------------
// Field hygiene: a reply cannot paste layout or an unbounded string into an input.
// ---------------------------------------------------------------------------

{
  const reading = parseScryReading(
    JSON.stringify({
      name: "  Wren\nthe\tQuiet  ",
      description: "x".repeat(SCRY_FIELD_LIMITS.description + 200),
      voice: "  ",
      temperament: 42,
    }),
    CHOICES,
  );
  assert.equal(reading.name, "Wren the Quiet", "newlines and tabs collapse to single spaces and the value is trimmed");
  assert.equal(
    reading.description.length,
    SCRY_FIELD_LIMITS.description,
    "an overlong description is clamped to the field limit rather than filling the textarea",
  );
  assert.equal(reading.manner.voice, null, "a whitespace-only value is absent, not an empty suggestion");
  assert.equal(reading.manner.temperament, null, "a non-string value is absent rather than stringified");
}

// ---------------------------------------------------------------------------
// The description a familiar is created with keeps the manner.
// ---------------------------------------------------------------------------

{
  const reading = parseScryReading(
    JSON.stringify({
      name: "Wren",
      purpose: "Keeps the archive in order",
      description: "A grey cat in a librarian's collar.",
      voice: "Dry and brief.",
      temperament: "Unhurried.",
      reasoning: "Works from the index outward.",
    }),
    CHOICES,
  );
  const composed = composeScryDescription(reading);
  assert.ok(
    composed.startsWith("Keeps the archive in order."),
    "the purpose leads, and gains the sentence-ending punctuation it lacked",
  );
  for (const part of ["Dry and brief.", "Unhurried.", "Works from the index outward."]) {
    assert.ok(
      composed.includes(part),
      `the manner survives into the description the familiar is created with: ${part}`,
    );
  }
  assert.equal(
    composed.includes("A grey cat in a librarian's collar."),
    false,
    "the description of the ARTWORK stays with the card and does not become the familiar's job",
  );
}

{
  const noPurpose = parseScryReading(
    JSON.stringify({ name: "Wren", description: "A grey cat." }),
    CHOICES,
  );
  assert.equal(
    composeScryDescription(noPurpose),
    "A grey cat.",
    "with no purpose the description carries the familiar, rather than leaving it with nothing",
  );
}

// ---------------------------------------------------------------------------
// The instruction the harness receives.
// ---------------------------------------------------------------------------

{
  const instruction = buildScryInstruction({
    imagePath: "/home/val/.coven/cave/scry/abc.png",
    glyphChoices: CHOICES.glyphChoices,
    auraChoices: CHOICES.auraChoices,
  });
  assert.ok(
    instruction.includes("/home/val/.coven/cave/scry/abc.png"),
    "the harness is told exactly which file to open",
  );
  assert.ok(
    /never identify, name, or/i.test(instruction),
    "the harness is told not to identify a real person",
  );
  assert.ok(
    /pronouns/i.test(instruction),
    "the harness is told not to state or imply pronouns",
  );
  for (const glyph of CHOICES.glyphChoices) {
    assert.ok(instruction.includes(glyph), `the offered sigils are named: ${glyph}`);
  }
}

// ---------------------------------------------------------------------------
// The runtime allowlist.
// ---------------------------------------------------------------------------

assert.ok(SCRY_CAPABLE_HARNESS_IDS.length > 0, "some runtime can scry, or the rite is unreachable");
for (const id of SCRY_CAPABLE_HARNESS_IDS) {
  assert.equal(isScryCapableHarness(id), true, `${id} is offered for a scry and must be accepted`);
}
assert.equal(
  isScryCapableHarness("openclaw"),
  false,
  "OpenClaw is a separate agent vessel — the chat route's image gate excludes it and so does this",
);
assert.equal(
  isScryCapableHarness("hermes-agent"),
  false,
  "an alias is refused: the value reaches `coven run <harness>` verbatim, so only canonical ids may pass",
);
assert.equal(isScryCapableHarness(""), false, "an empty harness is refused");
assert.equal(isScryCapableHarness(null), false, "a missing harness is refused");
assert.equal(isScryCapableHarness("../../bin/sh"), false, "an arbitrary command is refused");

// ---------------------------------------------------------------------------
// Accepted likeness types.
// ---------------------------------------------------------------------------

assert.equal(isScryLikenessMime("image/png"), true);
assert.equal(isScryLikenessMime("image/jpeg"), true);
assert.equal(isScryLikenessMime("image/webp"), true);
assert.equal(
  isScryLikenessMime("image/svg+xml"),
  false,
  "SVG stays out for the same reason the avatar route excludes it: it is active content",
);
assert.equal(isScryLikenessMime("text/html"), false);

console.log("scry contract ok");
