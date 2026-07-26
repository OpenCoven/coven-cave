"use client";

/** Residue check for the retired browser-local user avatar store. */
export async function hasLegacySvgUserAvatar(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    try {
      const req = indexedDB.open("cave-avatars");
      req.onerror = () => finish(false);
      req.onupgradeneeded = () => {
        try {
          req.transaction?.abort();
        } finally {
          finish(false);
        }
      };
      req.onblocked = () => finish(false);
      req.onsuccess = () => {
        const db = req.result;
        try {
          if (!db.objectStoreNames.contains("userAvatar")) {
            db.close();
            finish(false);
            return;
          }
          const getReq = db.transaction("userAvatar", "readonly").objectStore("userAvatar").get("user");
          getReq.onerror = () => {
            db.close();
            finish(false);
          };
          getReq.onsuccess = () => {
            const record = getReq.result as { mime?: unknown } | undefined;
            db.close();
            finish(record?.mime === "image/svg+xml");
          };
        } catch {
          db.close();
          finish(false);
        }
      };
    } catch {
      finish(false);
    }
  });
}
