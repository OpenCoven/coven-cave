// @ts-nocheck
/**
 * cave-2x1em: when the server starts serving one root form, the client's
 * root-keyed data must come with it.
 *
 * createProject has persisted an expanded root since cave-psp8, so the same
 * folder reaches the client as `~/code/app` or `/home/dev/code/app` depending
 * on when it was added. Serving one form fixes that split — and moves the key
 * out from under whatever the client already stored. `legacyRoot` carries the
 * old key so this migration can follow it.
 *
 * SCOPE, corrected against the code rather than the bead:
 *   - IDB projectAvatars    keyed BY root      -> re-key
 *   - cave:chat:project-overrides  root is the VALUE -> rewrite values
 *   - comux pins + order    DOES NOT EXIST — the comux surface was deleted
 *     (cave-c3yt), so there is nothing to migrate and no test for it here.
 *     A migration for a store that has not existed for months would pass
 *     against nothing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
};

const idb = { projectAvatars: new Map(), familiarImages: new Map() };
let denyWrites = false;
const fakeDriver = {
  async getAll(s) {
    return Object.fromEntries(idb[s]);
  },
  async put(s, key, value) {
    if (denyWrites) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    idb[s].set(key, value);
  },
  async delete(s, key) {
    idb[s].delete(key);
  },
};

const { setAvatarStorageForTests } = await import("./avatar-idb.ts");
setAvatarStorageForTests(fakeDriver);

const images = await import("./cave-project-images.ts");
await images.whenProjectImagesHydrated();

const { CHAT_PROJECT_OVERRIDES_KEY, readProjectOverrides } = await import(
  "./chat-project-overrides.ts"
);
const { migrateProjectRootKeys } = await import("./project-root-migration.ts");

const LEGACY = "~/code/app";
const EXPANDED = "/home/dev/code/app";
const IMAGE = { dataUrl: "data:image/png;base64,AAAA", mime: "image/png" };

// Seed through the PUBLIC api, not by writing into the fake driver. The image
// store hydrates once at import and keeps an in-memory snapshot; poking the map
// behind it leaves that snapshot stale, so moveProjectImage would find nothing
// and the test would fail for a reason that has nothing to do with the
// migration. Going through setProjectImage is also how the app gets here.
async function seed() {
  for (const key of [...idb.projectAvatars.keys()]) await images.clearProjectImage(key);
  await images.setProjectImage(LEGACY, IMAGE);
  store.set(
    CHAT_PROJECT_OVERRIDES_KEY,
    JSON.stringify({ "session-a": LEGACY, "session-b": "/untouched/root" }),
  );
}

// The projects the server now serves: one that moved, one that never had a ~.
const PROJECTS = [
  { id: "p1", root: EXPANDED, legacyRoot: LEGACY },
  { id: "p2", root: "/already/absolute" },
];

{
  // The acceptance criterion, demonstrated rather than assumed: an existing
  // profile keeps its avatar and its override across the upgrade.
  await seed();
  const moved = await migrateProjectRootKeys(PROJECTS);

  assert.equal(idb.projectAvatars.has(EXPANDED), true, "avatar follows the root");
  assert.equal(idb.projectAvatars.has(LEGACY), false, "the stale key is cleaned up");
  assert.equal(
    idb.projectAvatars.get(EXPANDED)?.dataUrl,
    IMAGE.dataUrl,
    "the image survives byte-for-byte, not just its key",
  );

  const overrides = readProjectOverrides();
  assert.equal(overrides["session-a"], EXPANDED, "override VALUE is rewritten");
  assert.equal(
    overrides["session-b"],
    "/untouched/root",
    "an unrelated override is left exactly alone",
  );
  assert.equal(moved, 1, "reports how many roots it followed");
}

{
  // Two windows can start at once, so this runs twice. The second pass must be
  // a no-op — not merely non-crashing.
  const after = JSON.stringify([...idb.projectAvatars], null, 0);
  const overridesAfter = store.get(CHAT_PROJECT_OVERRIDES_KEY);
  const moved = await migrateProjectRootKeys(PROJECTS);
  assert.equal(moved, 0, "a second pass finds nothing to move");
  assert.equal(JSON.stringify([...idb.projectAvatars], null, 0), after, "avatars unchanged");
  assert.equal(store.get(CHAT_PROJECT_OVERRIDES_KEY), overridesAfter, "overrides unchanged");
}

{
  // No legacyRoot means the server never moved anything — touching a store
  // here would be a re-key with no cause.
  await seed();
  const moved = await migrateProjectRootKeys([{ id: "p2", root: "/already/absolute" }]);
  assert.equal(moved, 0, "nothing to do without legacyRoot");
  assert.equal(idb.projectAvatars.has(LEGACY), true, "an untouched profile is left as it was");
}

{
  // A write failure must not destroy the old record. moveProjectImage writes
  // the new key first and deletes the old only on success; the migration has
  // to preserve that ordering rather than delete-then-write.
  await seed();
  denyWrites = true;
  await migrateProjectRootKeys(PROJECTS);
  denyWrites = false;
  assert.equal(
    idb.projectAvatars.has(LEGACY),
    true,
    "a failed write leaves the avatar under its old key rather than losing it",
  );
}

{
  // The override map can legitimately be absent or corrupt; a migration that
  // throws on first run is worse than one that does nothing.
  store.delete(CHAT_PROJECT_OVERRIDES_KEY);
  await migrateProjectRootKeys(PROJECTS);
  store.set(CHAT_PROJECT_OVERRIDES_KEY, "{not json");
  await migrateProjectRootKeys(PROJECTS);
  assert.ok(true, "absent and corrupt override stores are survivable");
}


// ── legacyRoot must never reach disk (review on #4185) ─────────────────────
// loadProjectsUnlocked attaches legacyRoot in memory, and every mutation path
// persists the array it returned — so a marker documented as "response-only"
// was being written to projects.json on the first create/patch/delete after an
// upgrade, and then re-attached forever. Documenting the intent is not the
// same as enforcing it; saveProjects strips the field, and this asserts the
// strip rather than the comment.
{
  const src = readFileSync(new URL("./cave-projects.ts", import.meta.url), "utf8");
  const save = src.match(/async function saveProjects\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(save, "saveProjects is findable");
  assert.match(
    save,
    /legacyRoot: _legacyRoot, \.\.\.project/,
    "saveProjects strips legacyRoot before writing",
  );
  assert.doesNotMatch(
    save,
    /projects: projects,?\n/,
    "the raw array is never handed to the writer",
  );
}

// The image store keys by normalizeProjectRoot(root), so the snapshot probe has
// to normalize too. A root carrying a trailing slash or backslashes normalizes
// to something else entirely, and comparing the raw string would skip it.
{
  const src = readFileSync(new URL("./project-root-migration.ts", import.meta.url), "utf8");
  assert.match(src, /const fromKey = normalizeProjectRoot\(from\)/, "probe uses the store's key");
  assert.match(
    src,
    /await whenProjectImagesHydrated\(\)/,
    "hydration is awaited before the snapshot is read",
  );
  assert.doesNotMatch(
    src,
    /readProjectImagesSnapshot\(\), from\)/,
    "no raw-string snapshot lookups remain",
  );
}

console.log("project-root-migration.test.ts: ok");
