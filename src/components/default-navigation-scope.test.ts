// @ts-nocheck
// The smaller default navigation (#6398). Each removed entry keeps a named
// retained path, so a fresh profile sees less without an existing profile
// losing data, links or an explicit opt-in.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isWorkspaceMode } from "../lib/workspace-mode.ts";
import { paletteDestinations, sidebarDestinations } from "../lib/workspace-destination-policy.ts";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const settings = read("./settings-shell.tsx");
const settingsIndex = read("./settings-sections.ts");
const register = read("./role-surfaces/register.tsx");
const workspace = read("./workspace.tsx");
const composerMenu = read("./composer-add-menu.tsx");
const familiarSkills = read("./familiar-tab-skills.tsx");

assert.deepEqual(
  sidebarDestinations().map(({ id }) => id),
  ["home", "chat", "board", "inbox", "canvas", "grimoire"],
  "the default sidebar is exactly the retained set",
);

// Marketplace: out of the sidebar, every other route preserved.
assert.ok(isWorkspaceMode("marketplace"), "saved links and last-surface strings stay valid");
for (const alias of ["roles", "capabilities"]) assert.ok(isWorkspaceMode(alias), `${alias} alias stays valid`);
assert.ok(paletteDestinations().some(({ id }) => id === "marketplace"), "the palette keeps a Marketplace row");
assert.match(workspace, /mode === "marketplace" \|\| mode === "roles" \|\| mode === "capabilities"/, "the surface still renders");
assert.match(composerMenu, /detail: \{ mode: "marketplace" \}/, "the composer keeps its link");
assert.match(familiarSkills, /navigateFamiliarSurface\("marketplace"\)/, "familiar skills keep their link");
assert.match(
  settings,
  /label="Installed capabilities"[\s\S]{0,700}href="\/\?mode=marketplace"[\s\S]{0,60}Manage installed items/,
  "Settings reaches installed capability management",
);
assert.match(settingsIndex, /group: "Installed capabilities"/, "Settings search finds it");

// X Comms stays opt-in: a fresh familiar never sees it and an opted-in one keeps it.
assert.match(
  register,
  /shouldDisplay: \(context\) => context\.activeFamiliar\?\.xPublishEnabled === true/,
  "the X Comms room stays behind the explicit publishing opt-in",
);

// Submissions has no launcher in the default experience.
assert.equal(sidebarDestinations().some(({ id }) => id === "submissions"), false);
assert.equal(paletteDestinations().some(({ id }) => id === "submissions"), false);

console.log("default-navigation-scope.test.ts: ok");
