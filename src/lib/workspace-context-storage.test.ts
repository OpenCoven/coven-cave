import assert from "node:assert/strict";
import {
  readWorkspaceCrew,
  readWorkspaceContext,
  writeWorkspaceContext,
} from "./workspace-context-storage.ts";
import type { StorageLike } from "./workspace-context-storage.ts";

function memoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
}

// 1. Normalized roundtrip [nova,cody,nova] -> [cody,nova]
{
  const s = memoryStorage();
  writeWorkspaceContext(s, { projectId: "proj-a", familiarIds: ["nova", "cody", "nova"] });
  const ctx = readWorkspaceContext(s, []);
  assert.deepEqual(ctx.familiarIds, ["cody", "nova"], "roundtrip deduplication and sort");
}

// 2. Explicit [] beats legacy [salem]
{
  const s = memoryStorage();
  writeWorkspaceContext(s, { projectId: null, familiarIds: [] });
  const ctx = readWorkspaceContext(s, ["salem"]);
  assert.deepEqual(ctx.familiarIds, [], "explicit empty beats legacy");
}

// 3. readWorkspaceCrew existing project -> [], missing project -> null
{
  const s = memoryStorage();
  writeWorkspaceContext(s, { projectId: "proj-x", familiarIds: [] });
  const existing = readWorkspaceCrew(s, "proj-x");
  assert.deepEqual(existing, [], "existing project crew is []");
  const missing = readWorkspaceCrew(s, "proj-missing");
  assert.equal(missing, null, "missing project crew is null");
}

// 4. Corrupt project JSON fails closed and remains untouched
{
  const s = memoryStorage();
  const corrupt = "{not-valid-json}";
  s.setItem("cave:workspace:project-scope:v1", corrupt);
  assert.throws(
    () => readWorkspaceContext(s, ["cody"]),
    /workspace project scope/i,
    "corrupt project JSON rejects hydration",
  );
  assert.equal(
    s.getItem("cave:workspace:project-scope:v1"),
    corrupt,
    "corrupt project JSON remains untouched",
  );
}

// 5. Empty storage -> injected legacy [salem]
{
  const s = memoryStorage();
  const ctx = readWorkspaceContext(s, ["salem"]);
  assert.equal(ctx.projectId, null, "empty storage -> null project");
  assert.deepEqual(ctx.familiarIds, ["salem"], "empty storage -> legacy");
}

// 6. Write project-a then project-b, verify both per-project crews remain
{
  const s = memoryStorage();
  writeWorkspaceContext(s, { projectId: "project-a", familiarIds: ["nova"] });
  writeWorkspaceContext(s, { projectId: "project-b", familiarIds: ["cody", "salem"] });
  assert.deepEqual(readWorkspaceCrew(s, "project-a"), ["nova"], "project-a crew preserved");
  assert.deepEqual(readWorkspaceCrew(s, "project-b"), ["cody", "salem"], "project-b crew preserved");
}

// 7. Failed crew-map update must not advance the active project pointer
{
  const store = new Map<string, string>();
  const s: StorageLike = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (
        key === "cave:workspace:familiar-scope-by-project:v1" &&
        store.get("cave:workspace:project-scope:v1") === JSON.stringify("project-a")
      ) {
        throw new Error("crew map write failed");
      }
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };

  writeWorkspaceContext(s, { projectId: "project-a", familiarIds: ["nova"] });

  assert.throws(() => {
    writeWorkspaceContext(s, { projectId: "project-b", familiarIds: ["cody", "salem"] });
  }, /crew map write failed/);

  const ctx = readWorkspaceContext(s, ["ignored"]);
  assert.equal(ctx.projectId, "project-a", "failed switch keeps active project");
  assert.deepEqual(ctx.familiarIds, ["nova"], "failed switch keeps original crew");
}

// 8. All-projects null project crew roundtrip
{
  const s = memoryStorage();
  writeWorkspaceContext(s, { projectId: null, familiarIds: ["echo", "astra"] });
  const crew = readWorkspaceCrew(s, null);
  assert.deepEqual(crew, ["astra", "echo"], "null project roundtrip sorted");
  const ctx = readWorkspaceContext(s, ["ignored"]);
  assert.equal(ctx.projectId, null, "null project preserved");
  assert.deepEqual(ctx.familiarIds, ["astra", "echo"], "null project crew from storage");
}

// 9. Corrupt crew JSON blocks writes without replacing unknown data
{
  const s = memoryStorage();
  const corrupt = "{unknown-crew-data}";
  s.setItem("cave:workspace:familiar-scope-by-project:v1", corrupt);
  assert.throws(
    () => writeWorkspaceContext(s, { projectId: "project-a", familiarIds: ["nova"] }),
    /workspace crew map/i,
    "corrupt crew JSON rejects persistence",
  );
  assert.equal(
    s.getItem("cave:workspace:familiar-scope-by-project:v1"),
    corrupt,
    "corrupt crew JSON remains untouched",
  );
  assert.equal(
    s.getItem("cave:workspace:project-scope:v1"),
    null,
    "failed crew write does not advance the project pointer",
  );
}

// 10. Structurally malformed versioned records fail closed
{
  const malformedProject = memoryStorage();
  malformedProject.setItem("cave:workspace:project-scope:v1", JSON.stringify({ projectId: "project-a" }));
  assert.throws(
    () => readWorkspaceContext(malformedProject, []),
    /workspace project scope/i,
    "non-string project record rejects hydration",
  );

  const malformedCrew = memoryStorage();
  malformedCrew.setItem("cave:workspace:familiar-scope-by-project:v1", JSON.stringify(["nova"]));
  assert.throws(
    () => readWorkspaceCrew(malformedCrew, null),
    /workspace crew map/i,
    "non-object crew map rejects hydration",
  );
}

// 11. Writes validate both complete versioned records before changing either one
{
  const invalidProject = memoryStorage();
  const projectRaw = JSON.stringify({ projectId: "project-a" });
  invalidProject.setItem("cave:workspace:project-scope:v1", projectRaw);
  assert.throws(
    () => writeWorkspaceContext(invalidProject, { projectId: "project-b", familiarIds: ["nova"] }),
    /workspace project scope/i,
    "invalid project records reject persistence",
  );
  assert.equal(
    invalidProject.getItem("cave:workspace:project-scope:v1"),
    projectRaw,
    "invalid project record remains untouched",
  );
  assert.equal(
    invalidProject.getItem("cave:workspace:familiar-scope-by-project:v1"),
    null,
    "crew map is not written before project validation",
  );

  const invalidInactiveCrew = memoryStorage();
  const crewRaw = JSON.stringify({ "project-a": ["nova"], "project-b": "unknown" });
  invalidInactiveCrew.setItem("cave:workspace:familiar-scope-by-project:v1", crewRaw);
  assert.throws(
    () => writeWorkspaceContext(invalidInactiveCrew, { projectId: "project-a", familiarIds: ["cody"] }),
    /workspace crew map entry for project-b/i,
    "invalid inactive crew entries reject persistence",
  );
  assert.equal(
    invalidInactiveCrew.getItem("cave:workspace:familiar-scope-by-project:v1"),
    crewRaw,
    "invalid inactive crew data remains byte-for-byte unchanged",
  );
  assert.equal(
    invalidInactiveCrew.getItem("cave:workspace:project-scope:v1"),
    null,
    "project pointer is not written after full-map validation fails",
  );
}

// 12. Hydration validates inactive crew entries before enabling persistence
{
  const s = memoryStorage();
  const crewRaw = JSON.stringify({ "__all-projects__": ["cody"], "project-b": { unknown: true } });
  s.setItem("cave:workspace:project-scope:v1", JSON.stringify(null));
  s.setItem("cave:workspace:familiar-scope-by-project:v1", crewRaw);
  assert.throws(
    () => readWorkspaceContext(s, []),
    /workspace crew map entry for project-b/i,
    "invalid inactive crew entries reject hydration",
  );
  assert.equal(
    s.getItem("cave:workspace:familiar-scope-by-project:v1"),
    crewRaw,
    "failed hydration leaves invalid inactive crew data untouched",
  );
}

// 13. Empty-string versioned records are malformed, not absent
{
  const emptyProject = memoryStorage();
  emptyProject.setItem("cave:workspace:project-scope:v1", "");
  assert.throws(
    () => readWorkspaceContext(emptyProject, ["legacy"]),
    /workspace project scope/i,
    "empty project record rejects hydration",
  );
  assert.throws(
    () => writeWorkspaceContext(emptyProject, { projectId: null, familiarIds: [] }),
    /workspace project scope/i,
    "empty project record rejects persistence",
  );
  assert.equal(emptyProject.getItem("cave:workspace:project-scope:v1"), "");

  const emptyCrew = memoryStorage();
  emptyCrew.setItem("cave:workspace:familiar-scope-by-project:v1", "");
  assert.throws(
    () => readWorkspaceContext(emptyCrew, ["legacy"]),
    /workspace crew map/i,
    "empty crew record rejects hydration",
  );
  assert.throws(
    () => writeWorkspaceContext(emptyCrew, { projectId: null, familiarIds: [] }),
    /workspace crew map/i,
    "empty crew record rejects persistence",
  );
  assert.equal(emptyCrew.getItem("cave:workspace:familiar-scope-by-project:v1"), "");
}

// 14. Log passage
console.log("workspace context storage passed");
