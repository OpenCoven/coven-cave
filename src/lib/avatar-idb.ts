"use client";

/**
 * Minimal IndexedDB driver for active Cave avatar stores.
 *
 * Avatars are base64 data URLs (up to ~2.8MB each) — far too big for
 * localStorage's ~5MB origin quota, which is shared with every other cave:*
 * key. IndexedDB's quota is effectively unbounded for this use, so the avatar
 * stores persist here and keep localStorage free for small state.
 *
 * The driver is a three-method seam (`getAll` / `put` / `delete`) so the store
 * modules stay storage-agnostic and tests can inject a Map-backed fake via
 * `setAvatarStorageForTests`.
 */

export type AvatarRecord = { dataUrl: string; mime: string; updatedAt: string };

export type AvatarStore = "familiarImages" | "projectAvatars";

export type AvatarStorageDriver = {
  getAll(store: AvatarStore): Promise<Record<string, AvatarRecord>>;
  put(store: AvatarStore, key: string, value: AvatarRecord): Promise<void>;
  delete(store: AvatarStore, key: string): Promise<void>;
};

const DB_NAME = "cave-avatars";
const DB_VERSION = 2; // v2: + projectAvatars
const STORES: readonly AvatarStore[] = ["familiarImages", "projectAvatars"];

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
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
  // A failed open must not poison every later call (e.g. a transient lock).
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

const hasIdb = () => typeof indexedDB !== "undefined";

const idbDriver: AvatarStorageDriver = {
  async getAll(store) {
    if (!hasIdb()) return {};
    try {
      const db = await openDb();
      const tx = db.transaction(store, "readonly");
      const os = tx.objectStore(store);
      const [keys, values] = await Promise.all([
        requestToPromise(os.getAllKeys()),
        requestToPromise(os.getAll()),
      ]);
      const map: Record<string, AvatarRecord> = {};
      keys.forEach((key, i) => {
        const value = values[i] as AvatarRecord | undefined;
        if (typeof key === "string" && value && typeof value.dataUrl === "string") {
          map[key] = value;
        }
      });
      return map;
    } catch {
      return {}; // unreadable DB reads as empty; writes will surface real errors
    }
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
};

let driver: AvatarStorageDriver = idbDriver;

export function avatarStorage(): AvatarStorageDriver {
  return driver;
}

/** Test seam — pass null to restore the real IndexedDB driver. */
export function setAvatarStorageForTests(next: AvatarStorageDriver | null): void {
  driver = next ?? idbDriver;
}
