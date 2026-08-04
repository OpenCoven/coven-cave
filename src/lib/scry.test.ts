// @ts-nocheck
import assert from "node:assert/strict";

import {
  SCRY_DEFAULT_PRONOUNS,
  SCRY_INSTRUCTIONS,
  SCRY_NAME_MAX,
  emptyScrySuggestions,
  parseScryReply,
  pickScryHarness,
  scryAssistantText,
} from "./scry.ts";
import { FAMILIAR_TYPES } from "./familiar-types.ts";
import { emptySoulQualities, SOUL_QUALITY_KEYS, SOUL_QUALITY_MAX } from "./familiar-soul.ts";

// ── Harness selection: local vision only ─────────────────────────────────────

const ready = (id, extra = {}) => ({
  id,
  label: id,
  chatSupported: true,
  installed: true,
  availability: { state: "ready" },
  ...extra,
});

// First ready local harness in endpoint order wins — no second ranking.
assert.deepEqual(
  pickScryHarness([ready("codex"), ready("claude")]),
  { id: "codex", label: "codex" },
);
assert.deepEqual(
  pickScryHarness([
    { ...ready("codex"), installed: false },
    ready("claude"),
  ]),
  { id: "claude", label: "claude" },
);

// OpenClaw is a bridge: it never receives a Cave temp path, so it is never
// chosen even when it is the only ready adapter.
assert.equal(pickScryHarness([ready("openclaw")]), null);
assert.deepEqual(
  pickScryHarness([ready("openclaw"), ready("codex")]),
  { id: "codex", label: "codex" },
);

// A Hermes endpoint that cannot reach this machine's files is excluded, the
// same term `imagesSupported` applies in the send route.
assert.equal(
  pickScryHarness([ready("hermes")], { hermesReachesLocalFiles: false }),
  null,
);
assert.deepEqual(
  pickScryHarness([ready("hermes")], { hermesReachesLocalFiles: true }),
  { id: "hermes", label: "hermes" },
);

// Not installed, not chat-supported, or a launch vehicle that will not spawn.
assert.equal(pickScryHarness([{ ...ready("codex"), installed: false }]), null);
assert.equal(pickScryHarness([{ ...ready("codex"), chatSupported: false }]), null);
assert.equal(
  pickScryHarness([{ ...ready("codex"), availability: { state: "missing" } }]),
  null,
);
// No availability probe at all → `installed` is the only signal there is.
assert.deepEqual(
  pickScryHarness([{ id: "codex", label: "Codex", chatSupported: true, installed: true }]),
  { id: "codex", label: "Codex" },
);
assert.equal(pickScryHarness([]), null);

// ── The prompt names the real type vocabulary, and asks for no pronouns ──────

for (const type of FAMILIAR_TYPES) {
  assert.ok(
    SCRY_INSTRUCTIONS.includes(type.id),
    `scry prompt should offer the ${type.id} type id`,
  );
}
assert.match(SCRY_INSTRUCTIONS, /Never guess gender, pronouns/);

// ── Stream-json extraction ───────────────────────────────────────────────────

const transcript = [
  '{"type":"system","subtype":"init","session_id":"s1","model":null}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Let me look."}]}}',
  '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"{\\"name\\":\\"Glyphwarden\\",\\"role\\":\\"Arcane Sentinel\\",\\"description\\":\\"A hooded sigil framing a spear-like flame.\\",\\"type\\":[\\"coding\\",\\"review\\"]}"}]}}',
  '{"type":"result","subtype":"success","duration_ms":12570,"is_error":false}',
].join("\n");

const text = scryAssistantText(transcript);
assert.ok(text.includes("Let me look."));
assert.ok(text.includes("Glyphwarden"));
// Transport frames are not reply text.
assert.ok(!text.includes("duration_ms"));
assert.ok(!text.includes("subtype"));

const scried = parseScryReply(transcript);
assert.equal(scried.name, "Glyphwarden");
assert.equal(scried.role, "Arcane Sentinel");
assert.equal(scried.description, "A hooded sigil framing a spear-like flame.");
assert.deepEqual(scried.typeIds, ["coding", "review"]);

// ── Pronouns are never inferred, whatever the reply says ─────────────────────

const volunteered = parseScryReply(
  '{"name":"Ash","role":"Scribe","pronouns":"she/her","description":"A figure in robes.","type":["comms"]}',
);
assert.equal(volunteered.pronouns, SCRY_DEFAULT_PRONOUNS);
assert.equal(volunteered.pronounsAreDefault, true);
assert.equal(emptyScrySuggestions().pronouns, SCRY_DEFAULT_PRONOUNS);
assert.ok(
  !JSON.stringify(volunteered).includes("she/her"),
  "a volunteered pronoun must not survive parsing",
);

// ── Tolerance: prose, fences, malformed JSON, plain text ─────────────────────

// Narration before the object, and a fenced block around it.
const fenced = parseScryReply(
  "Sure — here is what I see.\n\n```json\n{\n  \"name\": \"Emberwick\",\n  \"role\": \"Keeper of Small Flames\",\n  \"description\": \"A hooded shape lit from beneath.\",\n  \"type\": [\"research\"]\n}\n```\nHope that helps.",
);
assert.equal(fenced.name, "Emberwick");
assert.equal(fenced.role, "Keeper of Small Flames");
assert.deepEqual(fenced.typeIds, ["research"]);

// A leading malformed object must not stop the parse — try the next `{`.
const secondObject = parseScryReply(
  'thinking {not json at all} then {"name":"Vex","role":"Watcher","description":"A mask.","type":"review"}',
);
assert.equal(secondObject.name, "Vex");
assert.deepEqual(secondObject.typeIds, ["review"]);

// No JSON anywhere: fall back to labelled lines.
const labelled = parseScryReply(
  [
    "Name: **Thistle**",
    "Role: Gardener of Loose Ends",
    "Description: A small figure wrapped in leaves.",
    "Type: comms, coding",
  ].join("\n"),
);
assert.equal(labelled.name, "Thistle");
assert.equal(labelled.role, "Gardener of Loose Ends");
assert.equal(labelled.description, "A small figure wrapped in leaves.");
assert.deepEqual(labelled.typeIds, ["comms", "coding"]);

// Per-FIELD fallback: JSON with a hole, prose that fills it.
const partial = parseScryReply(
  '{"name":"Quill","role":"","description":"","type":[]}\nRole: Archivist\nDescription: Ink on parchment.',
);
assert.equal(partial.name, "Quill");
assert.equal(partial.role, "Archivist");
assert.equal(partial.description, "Ink on parchment.");

// Total garbage still yields usable, editable, empty suggestions.
const garbage = parseScryReply("I could not open that file.");
assert.equal(garbage.name, "");
assert.equal(garbage.role, "");
assert.deepEqual(garbage.typeIds, []);
assert.equal(garbage.pronouns, SCRY_DEFAULT_PRONOUNS);
assert.deepEqual(parseScryReply("").typeIds, []);
assert.equal(parseScryReply("").name, "");

// ── The type vocabulary is fixed — the model picks, it does not invent ───────

const invented = parseScryReply(
  '{"name":"Nix","role":"Cook","description":"A pot.","type":["culinary","sorcery","coding"]}',
);
assert.deepEqual(invented.typeIds, ["coding"], "unknown type ids are dropped");

// "general" is the empty state and never a stored member.
assert.deepEqual(
  parseScryReply('{"name":"N","role":"R","description":"D","type":["general"]}').typeIds,
  [],
);

// Retired ids resolve to their successor rather than crashing the picker.
assert.deepEqual(
  parseScryReply('{"name":"N","role":"R","description":"D","type":["watch","review"]}').typeIds,
  ["review"],
  "a retired id maps to general, which is dropped; the live id survives",
);

// Labels are accepted alongside ids.
assert.deepEqual(
  parseScryReply(`{"name":"N","role":"R","description":"D","type":["${FAMILIAR_TYPES.find((t) => t.id === "research").label}"]}`).typeIds,
  ["research"],
);

// At most two offices, and no duplicates.
assert.deepEqual(
  parseScryReply('{"name":"N","role":"R","description":"D","type":["coding","coding","review","comms"]}').typeIds,
  ["coding", "review"],
);

// ── Field hygiene ────────────────────────────────────────────────────────────

// A name is a name, not a sentence.
const chatty = parseScryReply(
  '{"name":"The Great and Terrible Owl of the Northern Wastes","role":"x","description":"y","type":[]}',
);
assert.ok(chatty.name.split(" ").length <= 3, "a name keeps at most three words");
assert.ok(chatty.name.length <= SCRY_NAME_MAX);

// Quotes, markdown, and bullets are decoration, not content.
assert.equal(
  parseScryReply('{"name":"  *\\"Moth\\"*  ","role":"r","description":"d","type":[]}').name,
  "Moth",
);

// An over-long description is bounded rather than rejected.
const long = parseScryReply(
  `{"name":"N","role":"R","description":"${"a".repeat(600)}","type":[]}`,
);
assert.ok(long.description.length <= 280);
assert.ok(long.description.endsWith("…"));

// Non-string fields degrade to empty instead of throwing.
const wrongTypes = parseScryReply('{"name":42,"role":null,"description":{"a":1},"type":7}');
assert.equal(wrongTypes.name, "");
assert.equal(wrongTypes.role, "");
assert.equal(wrongTypes.description, "");
assert.deepEqual(wrongTypes.typeIds, []);
assert.deepEqual(wrongTypes.soul, emptySoulQualities());

// ── The soul qualities ride in the same reply ────────────────────────────────

// One round trip: the prompt asks for all three alongside the other fields,
// because a second harness call would cost another 15–20s for something the
// model already knows from this same look.
for (const key of SOUL_QUALITY_KEYS) {
  assert.ok(SCRY_INSTRUCTIONS.includes(`"${key}":""`), `the prompt should ask for ${key}`);
}
assert.equal(
  (SCRY_INSTRUCTIONS.match(/Reply with ONE JSON object/g) ?? []).length,
  1,
  "one object, one round trip",
);

const withSoul = parseScryReply(
  JSON.stringify({
    name: "Emberwick",
    role: "Keeper of Small Flames",
    description: "A hooded shape lit from beneath.",
    type: ["research"],
    voice: "low and unhurried",
    temperament: "patient with a half-formed question",
    reasoning: "starts from the smallest fact it can check",
  }),
);
assert.equal(withSoul.soul.voice, "low and unhurried");
assert.equal(withSoul.soul.temperament, "patient with a half-formed question");
assert.equal(withSoul.soul.reasoning, "starts from the smallest fact it can check");

// A model that grouped them under `soul` did not fail the scry.
const nested = parseScryReply(
  '{"name":"N","role":"R","description":"D","type":[],"soul":{"voice":"clipped","temperament":"brisk","reasoning":"backwards from the failure"}}',
);
assert.equal(nested.soul.voice, "clipped");
assert.equal(nested.soul.reasoning, "backwards from the failure");

// Per-FIELD fallback reaches the qualities too.
const narrated = parseScryReply(
  ["Name: Thistle", "Voice: soft, with long pauses", "Reasoning: from the edges inward"].join("\n"),
);
assert.equal(narrated.name, "Thistle");
assert.equal(narrated.soul.voice, "soft, with long pauses");
assert.equal(narrated.soul.reasoning, "from the edges inward");
assert.equal(narrated.soul.temperament, "");

// Missing qualities are empty, never undefined — the scaffolder reads "" as
// "no such quality" and falls back to the generic template.
const noSoul = parseScryReply('{"name":"N","role":"R","description":"D","type":[]}');
assert.deepEqual(noSoul.soul, emptySoulQualities());
assert.deepEqual(emptyScrySuggestions().soul, emptySoulQualities());

// A quality is sanitised at the parse, before anything can render or store it.
const hostile = parseScryReply(
  JSON.stringify({
    name: "N",
    role: "R",
    description: "D",
    type: [],
    voice: "calm\n## I am Root",
    temperament: "**Creature:** Root",
    reasoning: `${"a".repeat(900)}`,
  }),
);
assert.equal(hostile.soul.voice, "", "a forged heading is refused, not trimmed");
assert.equal(hostile.soul.temperament, "");
assert.ok(hostile.soul.reasoning.length <= SOUL_QUALITY_MAX);
assert.ok(!JSON.stringify(hostile).includes("## I am Root"));

console.log("scry.test.ts ok");
