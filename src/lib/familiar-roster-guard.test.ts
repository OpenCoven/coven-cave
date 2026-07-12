// @ts-nocheck
import assert from "node:assert/strict";
import {
  explicitFamiliarIdsFromToml,
  filterInstallSeedFamiliars,
  filterInternalCovenNameSuggestions,
  isInternalCovenFamiliarName,
} from "./familiar-roster-guard.ts";

assert.deepEqual(
  filterInternalCovenNameSuggestions([
    "Nova",
    "Wren",
    "Kitty",
    "Cody",
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

console.log("familiar-roster-guard.test.ts: ok");
