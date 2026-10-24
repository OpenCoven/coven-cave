/** Retain only unresolved, user-initiated commands in this browser tab. Reads
 * never dispatch work; retry still requires the user's original action. */
type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type StorageSource = () => PendingStorage;
const browserStorage: StorageSource = () => window.sessionStorage;
const message = "The pending request could not be retained safely. Restore browser storage before changing this schedule.";

export function pendingIntentMap<T>(namespace: string, source: StorageSource = browserStorage) {
  const keyFor = (key: string) => `cave:automation-intent:v1:${namespace}:${encodeURIComponent(key)}`;
  return {
    get(key: string): T | undefined {
      try {
        const raw = source().getItem(keyFor(key));
        if (raw === null) return undefined;
        const value: unknown = JSON.parse(raw);
        if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid intent");
        return value as T;
      } catch { throw new Error(message); }
    },
    set(key: string, value: T): void {
      try { source().setItem(keyFor(key), JSON.stringify(value)); }
      catch { throw new Error(message); }
    },
    delete(key: string): void {
      try { source().removeItem(keyFor(key)); }
      catch { throw new Error(message); }
    },
    has(key: string): boolean { return this.get(key) !== undefined; },
  };
}

/** Existing mutation helpers assign/delete `pending`; intercept both so a
 * remount or reload cannot silently generate a new adoption key. */
export function pendingIntentSession<T>(namespace: string, source: StorageSource = browserStorage): { pending?: T } {
  const store = pendingIntentMap<T>(namespace, source);
  return new Proxy<{ pending?: T }>({}, {
    get: (_target, property) => property === "pending" ? store.get("pending") : undefined,
    set: (_target, property, value) => { if (property !== "pending") return false; store.set("pending", value); return true; },
    deleteProperty: (_target, property) => { if (property !== "pending") return false; store.delete("pending"); return true; },
  });
}
