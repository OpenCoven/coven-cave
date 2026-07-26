// @ts-nocheck
// cave-fy1q phase 2 — the summoning circle's per-window draft: Escape closes
// the rite (unmount resets state by design) but reopening seeds right back.
// Pure tests exercise coercion/clamping; source pins hold the circle wiring.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SUMMONING_DRAFT_KEY,
  readSummoningDraft,
  saveSummoningDraft,
  clearSummoningDraft,
} from "./summoning-draft.ts";

function fakeStore(seed = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    map: m,
  };
}

const full = {
  stage: 2,
  maxVisited: 2,
  vessel: "local",
  harness: "claude-code",
  agentId: null,
  sshHost: "",
  sshCwd: "",
  sshCommand: "",
  name: "Nyx",
  role: "Researcher",
  description: "Digs deep.",
  idOverride: null,
  glyph: "✶",
  aura: "#a78bfa",
  model: "claude-fable-5",
};

// ── Round trip ────────────────────────────────────────────────────────────────
{
  const s = fakeStore();
  saveSummoningDraft(full, s);
  assert.deepEqual(readSummoningDraft(s), full, "save → read is lossless");
  clearSummoningDraft(s);
  assert.equal(readSummoningDraft(s), null, "clear removes the draft");
}

// ── Coercion: a stale or hand-edited payload can never seed invalid state ────
{
  const s = fakeStore({
    [SUMMONING_DRAFT_KEY]: JSON.stringify({
      stage: 9,
      maxVisited: -3,
      vessel: 42,
      name: ["not", "a", "string"],
      glyph: null,
    }),
  });
  const d = readSummoningDraft(s);
  assert.equal(d.stage, 3, "stage clamps to the last rite stage");
  assert.equal(d.maxVisited, 3, "maxVisited never trails the restored stage");
  assert.equal(d.vessel, null, "non-string vessel drops to null");
  assert.equal(d.name, "", "non-string text fields drop to empty");
  assert.equal(d.glyph, "", "null glyph reads as empty (caller falls back to the default)");
}
assert.equal(readSummoningDraft(fakeStore({ [SUMMONING_DRAFT_KEY]: "{not json" })), null, "junk JSON → null");
assert.equal(readSummoningDraft(fakeStore({ [SUMMONING_DRAFT_KEY]: "null" })), null, "JSON null → null");
assert.equal(readSummoningDraft(fakeStore()), null, "absent → null");
assert.equal(readSummoningDraft(null), null, "no storage (SSR) → null");

// ── Circle wiring pins ────────────────────────────────────────────────────────
const circle = await readFile(new URL("../components/familiar-summoning-circle.tsx", import.meta.url), "utf8");

assert.match(
  circle,
  /const draft = useRef\(readSummoningDraft\(\)\)\.current/,
  "the rite reads the draft once per mount",
);
assert.match(
  circle,
  /Mounted only while open — state resets by unmounting/,
  "the unmount-reset design stays (the draft seeds it back, not a reset())",
);
assert.match(
  circle,
  /if \(summoned\) return;\s*saveSummoningDraft\(/,
  "the save effect stops once summoned so the clear can't be raced",
);
assert.match(
  circle,
  /clearSummoningDraft\(\);\s*setSummoned\(/,
  "a successful summon clears the draft",
);
assert.match(
  circle,
  /useState<string>\(draft\?\.glyph \|\| DEFAULT_GLYPH\)/,
  "an empty drafted glyph falls back to the default sigil",
);

console.log("summoning-draft.test.ts: ok");
