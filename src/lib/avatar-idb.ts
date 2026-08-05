"use client";

/**
 * Minimal IndexedDB driver for active Cave avatar stores.
 *
 * Avatars are base64 data URLs (up to ~2.8MB each) — far too big for
 * localStorage's ~5MB origin quota, which is shared with every other cave:*
 * key. IndexedDB's quota is effectively unbounded for this use, so the avatar
 * stores persist here and keep localStorage free for small state.
 *
 * The driver keeps ordinary CRUD plus an atomic `move` seam so store modules
 * stay storage-agnostic and migrations can compare/write/delete in one
 * transaction. Tests inject a Map-backed fake via `setAvatarStorageForTests`.
 */

export type AvatarRecord = { dataUrl: string; mime: string; updatedAt: string };

export type AvatarStore = "familiarImages" | "projectAvatars";

export type AvatarMoveResult = {
  source: AvatarRecord | null;
  destination: AvatarRecord | null;
  destinationKey: string;
};

export type AvatarStorageDriver = {
  getAll(store: AvatarStore): Promise<Record<string, AvatarRecord>>;
  getAllStrict(store: AvatarStore): Promise<Record<string, AvatarRecord>>;
  put(store: AvatarStore, key: string, value: AvatarRecord): Promise<string>;
  delete(store: AvatarStore, key: string): Promise<string>;
  move(store: AvatarStore, from: string, to: string): Promise<AvatarMoveResult>;
};

const DB_NAME = "cave-avatars";
const DB_VERSION = 3; // v3: + durable project-avatar root aliases
const STORES: readonly AvatarStore[] = ["familiarImages", "projectAvatars"];
const PROJECT_AVATAR_ALIASES = "projectAvatarAliases";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
      if (!db.objectStoreNames.contains(PROJECT_AVATAR_ALIASES)) {
        db.createObjectStore(PROJECT_AVATAR_ALIASES);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab/window upgrading the schema must not deadlock on this
      // connection — close and let the next call reopen.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
  dbPromise = opening;
  // A failed open must not poison every later call (e.g. a transient lock).
  opening.catch(() => {
    if (dbPromise === opening) dbPromise = null;
  });
  return opening;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionToPromise(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export function avatarMigrationDestinationWins(
  source: AvatarRecord,
  destination: AvatarRecord,
): boolean {
  if (source.dataUrl === destination.dataUrl && source.mime === destination.mime) {
    return true;
  }
  const sourceTime = Date.parse(source.updatedAt);
  const destinationTime = Date.parse(destination.updatedAt);
  if (!Number.isFinite(sourceTime) || !Number.isFinite(destinationTime)) {
    return true;
  }
  return destinationTime >= sourceTime;
}

const hasIdb = () => typeof indexedDB !== "undefined";

async function resolveProjectAvatarAlias(
  aliases: IDBObjectStore,
  key: string,
): Promise<string> {
  const seen = new Set<string>();
  let current = key;
  while (!seen.has(current)) {
    seen.add(current);
    const next = await requestToPromise(aliases.get(current));
    if (typeof next !== "string" || !next || next === current) return current;
    current = next;
  }
  throw new Error("project avatar alias cycle");
}

async function readAllStrict(store: AvatarStore): Promise<Record<string, AvatarRecord>> {
  if (!hasIdb()) throw new Error("IndexedDB unavailable");
  const db = await openDb();
  const tx = db.transaction(store, "readonly");
  const done = transactionToPromise(tx);
  try {
    const os = tx.objectStore(store);
    const [keys, values] = await Promise.all([
      requestToPromise(os.getAllKeys()),
      requestToPromise(os.getAll()),
    ]);
    await done;
    const map: Record<string, AvatarRecord> = {};
    keys.forEach((key, i) => {
      const value = values[i] as AvatarRecord | undefined;
      if (typeof key === "string" && value && typeof value.dataUrl === "string") {
        map[key] = value;
      }
    });
    return map;
  } catch (error) {
    await done.catch(() => undefined);
    throw error;
  }
}

const idbDriver: AvatarStorageDriver = {
  async getAll(store) {
    if (!hasIdb()) return {};
    try {
      return await readAllStrict(store);
    } catch {
      return {}; // unreadable DB reads as empty; writes will surface real errors
    }
  },

  getAllStrict(store) {
    return readAllStrict(store);
  },

  async put(store, key, value) {
    if (!hasIdb()) throw new Error("IndexedDB unavailable");
    const db = await openDb();
    const stores = store === "projectAvatars"
      ? [store, PROJECT_AVATAR_ALIASES]
      : [store];
    const tx = db.transaction(stores, "readwrite");
    const done = transactionToPromise(tx);
    try {
      const destinationKey = store === "projectAvatars"
        ? await resolveProjectAvatarAlias(
            tx.objectStore(PROJECT_AVATAR_ALIASES),
            key,
          )
        : key;
      await requestToPromise(tx.objectStore(store).put(value, destinationKey));
      await done;
      return destinationKey;
    } catch (error) {
      await done.catch(() => undefined);
      throw error;
    }
  },

  async delete(store, key) {
    if (!hasIdb()) throw new Error("IndexedDB unavailable");
    const db = await openDb();
    const stores = store === "projectAvatars"
      ? [store, PROJECT_AVATAR_ALIASES]
      : [store];
    const tx = db.transaction(stores, "readwrite");
    const done = transactionToPromise(tx);
    try {
      const destinationKey = store === "projectAvatars"
        ? await resolveProjectAvatarAlias(
            tx.objectStore(PROJECT_AVATAR_ALIASES),
            key,
          )
        : key;
      await requestToPromise(tx.objectStore(store).delete(destinationKey));
      await done;
      return destinationKey;
    } catch (error) {
      await done.catch(() => undefined);
      throw error;
    }
  },

  async move(store, from, to) {
    if (!hasIdb()) throw new Error("IndexedDB unavailable");
    const db = await openDb();
    const stores = store === "projectAvatars"
      ? [store, PROJECT_AVATAR_ALIASES]
      : [store];
    const tx = db.transaction(stores, "readwrite");
    const done = transactionToPromise(tx).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const os = tx.objectStore(store);
    try {
      const aliases = store === "projectAvatars"
        ? tx.objectStore(PROJECT_AVATAR_ALIASES)
        : null;
      const destinationKey = aliases
        ? await resolveProjectAvatarAlias(aliases, to)
        : to;
      const source = (await requestToPromise(os.get(from))) as AvatarRecord | undefined;
      const destination = (await requestToPromise(os.get(destinationKey))) as AvatarRecord | undefined;
      let result: AvatarMoveResult;

      if (from === destinationKey) {
        result = {
          source: null,
          destination: source ?? destination ?? null,
          destinationKey,
        };
      } else if (!source) {
        result = {
          source: null,
          destination: destination ?? null,
          destinationKey,
        };
      } else if (destination) {
        if (avatarMigrationDestinationWins(source, destination)) {
          os.delete(from);
          result = { source: null, destination, destinationKey };
        } else {
          os.put(source, destinationKey);
          os.delete(from);
          result = { source: null, destination: source, destinationKey };
        }
      } else {
        os.put(source, destinationKey);
        os.delete(from);
        result = { source: null, destination: source, destinationKey };
      }
      if (aliases && from !== destinationKey) {
        aliases.put(destinationKey, from);
      }

      const completion = await done;
      if (!completion.ok) throw completion.error;
      return result;
    } catch (error) {
      await done;
      throw error;
    }
  },
};

let driver: AvatarStorageDriver = idbDriver;

export function avatarStorage(): AvatarStorageDriver {
  return driver;
}

/** Test seam — pass null to restore the real IndexedDB driver. */
export function setAvatarStorageForTests(next: AvatarStorageDriver | null): void {
  driver = next ?? idbDriver;
}
