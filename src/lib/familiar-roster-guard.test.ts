// @ts-nocheck
import assert from "node:assert/strict";
import {
  explicitFamiliarIdsFromToml,
  filterInstallSeedFamiliars,
  filterInternalCovenNameSuggestions,
  hasLiveFamiliarState,
  isInternalCovenFamiliarName,
} from "./familiar-roster-guard.ts";

assert.deepEqual(
  filterInternalCovenNameSuggestions([
    "Nova",
    "Wren",
    "Kitty",
    "Cody",
    "Charm",
    "Sage",
    "Astra",
    "Echo",
    "Salem",
    "Quill",
  ]),
  ["Wren", "Quill"],
);
assert.equal(isInternalCovenFamiliarName("Nova"), true);
assert.equal(isInternalCovenFamiliarName("nova prime"), false);

const installDefaults = [
  { id: "sage", display_name: "Sage", role: "Guide" },
  { id: "forge", display_name: "Forge", role: "Builder" },
  { id: "opencode-local", display_name: "OpenCode", role: "Code Familiar" },
];

assert.deepEqual(
  filterInstallSeedFamiliars(installDefaults, new Set()),
  [],
  "the known generated first-install roster should not reach the picker",
);

assert.deepEqual(
  filterInstallSeedFamiliars(
    installDefaults,
    new Set(["sage", "forge", "opencode-local"]),
  ).map((f) => f.id),
  ["sage", "forge", "opencode-local"],
  "explicit ids must win even when the complete roster matches the install defaults",
);

assert.deepEqual(
  filterInstallSeedFamiliars(
    [
      ...installDefaults,
      { id: "wren", display_name: "Wren", role: "Research" },
    ],
    new Set(["wren"]),
  ).map((f) => f.id),
  ["wren"],
  "implicit install defaults are hidden while explicit user familiars remain",
);

assert.deepEqual(
  filterInstallSeedFamiliars(
    [
      { id: "sage", display_name: "Sage", role: "Guide" },
      { id: "wren", display_name: "Wren", role: "Research" },
    ],
    explicitFamiliarIdsFromToml(`[[familiar]]
id = "sage"

[[familiar]]
id = "wren"
`),
  ).map((f) => f.id),
  ["sage", "wren"],
  "an intentionally user-authored reserved id is preserved outside the generated default trio",
);

// ── cave-7cv4: live familiars are never hidden by the name heuristics ────────
// A coven can genuinely contain familiars named Sage/Nova/Salem — especially
// on a remote host or hub, where the LOCAL familiars.toml says nothing about
// them. Seeded suggestions carry only id/name/role; anything with activity
// state is real and must stay visible even with zero explicit ids.
assert.equal(hasLiveFamiliarState({ id: "sage" }), false);
assert.equal(hasLiveFamiliarState({ id: "sage", last_seen: "2026-07-14T00:00:00Z" }), true);
assert.equal(hasLiveFamiliarState({ id: "sage", active_sessions: 2 }), true);
assert.equal(hasLiveFamiliarState({ id: "sage", active_sessions: 0 }), false);
assert.equal(hasLiveFamiliarState({ id: "sage", memory_freshness: "fresh" }), true);

assert.deepEqual(
  filterInstallSeedFamiliars(
    [
      { id: "sage", display_name: "Sage", role: "Guide", last_seen: "2026-07-14T00:00:00Z" },
      { id: "salem", display_name: "Salem", role: "Archivist", active_sessions: 2 },
      { id: "nova", display_name: "Nova", role: "Research", memory_freshness: "fresh" },
    ],
    new Set(),
  ).map((f) => f.id),
  ["sage", "salem", "nova"],
  "familiars with live activity state survive the reserved-name filter without local toml entries",
);

assert.deepEqual(
  filterInstallSeedFamiliars(
    [{ id: "sage", display_name: "Sage", role: "Guide", active_sessions: 1 }],
    new Set(),
  ).map((f) => f.id),
  ["sage"],
  "a lone install-default-shaped familiar with live state is real, not a generated roster",
);

console.log("familiar-roster-guard.test.ts: ok");
