import assert from "node:assert/strict";
import {
  allProjectsScope,
  familiarIdsForScope,
  familiarScopeFromIds,
  projectScope,
  reconcileCrewForProject,
  resolveActingFamiliar,
  type FamiliarScope,
} from "./workspace-context.ts";

const selected = (...ids: string[]): FamiliarScope => ({
  kind: "selected",
  familiarIds: ids,
});

assert.deepEqual(allProjectsScope(), { kind: "all-projects" });
assert.deepEqual(projectScope(" project-a "), {
  kind: "project",
  projectId: "project-a",
});
assert.deepEqual(projectScope("   "), allProjectsScope());

assert.deepEqual(
  familiarScopeFromIds(["  nova", "", "salem", "nova", "  "]),
  { kind: "selected", familiarIds: ["nova", "salem"] },
  "familiar ids are normalized, deduplicated, and sorted",
);
assert.deepEqual(
  familiarScopeFromIds([" ", "\t", "\n"]),
  { kind: "all-eligible" },
  "empty normalized familiar input falls back to all eligible",
);
assert.deepEqual(
  familiarIdsForScope({ kind: "selected", familiarIds: ["salem", "cody", "nova"] }),
  ["salem", "cody", "nova"],
  "selected scopes pass through familiar ids without reordering",
);
assert.deepEqual(
  familiarIdsForScope({ kind: "all-eligible" }),
  [],
  "all-eligible scopes expose no selected familiar ids",
);

assert.deepEqual(
  reconcileCrewForProject(selected("cody", "nova"), ["nova", "salem"]),
  selected("nova"),
  "project switches retain only selected familiars with verified access",
);
assert.deepEqual(
  reconcileCrewForProject(selected("  nova ", "nova", " salem "), ["nova", "salem"]),
  selected("nova", "salem"),
  "project switches normalize selected familiar ids before retaining eligible members",
);
assert.deepEqual(
  reconcileCrewForProject(selected("cody"), ["nova", "salem"]),
  { kind: "all-eligible" },
  "zero retained members becomes Project crew instead of the first eligible familiar",
);
assert.deepEqual(
  reconcileCrewForProject({ kind: "all-eligible" }, ["cody"]),
  { kind: "all-eligible" },
  "aggregate crew stays aggregate even when its eligible roster changes",
);

assert.deepEqual(
  resolveActingFamiliar(selected("cody"), ["cody", "nova"]),
  { kind: "resolved", familiarId: "cody" },
);
assert.deepEqual(
  resolveActingFamiliar(selected("cody", "nova"), ["cody", "nova"]),
  { kind: "required" },
);
assert.deepEqual(
  resolveActingFamiliar({ kind: "all-eligible" }, ["cody"]),
  { kind: "resolved", familiarId: "cody" },
  "a one-person project crew is unambiguous",
);
assert.deepEqual(
  resolveActingFamiliar({ kind: "all-eligible" }, ["cody", "nova"]),
  { kind: "required" },
  "an aggregate crew with multiple members never silently selects the first",
);
assert.deepEqual(
  resolveActingFamiliar(selected("cody"), []),
  { kind: "required" },
  "an unavailable selected familiar cannot remain the actor",
);

console.log("workspace context contract passed");
