import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clearRoleSurfacesForTest,
  familiarRoleIds,
  getRoleSurface,
  isRoleSurfaceMode,
  listRoleSurfaces,
  matchesShortcutCombo,
  normalizeRoleId,
  parseRoleSurfaceMode,
  registerRoleSurface,
  resolveVisibleRoleSurfaces,
  roleSurfaceMode,
  surfaceMatchesRoles,
  type RoleSurface,
  type RoleSurfaceContext,
} from "./role-surfaces.ts";

function makeSurface(overrides: Partial<RoleSurface> = {}): RoleSurface {
  return {
    id: "test-surface",
    role: "researcher",
    title: "Test Surface",
    iconName: "ph:archive",
    description: "test",
    priority: 0,
    shouldDisplay: () => true,
    render: () => null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<RoleSurfaceContext> = {}): RoleSurfaceContext {
  return {
    activeFamiliar: { id: "fam-1", display_name: "Fam", role: "Researcher" },
    activePerson: null,
    currentThread: null,
    runtimeState: { daemonRunning: true, sessions: [], activeSessionId: null },
    memory: { listEntries: async () => [], readFile: async () => null },
    tools: { listTools: async () => [] },
    plugins: { listPlugins: async () => [] },
    openUrl: () => {},
    openSession: () => {},
    focusCard: () => {},
    refreshTasks: () => {},
    ...overrides,
  };
}

test("registerRoleSurface adds, replaces by id, and unregisters", () => {
  clearRoleSurfacesForTest();
  const first = makeSurface();
  const unregister = registerRoleSurface(first);
  assert.equal(listRoleSurfaces().length, 1);
  assert.equal(getRoleSurface("test-surface"), first);

  // Re-registering the same id replaces (HMR idempotence), never duplicates.
  const second = makeSurface({ title: "Replaced" });
  registerRoleSurface(second);
  assert.equal(listRoleSurfaces().length, 1);
  assert.equal(getRoleSurface("test-surface")?.title, "Replaced");

  // A stale unregister (from the replaced registration) must not remove the
  // replacement.
  unregister();
  assert.equal(getRoleSurface("test-surface")?.title, "Replaced");
});

test("normalizeRoleId collapses case, spaces, and punctuation", () => {
  assert.equal(normalizeRoleId("Research Analyst"), "research-analyst");
  assert.equal(normalizeRoleId("  Messenger "), "messenger");
  assert.equal(normalizeRoleId("Indexer/Archivist"), "indexer-archivist");
  assert.equal(normalizeRoleId(""), "");
});

test("familiarRoleIds merges role label tokens with active manifests", () => {
  const ids = familiarRoleIds(
    { id: "fam-1", role: "Research Analyst" },
    [
      { id: "messenger", name: "Messenger", familiar: "fam-1", active: true },
      { id: "indexer", familiar: "fam-1", active: false }, // inactive — ignored
      { id: "sentinel", familiar: "fam-2", active: true }, // other familiar — ignored
    ],
  );
  assert.ok(ids.has("research-analyst")); // whole label
  assert.ok(ids.has("research")); // label tokens
  assert.ok(ids.has("analyst"));
  assert.ok(ids.has("messenger")); // active manifest
  assert.ok(!ids.has("indexer"));
  assert.ok(!ids.has("sentinel"));
});

test("surfaceMatchesRoles is normalization-insensitive", () => {
  const ids = familiarRoleIds({ id: "f", role: "Researcher" });
  assert.ok(surfaceMatchesRoles({ role: "researcher" }, ids));
  assert.ok(surfaceMatchesRoles({ role: "Researcher" }, ids));
  assert.ok(!surfaceMatchesRoles({ role: "messenger" }, ids));
});

test("surfaceMatchesRoles honors alias roles with the same normalization", () => {
  const planner = familiarRoleIds({ id: "f", role: "Planner" });
  assert.ok(surfaceMatchesRoles({ role: "navigator", aliases: ["planner"] }, planner));
  assert.ok(surfaceMatchesRoles({ role: "navigator", aliases: ["Planner"] }, planner));
  assert.ok(!surfaceMatchesRoles({ role: "navigator" }, planner));
  assert.ok(!surfaceMatchesRoles({ role: "navigator", aliases: ["editor"] }, planner));
});

test("familiarRoleIds grants the explicit familiar Type's tokens (cave-cc5r)", () => {
  const ids = familiarRoleIds({ id: "f", role: "Orchestrator", familiarType: "coding" });
  assert.ok(ids.has("coding"));
  assert.ok(ids.has("coder"));
  assert.ok(surfaceMatchesRoles({ role: "coder" }, ids));
  // types add, never subtract: the role label's tokens still ride along
  assert.ok(ids.has("orchestrator"));
});

test("a General or absent familiar Type grants no extra tokens", () => {
  const general = familiarRoleIds({ id: "f", role: "Orchestrator", familiarType: "general" });
  assert.ok(!surfaceMatchesRoles({ role: "coder" }, general));
  const unknown = familiarRoleIds({ id: "f", role: "Orchestrator", familiarType: "not-a-type" });
  assert.ok(!surfaceMatchesRoles({ role: "coder" }, unknown));
});

test("a multi-value familiarType unions grants from all types (cave-gud8)", () => {
  const ids = familiarRoleIds({ id: "f", role: "Orchestrator", familiarType: "coding,research" });
  assert.ok(ids.has("coding"));
  assert.ok(ids.has("coder"));
  assert.ok(ids.has("research"));
  assert.ok(ids.has("researcher"));
});

test("resolveVisibleRoleSurfaces shows alias-matched rooms", () => {
  clearRoleSurfacesForTest();
  const context = makeContext();
  const chartRoom = makeSurface({ id: "chart-room", role: "navigator", aliases: ["planner"], title: "Chart Room" });
  const desk = makeSurface({ id: "desk", role: "scribe", aliases: ["editor"], title: "Desk" });
  const roleIds = familiarRoleIds({ id: "f", role: "Planner" });
  const visible = resolveVisibleRoleSurfaces([chartRoom, desk], roleIds, context);
  assert.deepEqual(visible.map((s) => s.id), ["chart-room"]);
});

test("resolveVisibleRoleSurfaces filters by role, gates on shouldDisplay, sorts by priority", () => {
  clearRoleSurfacesForTest();
  const context = makeContext();
  const low = makeSurface({ id: "low", role: "researcher", title: "Low", priority: 1 });
  const high = makeSurface({ id: "high", role: "researcher", title: "High", priority: 9 });
  const hidden = makeSurface({ id: "hidden", role: "researcher", shouldDisplay: () => false });
  const throwing = makeSurface({
    id: "throwing",
    role: "researcher",
    shouldDisplay: () => { throw new Error("boom"); },
  });
  const otherRole = makeSurface({ id: "other", role: "messenger" });

  const roleIds = familiarRoleIds(context.activeFamiliar);
  const visible = resolveVisibleRoleSurfaces([low, high, hidden, throwing, otherRole], roleIds, context);
  assert.deepEqual(visible.map((s) => s.id), ["high", "low"]);
});

test("a familiar with multiple roles sees all matching surfaces", () => {
  const context = makeContext({
    activeFamiliar: { id: "fam-multi", display_name: "Multi", role: "Researcher" },
  });
  const roleIds = familiarRoleIds(context.activeFamiliar, [
    { id: "messenger", familiar: "fam-multi", active: true },
  ]);
  const research = makeSurface({ id: "desk", role: "researcher", priority: 2 });
  const comms = makeSurface({ id: "ops", role: "messenger", priority: 1 });
  const archive = makeSurface({ id: "archive", role: "indexer" });

  const visible = resolveVisibleRoleSurfaces([research, comms, archive], roleIds, context);
  assert.deepEqual(visible.map((s) => s.id), ["desk", "ops"]);
});

test("a familiar without matching roles sees no role surfaces", () => {
  const context = makeContext({
    activeFamiliar: { id: "fam-plain", display_name: "Plain", role: "Companion" },
  });
  const roleIds = familiarRoleIds(context.activeFamiliar);
  const surfaces = [
    makeSurface({ id: "desk", role: "researcher" }),
    makeSurface({ id: "ops", role: "messenger" }),
    makeSurface({ id: "archive", role: "indexer" }),
  ];
  assert.deepEqual(resolveVisibleRoleSurfaces(surfaces, roleIds, context), []);
});

test("a dummy surface registered from a separate module appears without shell edits", async () => {
  clearRoleSurfacesForTest();
  // Simulates a drop-in module: registration happens entirely through the
  // public registry API — nothing in the Cave shell knows about "watchtower".
  const dummyModule = () => {
    registerRoleSurface(
      makeSurface({ id: "watchtower", role: "sentinel", title: "Watchtower", priority: 5 }),
    );
  };
  dummyModule();

  const context = makeContext({
    activeFamiliar: { id: "fam-s", display_name: "S", role: "Sentinel" },
  });
  const visible = resolveVisibleRoleSurfaces(
    listRoleSurfaces(),
    familiarRoleIds(context.activeFamiliar),
    context,
  );
  assert.deepEqual(visible.map((s) => s.id), ["watchtower"]);
});

test("workspace-mode bridge round-trips surface ids through one generic prefix", () => {
  const mode = roleSurfaceMode("researcher-desk");
  assert.equal(mode, "surface:researcher-desk");
  assert.ok(isRoleSurfaceMode(mode));
  assert.equal(parseRoleSurfaceMode(mode), "researcher-desk");

  assert.ok(!isRoleSurfaceMode("chat"));
  assert.ok(!isRoleSurfaceMode("surface:")); // empty id is not a surface mode
  assert.equal(parseRoleSurfaceMode("board"), null);
});

test("matchesShortcutCombo honors mod aliasing and rejects extra modifiers", () => {
  const base = { key: "e", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
  assert.ok(matchesShortcutCombo({ ...base, metaKey: true }, "mod+e")); // ⌘ on macOS
  assert.ok(matchesShortcutCombo({ ...base, ctrlKey: true }, "mod+e")); // Ctrl elsewhere
  assert.ok(!matchesShortcutCombo(base, "mod+e")); // bare key isn't mod+key
  assert.ok(!matchesShortcutCombo({ ...base, metaKey: true, shiftKey: true }, "mod+e")); // extra shift
  assert.ok(matchesShortcutCombo({ ...base, metaKey: true, shiftKey: true }, "mod+shift+e"));
  assert.ok(!matchesShortcutCombo({ ...base, key: "f", metaKey: true }, "mod+e")); // wrong key
});

test("registry keeps retired familiar-type words as aliases (cave-lgcb)", () => {
  // The vocabulary reduction removed watch/planning/writing/indexing from the
  // Type picker; their rooms stay reachable through Role labels only because
  // register.tsx carries these alias words. Pin them so the continuity story
  // can't silently drift from the shapes asserted in familiar-types.test.ts.
  const source = readFileSync(
    new URL("../components/role-surfaces/register.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /aliases:\s*\["watch",\s*"guardian"\]/);
  assert.match(source, /aliases:\s*\["planner",\s*"planning"\]/);
  assert.match(source, /aliases:\s*\["editor",\s*"writer",\s*"writing"\]/);
  assert.match(source, /aliases:\s*\["archivist",\s*"indexing"\]/);
});
