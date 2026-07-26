/**
 * Small, dependency-injected state machine for the durable backdrop image.
 *
 * Only confirmed image bytes are cached. A missing response, an auth failure,
 * or a transient sidecar failure never becomes a permanent `null` cache entry,
 * so a later read can recover without a reload. Mutations and legacy migration
 * share one queue to prevent an old IndexedDB image from racing a new upload.
 */

export type CentralBackdropImage =
  | { kind: "found"; blob: Blob }
  | { kind: "missing" };

export type BackdropMigrationResult =
  | "already-complete"
  | "already-present"
  | "blocked"
  | "no-legacy-image"
  | "uploaded";

export type BackdropImageDriver = {
  readCentral(): Promise<CentralBackdropImage>;
  readLegacy(): Promise<Blob | null>;
  persistCentral(blob: Blob | null): Promise<void>;
  mirrorLegacy(blob: Blob): Promise<void>;
  migrationBlocked(): boolean;
};

export type BackdropImageState = {
  read(): Promise<Blob | null>;
  write(blob: Blob | null): Promise<void>;
  migrateLegacy(): Promise<BackdropMigrationResult>;
  invalidateCentral(): void;
  subscribe(listener: () => void): () => void;
  revision(): number;
};

export function createBackdropImageState(driver: BackdropImageDriver): BackdropImageState {
  let cachedImage: Blob | undefined;
  let imageRead: Promise<Blob | null> | null = null;
  let migrationRead: Promise<BackdropMigrationResult> | null = null;
  let migrationComplete = false;
  let mutationTail: Promise<void> = Promise.resolve();
  let generation = 0;
  let currentRevision = 0;
  const listeners = new Set<() => void>();

  function emit(): void {
    currentRevision += 1;
    for (const listener of listeners) listener();
  }

  function isMigrationBlocked(): boolean {
    try {
      return driver.migrationBlocked();
    } catch {
      return false;
    }
  }

  async function readLegacyBestEffort(): Promise<Blob | null> {
    try {
      return await driver.readLegacy();
    } catch {
      return null;
    }
  }

  function queueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function read(): Promise<Blob | null> {
    if (cachedImage) return cachedImage;
    if (imageRead) return imageRead;

    const readGeneration = generation;
    const request = (async () => {
      let central: CentralBackdropImage;
      try {
        central = await driver.readCentral();
      } catch {
        // Auth/network/server failures are not absence. A legacy image may
        // keep this session looking right, but it is deliberately not cached
        // so the next read retries the canonical API.
        return isMigrationBlocked() ? null : readLegacyBestEffort();
      }

      if (central.kind === "found") {
        if (readGeneration === generation) cachedImage = central.blob;
        return central.blob;
      }

      // A canonical tombstone means the user explicitly cleared the image.
      // Keep the old IndexedDB bytes intact without resurrecting them.
      if (isMigrationBlocked()) return null;

      const legacy = await readLegacyBestEffort();
      if (legacy) {
        // Bootstrap normally performs this import. This second path makes a
        // later successful 404 read retry a migration that previously failed
        // because auth or the sidecar was temporarily unavailable.
        void migrateLegacy().catch(() => {});
      }
      return legacy;
    })();

    imageRead = request;
    void request.finally(() => {
      if (imageRead === request) imageRead = null;
    });
    return request;
  }

  function migrateLegacy(): Promise<BackdropMigrationResult> {
    if (migrationComplete) return Promise.resolve("already-complete");
    if (migrationRead) return migrationRead;

    const request = queueMutation(async () => {
      // Recheck while holding the mutation queue. A user upload that won the
      // queue first must never be overwritten by an older IndexedDB record.
      const central = await driver.readCentral();
      if (central.kind === "found") {
        const hadCache = Boolean(cachedImage);
        cachedImage = central.blob;
        migrationComplete = true;
        if (!hadCache) emit();
        return "already-present" as const;
      }

      if (isMigrationBlocked()) {
        migrationComplete = true;
        return "blocked" as const;
      }

      // Unlike display fallback, an unreadable legacy database is retryable;
      // do not turn that failure into a permanent "no legacy image" result.
      const legacy = await driver.readLegacy();
      if (!legacy) {
        migrationComplete = true;
        return "no-legacy-image" as const;
      }

      const migrationGeneration = generation;
      await driver.persistCentral(legacy);
      if (migrationGeneration === generation) {
        cachedImage = legacy;
        emit();
      }
      migrationComplete = true;
      return "uploaded" as const;
    });

    migrationRead = request;
    void request.then(
      () => {
        if (migrationRead === request) migrationRead = null;
      },
      () => {
        // Transient/auth failures remain retryable.
        if (migrationRead === request) migrationRead = null;
      },
    );
    return request;
  }

  function write(blob: Blob | null): Promise<void> {
    generation += 1;
    const writeGeneration = generation;
    return queueMutation(async () => {
      await driver.persistCentral(blob);
      if (blob) await driver.mirrorLegacy(blob).catch(() => {});

      // `null` intentionally does not delete the legacy record. The canonical
      // metadata tombstone prevents a subsequent migration from reviving it.
      if (writeGeneration === generation) {
        cachedImage = blob ?? undefined;
        migrationComplete = true;
        emit();
      }
    });
  }

  function invalidateCentral(): void {
    generation += 1;
    cachedImage = undefined;
    migrationComplete = false;
    emit();
  }

  return {
    read,
    write,
    migrateLegacy,
    invalidateCentral,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    revision() {
      return currentRevision;
    },
  };
}
