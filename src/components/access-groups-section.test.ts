// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const section = readFileSync(new URL("./access-groups-section.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./settings-shell.tsx", import.meta.url), "utf8");
const inline = readFileSync(new URL("./familiar-studio-inline.tsx", import.meta.url), "utf8");
const projectsView = readFileSync(new URL("./projects-view.tsx", import.meta.url), "utf8");
const sections = readFileSync(new URL("./settings-sections.ts", import.meta.url), "utf8");

// ── Access groups are a peer pane of Chat → Projects (cave-2tmly) ────────────
// They used to sit two levels down, inside a familiar's Settings → Projects
// tab, which is why nobody found the one primitive that grants a set of
// projects to a set of familiars at once.
assert.match(section, /export function AccessGroupsSection/, "exports the access groups section");
assert.doesNotMatch(shell, /<AccessGroupsSection/, "the shell does not duplicate access groups below the control sheet");
assert.doesNotMatch(inline, /AccessGroupsSection/, "the inline studio no longer buries access groups");
assert.match(
  projectsView,
  /<AccessGroupsSection familiars=\{resolvedFamiliars\} \/>/,
  "Chat → Projects mounts the access groups manager",
);
assert.match(
  projectsView,
  /id: "groups",\s*label: "Groups",/,
  "groups are a named tab, not a section scrolled past",
);
assert.doesNotMatch(sections, /group: "Access groups"/, "retired Settings search does not index the access groups group");

// ── Speaks the access-groups API, human-confirmed ─────────────────────────────
assert.match(section, /fetch\("\/api\/access-groups"/, "loads groups from the list route");
assert.match(section, /fetch\("\/api\/projects"/, "loads projects for the grant rows");
assert.match(
  section,
  /method: "POST"[\s\S]*?JSON\.stringify\(\{ name \}\)/,
  "creating a group sends only the group name (human-confirmed; no familiar identity rides along)",
);
assert.match(
  section,
  /\/api\/access-groups\/\$\{group\.id\}/,
  "membership + grant changes PATCH the addressed group",
);
assert.match(
  section,
  /JSON\.stringify\(\{ memberFamiliarIds \}\)/,
  "toggling a member sends the full replacement membership list",
);
assert.match(
  section,
  /JSON\.stringify\(\{ projectGrants \}\)/,
  "changing project access sends the full replacement grant list",
);
assert.match(section, /method: "DELETE"/, "groups can be deleted");

// ── Read/write levels ─────────────────────────────────────────────────────────
assert.match(
  section,
  /currentLevel === null \? "read" : currentLevel === "read" \? "write" : null/,
  "project access cycles off → read → write → off",
);
assert.match(section, /accessLevelMeta\(/, "levels render through the shared read/write meta");
assert.match(
  section,
  /union-max/,
  "documents that effective access is the union-max of direct + group grants",
);

// ── Membership is by explicit id, never the role label ────────────────────────
assert.match(
  section,
  /never the editable `role` display\s*\* label/,
  "documents that membership is keyed by familiar id, not the mutable role label",
);
assert.match(
  section,
  /isSupreme\(familiar\.id, supremeFamiliarId\)/,
  "the supreme (all-access) familiar is not offered as a member",
);
assert.match(section, /role="checkbox"/, "member chips are accessible checkboxes");

console.log("access-groups-section.test.ts: ok");
