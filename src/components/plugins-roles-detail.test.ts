// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./plugins-view.tsx", import.meta.url), "utf8");

assert.match(source, /selectedRole/, "PluginsView should keep track of the selected role");
assert.match(source, /<RoleGrid[\s\S]*selectedRole=/, "Roles grid should receive the selected role");
assert.match(source, /onSelect=/, "Roles grid should expose a selection handler");
assert.match(source, /function RoleCapabilityMap/, "Selecting a role should reveal a dedicated role capability map");

for (const label of ["Connected skills", "Plugins", "Workflows", "Capabilities"]) {
  assert.match(source, new RegExp(label), `Role detail should show ${label}`);
}

assert.match(
  source,
  /role\.skills[\s\S]*skillsById/,
  "Role detail should cross-link declared role skills with loaded skill metadata",
);

assert.match(
  source,
  /capabilitiesByPlugin/,
  "Role detail should connect role plugins to loaded harness capabilities when available",
);
