// familiar-types (cave-cc5r): the explicit familiar Type vocabulary that
// unlocks Role Surface rooms. The table is the single documented mapping from
// the Studio's Type picker to room grants, so these tests pin its shape and
// its integration with familiarRoleIds/surfaceMatchesRoles.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FAMILIAR_TYPE,
  FAMILIAR_TYPES,
  familiarTypeRoleIds,
  isFamiliarTypeId,
  resolveFamiliarType,
} from "./familiar-types.ts";
import { familiarRoleIds, normalizeRoleId, surfaceMatchesRoles } from "./role-surfaces.ts";

test("General is the explicit default and grants no room", () => {
  assert.equal(DEFAULT_FAMILIAR_TYPE, "general");
  assert.equal(FAMILIAR_TYPES[0].id, "general");
  assert.equal(FAMILIAR_TYPES[0].roleToken, null);
  assert.deepEqual(familiarTypeRoleIds("general"), []);
  assert.deepEqual(familiarTypeRoleIds(undefined), []);
  assert.deepEqual(familiarTypeRoleIds(null), []);
});

test("every non-General type grants its room's role token", () => {
  const tokens = Object.fromEntries(
    FAMILIAR_TYPES.filter((t) => t.roleToken).map((t) => [t.id, t.roleToken]),
  );
  // The registered rooms' roles (role-surfaces/register.tsx). If a room's
  // role changes, this table — the Studio picker's contract — must follow.
  assert.deepEqual(tokens, {
    coding: "coder",
    research: "researcher",
    review: "reviewer",
    writing: "scribe",
    comms: "messenger",
    watch: "sentinel",
    planning: "navigator",
    indexing: "indexer",
  });
});

test("role tokens are already normalizeRoleId-shaped", () => {
  for (const t of FAMILIAR_TYPES) {
    assert.equal(t.id, normalizeRoleId(t.id));
    if (t.roleToken) assert.equal(t.roleToken, normalizeRoleId(t.roleToken));
    assert.ok(t.label.length > 0);
    assert.ok(t.description.length > 0);
  }
});

test("resolveFamiliarType falls back to General on unknown/stale values", () => {
  assert.equal(resolveFamiliarType("coding").id, "coding");
  assert.equal(resolveFamiliarType(" CODING ").id, "coding");
  assert.equal(resolveFamiliarType("retired-type").id, "general");
  assert.equal(resolveFamiliarType("").id, "general");
  assert.equal(resolveFamiliarType(undefined).id, "general");
  assert.ok(isFamiliarTypeId("coding"));
  assert.ok(!isFamiliarTypeId("coder")); // token, not a type id
});

test("familiarTypeRoleIds grants the type id AND its role token", () => {
  assert.deepEqual(familiarTypeRoleIds("coding"), ["coding", "coder"]);
  assert.deepEqual(familiarTypeRoleIds("research"), ["research", "researcher"]);
});

// ── Integration with the Role Surface matcher ────────────────────────────────

const codeRoomShape = {
  role: "coder",
  aliases: ["coding", "developer", "engineer", "programmer", "software-engineer", "code"],
};

test("an explicit Coding type unlocks the Code room without touching the role label", () => {
  const ids = familiarRoleIds({ id: "fam-1", role: "Orchestrator", familiarType: "coding" });
  assert.ok(surfaceMatchesRoles(codeRoomShape, ids));
});

test("a coder role label keeps granting with no type set (types add, never subtract)", () => {
  const byLabel = familiarRoleIds({ id: "fam-1", role: "Software Engineer" });
  assert.ok(surfaceMatchesRoles(codeRoomShape, byLabel));
  const byPreset = familiarRoleIds({ id: "fam-2", role: "Code reviewer" });
  assert.ok(surfaceMatchesRoles(codeRoomShape, byPreset));
});

test("a General/absent type grants nothing extra", () => {
  const ids = familiarRoleIds({ id: "fam-1", role: "Orchestrator", familiarType: "general" });
  assert.ok(!surfaceMatchesRoles(codeRoomShape, ids));
  const noType = familiarRoleIds({ id: "fam-1", role: "Orchestrator" });
  assert.ok(!surfaceMatchesRoles(codeRoomShape, noType));
});

test("a non-coding type still unlocks its own room", () => {
  const ids = familiarRoleIds({ id: "fam-1", role: "Orchestrator", familiarType: "research" });
  assert.ok(surfaceMatchesRoles({ role: "researcher" }, ids));
  assert.ok(!surfaceMatchesRoles(codeRoomShape, ids));
});
