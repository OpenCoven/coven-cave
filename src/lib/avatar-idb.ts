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
};

export type AvatarStorageDriver = {
  getAll(store: AvatarStore): Promise<Record<string, AvatarRecord>>;
  getAllStrict(store: AvatarStore): Promise<Record<string, AvatarRecord>>;
  put(store: AvatarStore, key: string, value: AvatarRecord): Promise<void>;
  delete(store: AvatarStore, key: string): Promise<void>;
  move(store: AvatarStore, from: string, to: string): Promise<AvatarMoveResult>;
};

const DB_NAME = "cave-avatars";
const DB_VERSION = 2; // v2: + projectAvatars
const STORES: readonly AvatarStore[] = ["familiarImages", "projectAvatars"];

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
    const tx = db.transaction(store, "readwrite");
    await requestToPromise(tx.objectStore(store).put(value, key));
  },

  async delete(store, key) {
    if (!hasIdb()) throw new Error("IndexedDB unavailable");
    const db = await openDb();
    const tx = db.transaction(store, "readwrite");
    await requestToPromise(tx.objectStore(store).delete(key));
  },

  async move(store, from, to) {
    if (!hasIdb()) throw new Error("IndexedDB unavailable");
    const db = await openDb();
    const tx = db.transaction(store, "readwrite");
    const done = transactionToPromise(tx).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const os = tx.objectStore(store);
    try {
      const source = (await requestToPromise(os.get(from))) as AvatarRecord | undefined;
      const destination = (await requestToPromise(os.get(to))) as AvatarRecord | undefined;
      let result: AvatarMoveResult;

      if (!source) {
        result = { source: null, destination: destination ?? null };
      } else if (destination) {
        if (avatarMigrationDestinationWins(source, destination)) {
          os.delete(from);
          result = { source: null, destination };
        } else {
          os.put(source, to);
          os.delete(from);
          result = { source: null, destination: source };
        }
      } else {
        os.put(source, to);
        os.delete(from);
        result = { source: null, destination: source };
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
