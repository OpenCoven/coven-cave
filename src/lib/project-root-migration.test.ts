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
 *   - cave:project-frecency root is the KEY -> re-key and merge history
 *   - group chats, new-session default, and chat project filters keyed by
 *     project id -> rewrite values
 *   - comux pins + order    DOES NOT EXIST — the comux surface was deleted
 *     (cave-c3yt), so there is nothing to migrate and no test for it here.
 *     A migration for a store that has not existed for months would pass
 *     against nothing.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const store = new Map();
let denyLocalStorageWrites = false;
let denyLocalStorageReads = false;
globalThis.window = {
  localStorage: {
    getItem: (k) => {
      if (denyLocalStorageReads) throw new DOMException("Storage is disabled.", "SecurityError");
      return store.has(k) ? store.get(k) : null;
    },
    setItem: (k, v) => {
      if (denyLocalStorageWrites) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      store.set(k, String(v));
    },
    removeItem: (k) => store.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
};

const idb = { projectAvatars: new Map(), familiarImages: new Map() };
const LITERAL_DRIVE_IMAGE = {
  dataUrl: "data:image/png;base64,LITERAL-C-DRIVE",
  mime: "image/png",
  updatedAt: "2026-08-04T00:00:00.000Z",
};
const CANONICAL_DRIVE_IMAGE = {
  dataUrl: "data:image/png;base64,CANONICAL-C-DRIVE",
  mime: "image/png",
  updatedAt: "2026-08-05T00:00:00.000Z",
};
idb.projectAvatars.set("C:", LITERAL_DRIVE_IMAGE);
idb.projectAvatars.set("C:/", CANONICAL_DRIVE_IMAGE);
let denyWrites = false;
let denyAvatarReads = false;
let writeTail = Promise.resolve();
const withWriteLock = async (fn) => {
  const run = writeTail.then(fn, fn);
  writeTail = run.then(() => undefined, () => undefined);
  return run;
};
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
let pausedMigration = null;
const migrationDestinationWins = (source, destination) => {
  if (!destination) return false;
  if (source.dataUrl === destination.dataUrl && source.mime === destination.mime) return true;
  const sourceTime = Date.parse(source.updatedAt);
  const destinationTime = Date.parse(destination.updatedAt);
  if (!Number.isFinite(sourceTime) || !Number.isFinite(destinationTime)) return true;
  return destinationTime >= sourceTime;
};
const fakeDriver = {
  async getAll(s) {
    return Object.fromEntries(idb[s]);
  },
  async getAllStrict(s) {
    if (denyAvatarReads) {
      throw new DOMException("Avatar storage is temporarily unreadable.", "UnknownError");
    }
    return Object.fromEntries(idb[s]);
  },
  async put(s, key, value) {
    if (denyWrites) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    if (
      pausedMigration &&
      s === "projectAvatars" &&
      key === pausedMigration.to &&
      value.dataUrl === pausedMigration.sourceDataUrl
    ) {
      pausedMigration.entered.resolve();
      await pausedMigration.release.promise;
    }
    await withWriteLock(() => idb[s].set(key, value));
  },
  async delete(s, key) {
    await withWriteLock(() => idb[s].delete(key));
  },
  async move(s, from, to) {
    if (denyWrites) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    return withWriteLock(async () => {
      if (pausedMigration && s === "projectAvatars" && from === pausedMigration.from && to === pausedMigration.to) {
        pausedMigration.entered.resolve();
        await pausedMigration.release.promise;
      }
      const source = idb[s].get(from) ?? null;
      const destination = idb[s].get(to) ?? null;
      if (!source) return { source: null, destination };
      if (destination) {
        if (migrationDestinationWins(source, destination)) {
          idb[s].delete(from);
          return { source: null, destination };
        }
        idb[s].set(to, source);
        idb[s].delete(from);
        return { source: null, destination: source };
      }
      idb[s].set(to, source);
      idb[s].delete(from);
      return { source: null, destination: source };
    });
  },
};

const { setAvatarStorageForTests } = await import("./avatar-idb.ts");
setAvatarStorageForTests(fakeDriver);

const images = await import("./cave-project-images.ts");
await images.whenProjectImagesHydrated();

const { CHAT_PROJECT_OVERRIDES_KEY, readProjectOverrides } = await import(
  "./chat-project-overrides.ts"
);
const {
  migrateAndAcknowledgeProjectRoots,
  migrateProjectRootKeys,
  projectRootMigrationAcknowledgements,
} = await import("./project-root-migration.ts");

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
  store.set(
    CHAT_PROJECT_OVERRIDES_KEY,
    JSON.stringify({ "session-drive": "C:", "session-other": "/untouched/root" }),
  );
  const moved = await migrateProjectRootKeys([
    { id: "drive", root: "C:/", legacyRoot: "C:" },
  ]);

  assert.equal(idb.projectAvatars.has("C:"), false, "the literal pre-upgrade key is removed");
  assert.deepEqual(
    idb.projectAvatars.get("C:/"),
    CANONICAL_DRIVE_IMAGE,
    "an existing newer canonical avatar is never overwritten by legacy C: data",
  );
  assert.equal(readProjectOverrides()["session-drive"], "C:/");
  assert.equal(moved, 1);
}

{
  const firstAlias = "/legacy/multi-a";
  const secondAlias = "/legacy/multi-b";
  const canonical = "/canonical/multi";
  await images.setProjectImage(firstAlias, IMAGE);
  store.set(
    CHAT_PROJECT_OVERRIDES_KEY,
    JSON.stringify({ "session-multi": secondAlias }),
  );

  const moved = await migrateProjectRootKeys([
    {
      id: "multi-alias",
      root: canonical,
      legacyRoot: firstAlias,
      legacyRoots: [firstAlias, secondAlias],
    },
  ]);

  assert.equal(idb.projectAvatars.has(firstAlias), false);
  assert.equal(idb.projectAvatars.has(canonical), true);
  assert.equal(readProjectOverrides()["session-multi"], canonical);
  assert.equal(moved, 2, "every retained legacy alias is migrated");
}

{
  // The acceptance criterion, demonstrated rather than assumed: an existing
  // profile keeps its avatar, override, and picker history across the upgrade.
  await seed();
  store.set(
    "cave:project-frecency:v1",
    JSON.stringify({ [LEGACY]: { picks: 4, lastPickedAt: 100 } }),
  );
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
  assert.deepEqual(
    JSON.parse(store.get("cave:project-frecency:v1")),
    { [EXPANDED]: { picks: 4, lastPickedAt: 100 } },
    "project picker history follows the canonical root before acknowledgment",
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
  // Deterministic version of the real two-window race. The migration pauses at
  // its storage boundary while a newer canonical write starts. A transaction
  // serializes the operations, so whichever commits last wins; the legacy
  // snapshot can never compare from cache and overwrite the canonical write.
  const SOURCE = "/race/legacy";
  const DESTINATION = "/race/canonical";
  const LEGACY_IMAGE = { dataUrl: "data:image/png;base64,RACE-LEGACY", mime: "image/png" };
  const CANONICAL_IMAGE = { dataUrl: "data:image/png;base64,RACE-CANONICAL", mime: "image/png" };
  await images.setProjectImage(SOURCE, LEGACY_IMAGE);
  const entered = deferred();
  const release = deferred();
  pausedMigration = {
    from: SOURCE,
    to: DESTINATION,
    sourceDataUrl: LEGACY_IMAGE.dataUrl,
    entered,
    release,
  };

  const moving = images.moveProjectImage(SOURCE, DESTINATION);
  await entered.promise;
  const canonicalWrite = images.setProjectImage(DESTINATION, CANONICAL_IMAGE);
  await Promise.resolve();
  await Promise.resolve();
  release.resolve();
  await Promise.all([moving, canonicalWrite]);
  pausedMigration = null;

  assert.equal(
    idb.projectAvatars.get(DESTINATION)?.dataUrl,
    CANONICAL_IMAGE.dataUrl,
    "a concurrent canonical write cannot be overwritten by a stale legacy migration",
  );
  assert.equal(
    images.readProjectImagesSnapshot()[DESTINATION]?.dataUrl,
    CANONICAL_IMAGE.dataUrl,
    "the render snapshot agrees with the atomic storage result",
  );
  assert.equal(idb.projectAvatars.has(SOURCE), false, "the legacy source is deleted exactly once");
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
  store.set(
    "cave:group-chat:groups:v1",
    JSON.stringify([{ id: "g1", projectId: "duplicate-old" }]),
  );
  store.set(
    "cave:chat:new-session-defaults:v1",
    JSON.stringify({ projectId: "duplicate-old" }),
  );
  store.set("cave:chat:project-selected", JSON.stringify("duplicate-old"));
  store.set(
    "cave:chat:project-sidebar-expanded",
    JSON.stringify(["duplicate-old", "duplicate-survivor", "root:/untouched"]),
  );
  await migrateProjectRootKeys([
    {
      id: "duplicate-survivor",
      root: "/canonical/project",
      legacyProjectIds: ["duplicate-old"],
    },
  ]);
  assert.equal(
    JSON.parse(store.get("cave:group-chat:groups:v1"))[0]?.projectId,
    "duplicate-survivor",
    "persisted group chats follow a deduped project's losing id",
  );
  assert.equal(
    JSON.parse(store.get("cave:chat:new-session-defaults:v1"))?.projectId,
    "duplicate-survivor",
    "the persisted new-session default follows the same id migration",
  );
  assert.equal(
    JSON.parse(store.get("cave:chat:project-selected")),
    "duplicate-survivor",
    "the persisted chat project selection follows the same id migration",
  );
  assert.deepEqual(
    JSON.parse(store.get("cave:chat:project-sidebar-expanded")),
    ["duplicate-survivor", "root:/untouched"],
    "expanded project ids migrate without introducing duplicate sidebar keys",
  );
}

{
  // A write failure must not destroy the old record. moveProjectImage writes
  // the new key first and deletes the old only on success; the migration has
  // to preserve that ordering rather than delete-then-write. It must also
  // reject so the caller cannot acknowledge away the server's retry metadata.
  await seed();
  denyWrites = true;
  await assert.rejects(
    () => migrateProjectRootKeys(PROJECTS),
    /avatar/i,
    "storage failure is surfaced to the asynchronous migration caller",
  );
  denyWrites = false;
  assert.equal(
    idb.projectAvatars.has(LEGACY),
    true,
    "a failed write leaves the avatar under its old key rather than losing it",
  );
  assert.equal(
    await migrateProjectRootKeys(PROJECTS),
    1,
    "the retained alias makes a later retry complete normally",
  );
}

{
  await seed();
  denyLocalStorageWrites = true;
  await assert.rejects(
    () => migrateProjectRootKeys(PROJECTS),
    /override/i,
    "a quota failure in the override store is surfaced rather than acknowledged",
  );
  denyLocalStorageWrites = false;
  assert.equal(readProjectOverrides()["session-a"], LEGACY, "the failed override remains retryable");
  assert.equal(await migrateProjectRootKeys(PROJECTS), 1);
  assert.equal(readProjectOverrides()["session-a"], EXPANDED);
}

{
  await seed();
  denyLocalStorageReads = true;
  await assert.rejects(
    () => migrateProjectRootKeys(PROJECTS),
    /override/i,
    "an unreadable override store is surfaced instead of mistaken for an empty store",
  );
  denyLocalStorageReads = false;
  assert.equal(await migrateProjectRootKeys(PROJECTS), 1);
  assert.equal(readProjectOverrides()["session-a"], EXPANDED);
}

{
  await seed();
  const acknowledgements = [];
  denyAvatarReads = true;
  try {
    await assert.rejects(
      () =>
        migrateAndAcknowledgeProjectRoots(PROJECTS, {
          acknowledge: async (payload) => {
            acknowledgements.push(payload);
          },
        }),
      /avatar/i,
      "an unreadable avatar store rejects the migration instead of looking empty",
    );
  } finally {
    denyAvatarReads = false;
  }
  assert.deepEqual(
    acknowledgements,
    [],
    "unreadable avatar storage never acknowledges away the server's retry aliases",
  );
  assert.equal(
    idb.projectAvatars.has(LEGACY),
    true,
    "the legacy avatar remains available for a later retry",
  );

  assert.equal(
    await migrateAndAcknowledgeProjectRoots(PROJECTS, {
      acknowledge: async (payload) => {
        acknowledgements.push(payload);
      },
    }),
    1,
    "the next readable attempt completes the migration",
  );
  assert.equal(idb.projectAvatars.has(LEGACY), false);
  assert.equal(idb.projectAvatars.has(EXPANDED), true);
  assert.deepEqual(
    acknowledgements,
    [[{ projectId: "p1", legacyRoots: [LEGACY] }]],
    "only the successful retry acknowledges the migrated alias",
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


// Pending root aliases are durable retry metadata. Removing them in
// saveProjects lets any unrelated mutation race the asynchronous browser move
// and make a failed avatar/override migration unrecoverable.
{
  const src = readFileSync(new URL("./cave-projects.ts", import.meta.url), "utf8");
  const save = src.match(/async function saveProjects\([\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(save, "saveProjects is findable");
  assert.doesNotMatch(
    save,
    /legacyRoot: _legacyRoot,\s*legacyRoots: _legacyRoots,\s*\.\.\.project/,
    "saveProjects never strips retry metadata before client acknowledgment",
  );
}

assert.deepEqual(
  projectRootMigrationAcknowledgements(PROJECTS),
  [{ projectId: "p1", legacyRoots: [LEGACY] }],
  "successful migrations produce the exact bounded acknowledgment payload",
);

{
  const acknowledgements = [];
  await migrateAndAcknowledgeProjectRoots(PROJECTS, {
    migrate: async () => 0,
    acknowledge: async (payload) => {
      acknowledgements.push(payload);
    },
  });
  assert.deepEqual(
    acknowledgements,
    [[{ projectId: "p1", legacyRoots: [LEGACY] }]],
    "the client acknowledges aliases even when no legacy value remained to move",
  );

  let failedAcknowledgements = 0;
  await assert.rejects(
    () => migrateAndAcknowledgeProjectRoots(PROJECTS, {
      migrate: async () => {
        throw new Error("storage unavailable");
      },
      acknowledge: async () => {
        failedAcknowledgements += 1;
      },
    }),
    /storage unavailable/,
  );
  assert.equal(
    failedAcknowledgements,
    0,
    "a failed local migration never asks the server to clean up retry aliases",
  );
}

// The image store keys by normalizeProjectRoot(root), so the snapshot probe has
// to normalize too. A root carrying a trailing slash or backslashes normalizes
// to something else entirely, and comparing the raw string would skip it.
{
  const src = readFileSync(new URL("./project-root-migration.ts", import.meta.url), "utf8");
  assert.match(
    src,
    /const fromKeys = \[\.\.\.new Set\(\[from, normalizeProjectRoot\(from\)\]\)\]/,
    "the literal legacy key is probed before the normalized store key",
  );
  assert.match(
    src,
    /await hydrateProjectImagesForMigration\(\)/,
    "strict hydration is awaited before the migration snapshot is read",
  );
  assert.doesNotMatch(
    src,
    /new Set\(\[normalizeProjectRoot\(from\), from\]\)/,
    "the literal source key is never probed after its normalized alias",
  );
}

{
  const driver = readFileSync(new URL("./avatar-idb.ts", import.meta.url), "utf8");
  const projectImages = readFileSync(new URL("./cave-project-images.ts", import.meta.url), "utf8");
  assert.match(
    driver,
    /async move\(store, from, to\) \{[\s\S]*?db\.transaction\(store, "readwrite"\)[\s\S]*?os\.get\(from\)[\s\S]*?os\.get\(to\)[\s\S]*?os\.put\(source, to\)[\s\S]*?os\.delete\(from\)[\s\S]*?await done;/,
    "destination compare, conditional write, and source deletion share one readwrite transaction",
  );
  assert.match(
    projectImages,
    /avatarStorage\(\)\.move\("projectAvatars", from, to\)/,
    "project migration delegates its whole compare-and-move decision to the atomic storage operation",
  );
  assert.doesNotMatch(
    projectImages,
    /const destination = cached\[to\]/,
    "migration never fakes atomicity with a destination cache read",
  );
}

console.log("project-root-migration.test.ts: ok");
